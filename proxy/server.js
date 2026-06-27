// aihot-fansai 本地代理（仅本地开发用，线上由 web/api/[...path].js 接管）
// /api/* → aihot.virxact.com/api/public/*，注入 UA + CORS + 60s 缓存
// /api/items 合并 HuggingFace Daily Papers + arXiv RSS（可选翻译）
// 配了 DATABASE_URL 时：顺手囤进 Neon，搜索查自有历史库（与线上行为一致）
import http from 'node:http';
import { buildMergedItems } from '../web/api/_feed.js';
import { dbEnabled, upsertItems, searchItems } from '../web/api/_db.js';

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
      // 1) 搜索：查自有历史库
      if (isItems && q.length >= 2 && dbEnabled()) {
        const take = parseInt(params.get('take') || '100', 10);
        const rows = await searchItems(q, take);
        if (rows.length > 0) {
          res.writeHead(200, {
            ...corsHeaders,
            'content-type': 'application/json; charset=utf-8',
            'x-source': 'neon-history',
          });
          return res.end(JSON.stringify({ count: rows.length, items: rows, hasNext: false }));
        }
      }

      // 2) 实时合并 + 顺手囤货
      if (shouldMerge) {
        const { status, parsed, items } = await buildMergedItems(params);
        parsed.items = items;
        parsed.count = items.length;
        if (dbEnabled()) upsertItems(items).catch(() => {});
        res.writeHead(status, {
          ...corsHeaders,
          'content-type': 'application/json; charset=utf-8',
          'x-sources-merged': 'hf,arxiv',
          'x-db': dbEnabled() ? 'on' : 'off',
        });
        return res.end(JSON.stringify(parsed));
      }

      // 3) 其它路径原样透传
      const aihot = await fetchAihot(upstreamUrl);
      res.writeHead(aihot.status, {
        ...corsHeaders,
        'content-type': 'application/json; charset=utf-8',
        'x-aihot-cache': aihot.hit ? 'HIT' : 'MISS',
      });
      res.end(aihot.body);
    } catch (err) {
      res.writeHead(502, {
        ...corsHeaders,
        'content-type': 'application/json; charset=utf-8',
      });
      res.end(JSON.stringify({ error: 'upstream_failed', detail: String(err) }));
    }
  })
  .listen(PORT, () => {
    console.log(`[aihot-fansai proxy] listening on http://localhost:${PORT}`);
    console.log(`  GET /api/items  (含 HF Papers + arXiv RSS)`);
    console.log(`  DATABASE_URL ${dbEnabled() ? '已配置 ✓（囤货+历史搜索开启）' : '未配置（无历史库，行为同以前）'}`);
    console.log(`  ANTHROPIC_API_KEY ${process.env.ANTHROPIC_API_KEY ? '已配置 ✓' : '未配置（英文条目不翻译）'}`);
  });
