// Vercel Serverless Function: /api/* → aihot.virxact.com/api/public/*
// - 合并 HuggingFace Daily Papers + arXiv RSS（见 _feed.js）
// - 可选：通过 ANTHROPIC_API_KEY 翻译英文条目
// - 可选：配了 DATABASE_URL 时，把抓到的条目囤进 Neon，并让搜索跨全部历史
import { buildMergedItems } from './_feed.js';
import { dbEnabled, upsertItems, searchItems } from './_db.js';

const UPSTREAM = 'https://aihot.virxact.com';
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 aihot-fansai/0.1.0';

const cache = new Map();
const TTL_MS = 60_000;

const CORS = {
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

export default async function handler(req, res) {
  for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v);
  if (req.method === 'OPTIONS') return res.status(204).end();

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
    // 1) 搜索：配了数据库就查自有历史库（可跨 30 天+），命中即返回。
    if (isItems && q.length >= 2 && dbEnabled()) {
      const take = parseInt(params.get('take') || '100', 10);
      const rows = await searchItems(q, take);
      if (rows.length > 0) {
        res.setHeader('content-type', 'application/json; charset=utf-8');
        res.setHeader('x-source', 'neon-history');
        return res
          .status(200)
          .send(JSON.stringify({ count: rows.length, items: rows, hasNext: false }));
      }
      // 库里暂时没有 → 落到下面的实时合并（冷启动友好）
    }

    // 2) 默认动态：实时合并 aihot + HF + arXiv，并顺手囤进数据库。
    if (shouldMerge) {
      const { status, parsed, items } = await buildMergedItems(params);
      parsed.items = items;
      parsed.count = items.length;

      // 顺手囤货（fire-and-forget，不阻塞响应、不影响失败时返回）
      if (dbEnabled()) upsertItems(items).catch(() => {});

      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.setHeader('x-sources-merged', 'hf,arxiv');
      res.setHeader('x-db', dbEnabled() ? 'on' : 'off');
      return res.status(status).send(JSON.stringify(parsed));
    }

    // 3) 其它路径（/api/daily、翻页 cursor 等）：原样透传，带 60s 缓存。
    const aihot = await fetchAihot(upstreamUrl);
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('x-aihot-cache', aihot.hit ? 'HIT' : 'MISS');
    return res.status(aihot.status).send(aihot.body);
  } catch (err) {
    res.setHeader('content-type', 'application/json; charset=utf-8');
    return res.status(502).send(
      JSON.stringify({
        error: 'upstream_failed',
        url: upstreamUrl,
        detail: String(err),
        cause: err?.cause ? String(err.cause) : null,
      })
    );
  }
}
