// aihot-fansai 本地代理
// 把 /api/* 转发到 aihot.virxact.com/api/public/*，注入 UA + CORS，做内存缓存
import http from 'node:http';

const PORT = process.env.PORT || 8787;
const UPSTREAM = 'https://aihot.virxact.com';
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 aihot-fansai/0.1.0';

// 60 秒内存缓存（按完整 URL key）
const cache = new Map();
const TTL_MS = 60_000;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

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

    // /api/items?... → /api/public/items?...
    const upstreamPath = req.url.replace(/^\/api\//, '/api/public/');
    const upstreamUrl = `${UPSTREAM}${upstreamPath}`;

    const cached = cache.get(upstreamUrl);
    if (cached && Date.now() - cached.ts < TTL_MS) {
      res.writeHead(200, {
        ...corsHeaders,
        'content-type': 'application/json; charset=utf-8',
        'x-aihot-cache': 'HIT',
      });
      return res.end(cached.body);
    }

    try {
      const upstreamRes = await fetch(upstreamUrl, {
        headers: { 'User-Agent': UA, Accept: 'application/json' },
      });
      const body = await upstreamRes.text();
      if (upstreamRes.ok) cache.set(upstreamUrl, { ts: Date.now(), body });

      res.writeHead(upstreamRes.status, {
        ...corsHeaders,
        'content-type': 'application/json; charset=utf-8',
        'x-aihot-cache': 'MISS',
      });
      res.end(body);
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
    console.log(`  GET /api/items?mode=selected&since=<ISO>&take=30`);
    console.log(`  GET /api/daily`);
  });
