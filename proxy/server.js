// aihot-fansai 本地代理（仅本地开发用，线上由 web/api/[...path].js 接管）
// /api/* → aihot.virxact.com/api/public/*，注入 UA + CORS + 60s 缓存
// /api/items 合并 HuggingFace Daily Papers + arXiv RSS
// /api/social 社媒声量（查 Neon）；/api/cron/* 手动触发囤货/社媒抓取
// 配了 DATABASE_URL 时：囤货 + 富化（MINIMAX_API_KEY）+ 历史搜索，与线上行为一致
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 极简 .env 加载（仓库根目录 aihot-fansai/.env，gitignore 掉）：
// 本地想开 DB/翻译/社媒抓取时，把 DATABASE_URL / MINIMAX_API_KEY / APIFY_TOKEN 放进去即可。
try {
  const envPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
} catch {
  /* .env 加载失败不影响启动 */
}

// 业务模块必须在 .env 加载之后再 import（_db.js 在模块加载时捕获 DATABASE_URL）
const { buildMergedItems } = await import('../web/api/_feed.js');
const { dbEnabled, searchItems, querySocialPosts, socialStatus } = await import('../web/api/_db.js');
const { applyStoredEnrichment, enrichInBackground, enrichMissingAndPersist } = await import(
  '../web/api/_enrich.js'
);
const { runSocialScrape, hasApifyToken } = await import('../web/api/_social.js');

const PORT = process.env.PORT || 8787;
const UPSTREAM = 'https://aihot.virxact.com';
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 aihot-fansai/0.1.0';

const cache = new Map();
const TTL_MS = 60_000;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function sendJson(res, status, obj, extra = {}) {
  res.writeHead(status, {
    ...corsHeaders,
    'content-type': 'application/json; charset=utf-8',
    ...extra,
  });
  res.end(typeof obj === 'string' ? obj : JSON.stringify(obj));
}

