// Vercel Serverless Function: /api/* → aihot.virxact.com/api/public/*
// 注入 UA、加 CORS、加 60s 缓存（per-instance 内存）
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

export default async function handler(req, res) {
  for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v);
  if (req.method === 'OPTIONS') return res.status(204).end();

  // Vercel 把 /api/items?... 路由到这里，req.query.path = ['items']
  // /api/daily/2026-06-04 → req.query.path = ['daily', '2026-06-04']
  const segments = Array.isArray(req.query.path) ? req.query.path : [req.query.path].filter(Boolean);
  const upstreamPath = '/api/public/' + segments.join('/');

  // 把除 path 外的 query 拼回去
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(req.query)) {
    if (k === 'path') continue;
    if (Array.isArray(v)) v.forEach((x) => params.append(k, x));
    else if (v != null) params.append(k, String(v));
  }
  const qs = params.toString();
  const upstreamUrl = `${UPSTREAM}${upstreamPath}${qs ? `?${qs}` : ''}`;

  const cached = cache.get(upstreamUrl);
  if (cached && Date.now() - cached.ts < TTL_MS) {
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('x-aihot-cache', 'HIT');
    return res.status(200).send(cached.body);
  }

  try {
    const upstreamRes = await fetch(upstreamUrl, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
    });
    const body = await upstreamRes.text();
    if (upstreamRes.ok) cache.set(upstreamUrl, { ts: Date.now(), body });

    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('x-aihot-cache', 'MISS');
    return res.status(upstreamRes.status).send(body);
  } catch (err) {
    res.setHeader('content-type', 'application/json; charset=utf-8');
    return res.status(502).send(JSON.stringify({ error: 'upstream_failed', detail: String(err) }));
  }
}
