// Vercel Serverless Function: /api/* → aihot.virxact.com/api/public/*
// 额外把 HuggingFace Daily Papers 注入到 /api/items 里
import { fetchHFPapers, filterHF } from './_hf.js';

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

  // 只对 /api/items（无 cursor 翻页且未排除 paper 分类时）注入 HF
  const isItems = subPath === 'items';
  const hasCursor = params.has('cursor');
  const categoryParam = params.get('category');
  const shouldMergeHF =
    isItems && !hasCursor && (!categoryParam || categoryParam === 'paper');

  try {
    if (shouldMergeHF) {
      const [aihot, hfAll] = await Promise.all([
        fetchAihot(upstreamUrl),
        fetchHFPapers(),
      ]);

      let parsed;
      try {
        parsed = JSON.parse(aihot.body);
      } catch {
        // aihot 返回不是 JSON（罕见）→ 退化到只有 HF
        parsed = { count: 0, items: [], hasNext: false };
      }

      if (Array.isArray(parsed.items)) {
        const hf = filterHF(hfAll, {
          since: params.get('since'),
          q: params.get('q'),
          category: categoryParam,
        });
        // 用 url 去重（防 aihot 也有同一条）
        const seenUrls = new Set(parsed.items.map((i) => i.url));
        const hfNew = hf.filter((i) => !seenUrls.has(i.url));
        const merged = [...parsed.items, ...hfNew].sort(
          (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
        );
        const take = parseInt(params.get('take') || '50', 10);
        parsed.items = merged.slice(0, take);
        parsed.count = parsed.items.length;
      }

      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.setHeader('x-aihot-cache', aihot.hit ? 'HIT' : 'MISS');
      res.setHeader('x-hf-injected', '1');
      return res.status(aihot.status).send(JSON.stringify(parsed));
    }

    // 其他端点（/api/daily 等）直接透传
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