async function fetchAihot(upstreamUrl) {
  const cached = cache.get(upstreamUrl);
  if (cached && Date.now() - cached.ts < TTL_MS) return { status: 200, body: cached.body, hit: true };
  const r = await fetch(upstreamUrl, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  const body = await r.text();
  if (r.ok) cache.set(upstreamUrl, { ts: Date.now(), body });
  return { status: r.status, body, hit: false };
}

http
  .createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, corsHeaders);
      return res.end();
    }
    if (!req.url.startsWith('/api/')) {
      res.writeHead(404, corsHeaders);
      return res.end('not found');
    }

    const u = new URL(req.url, 'http://x');
    const subPath = u.pathname.replace(/^\/api\/?/, '');
    const upstreamUrl = `${UPSTREAM}/api/public/${subPath}${u.search}`;
    const params = u.searchParams;

    const isItems = subPath === 'items';
    const hasCursor = params.has('cursor');
    const categoryParam = params.get('category');
    const q = (params.get('q') || '').trim();
    const shouldMerge = isItems && !hasCursor && (!categoryParam || categoryParam === 'paper');

    try {
      // 0) 社媒声量
      if (subPath === 'social') {
        if (!dbEnabled()) return sendJson(res, 200, { enabled: false, posts: [] });
        const posts = await querySocialPosts({
          topic: params.get('topic') || undefined,
          platform: params.get('platform') || undefined,
          q: (params.get('q') || '').trim() || undefined,
          sort: params.get('sort') === 'rising' ? 'rising' : 'heat',
          days: Math.min(parseInt(params.get('days') || '7', 10) || 7, 30),
          take: Math.min(parseInt(params.get('take') || '30', 10) || 30, 100),
        });
        const status = await socialStatus();
        return sendJson(res, 200, { ...status, posts });
      }

      // 0.1) 手动触发（本地调试线上 cron 的等价物）
      if (subPath === 'cron/ingest') {
        if (!dbEnabled()) return sendJson(res, 200, { ok: false, reason: 'DATABASE_URL 未配置' });
        const p = new URLSearchParams({ mode: 'all', take: '100' });
        const { items } = await buildMergedItems(p);
        const { enrichMap } = await applyStoredEnrichment(items);
        const stats = await enrichMissingAndPersist(items, enrichMap);
        return sendJson(res, 200, { ok: true, fetched: items.length, ...stats });
      }
      if (subPath === 'cron/social') {
        if (!dbEnabled()) return sendJson(res, 200, { ok: false, reason: 'DATABASE_URL 未配置' });
        if (!hasApifyToken()) return sendJson(res, 200, { ok: false, reason: 'APIFY_TOKEN 未配置' });
        const days = Math.min(parseInt(params.get('days') || '7', 10) || 7, 30);
        const maxItems = Math.min(parseInt(params.get('max') || '400', 10) || 400, 1200);
        const result = await runSocialScrape({ days, maxItems });
        // 翻译 + 审核补处理（与线上 cron 行为一致）
        const { getUnprocessedSocial, saveSocialModeration } = await import('../web/api/_db.js');
        const { translateAndModerate } = await import('../web/api/_moderation.js');
        const pending = await getUnprocessedSocial(90);
        let moderation = null;
        if (pending.length) {
          const map = await translateAndModerate(pending);
          const saved = await saveSocialModeration(map);
          moderation = { processed: saved, blocked: Object.values(map).filter((m) => m.blocked).length };
        }
        return sendJson(res, result.ok ? 200 : 502, { ...result, moderation });
      }

      // 1) 搜索：查自有历史库
      if (isItems && q.length >= 2 && dbEnabled()) {
        const take = parseInt(params.get('take') || '100', 10);
        const rows = await searchItems(q, take);
        if (rows.length > 0) {
          return sendJson(
            res,
            200,
            { count: rows.length, items: rows, hasNext: false },
            { 'x-source': 'neon-history' }
          );
        }
      }

      // 2) 实时合并 + 富化应用 + 后台补齐
      if (shouldMerge) {
        const { status, parsed, items: rawItems } = await buildMergedItems(params);
        let items = rawItems;
        if (dbEnabled()) {
          const { items: enriched, enrichMap } = await applyStoredEnrichment(rawItems);
          items = enriched;
          enrichInBackground(rawItems, enrichMap);
        }
        parsed.items = items;
        parsed.count = items.length;
        return sendJson(res, status, parsed, {
          'x-sources-merged': 'hf,arxiv',
          'x-db': dbEnabled() ? 'on' : 'off',
        });
      }

      // 3) 其它路径原样透传
      const aihot = await fetchAihot(upstreamUrl);
      return sendJson(res, aihot.status, aihot.body, {
        'x-aihot-cache': aihot.hit ? 'HIT' : 'MISS',
      });
    } catch (err) {
      return sendJson(res, 502, { error: 'upstream_failed', detail: String(err) });
    }
  })
  .listen(PORT, () => {
    console.log(`[aihot-fansai proxy] listening on http://localhost:${PORT}`);
    console.log(`  GET /api/items   (含 HF Papers + arXiv RSS + 富化)`);
    console.log(`  GET /api/social  (社媒声量) · /api/cron/ingest · /api/cron/social (手动触发)`);
    console.log(`  DATABASE_URL    ${dbEnabled() ? '已配置 ✓（囤货+历史搜索开启）' : '未配置（无历史库，行为同以前）'}`);
    console.log(`  MINIMAX_API_KEY ${process.env.MINIMAX_API_KEY || process.env.MinimaxAPIKey ? '已配置 ✓（翻译+理由+亮点开启）' : '未配置（不翻译、不生成理由/亮点）'}`);
    console.log(`  APIFY_TOKEN     ${process.env.APIFY_TOKEN ? '已配置 ✓（社媒抓取可用）' : '未配置（社媒抓取不可用）'}`);
  });
