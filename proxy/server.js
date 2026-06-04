// aihot-fansai 本地代理
// /api/* → aihot.virxact.com/api/public/*，注入 UA + CORS + 60s 缓存
// /api/items 额外合并 HuggingFace Daily Papers
import http from 'node:http';
import { fetchHFPapers, filterHF } from '../web/api/_hf.js';

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
    const shouldMergeHF = isItems && !hasCursor && (!categoryParam || categoryParam === 'paper');

    try {
      if (shouldMergeHF) {
        const [aihot, hfAll] = await Promise.all([fetchAihot(upstreamUrl), fetchHFPapers()]);
        let parsed;
        try {
          parsed = JSON.parse(aihot.body);
        } catch {
          parsed = { count: 0, items: [], hasNext: false };
        }
        if (Array.isArray(parsed.items)) {
          const hf = filterHF(hfAll, {
            since: params.get('since'),
            q: params.get('q'),
            category: categoryParam,
          });
          const seenUrls = new Set(parsed.items.map((i) => i.url));
          const hfNew = hf.filter((i) => !seenUrls.has(i.url));
          const merged = [...parsed.items, ...hfNew].sort(
            (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
          );
          const take = parseInt(params.get('take') || '50', 10);
          parsed.items = merged.slice(0, take);
          parsed.count = parsed.items.length;
        }
        res.writeHead(aihot.status, {
          ...corsHeaders,
          'content-type': 'application/json; charset=utf-8',
          'x-aihot-cache': aihot.hit ? 'HIT' : 'MISS',
          'x-hf-injected': '1',
        });
        return res.end(JSON.stringify(parsed));
      }

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
    console.log(`  GET /api/items?mode=selected&since=<ISO>&take=30  (含 HF Papers)`);
    console.log(`  GET /api/daily`);
  });
