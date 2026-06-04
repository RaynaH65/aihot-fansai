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

  // 直接从 req.url 解析 —— 别依赖 Vercel 的 catchall query 解析（[...path] 的 key
  // 实际是 "...path" 带三个字面点，掉过坑）
  // req.url 形如 "/api/daily" 或 "/api/items?mode=selected&..."
  const u = new URL(req.url, 'http://x');
  const subPath = u.pathname.replace(/^\/api\/?/, '');
  const upstreamUrl = `${UPSTREAM}/api/public/${subPath}${u.search}`;

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
    return res.status(502).send(
      JSON.stringify({
        error: 'upstream_failed',
        url: upstreamUrl,
        detail: String(err),
        cause: err?.cause ? String(err.cause) : null,
        causeCode: err?.cause?.code ?? null,
        causeErrno: err?.cause?.errno ?? null,
      })
    );
  }
}
