// 共享取数层：aihot 公开 API + HuggingFace Papers + arXiv RSS 合并、排序、可选翻译。
// 被 api/[...path].js（线上）、api/cron/ingest.js（定时囤货）、proxy/server.js（本地）复用。
import { fetchHFPapers, filterHF } from './_hf.js';
import { fetchArxiv, filterArxiv } from './_arxiv.js';
import { translateItems } from './_translate.js';

const UPSTREAM = 'https://aihot.virxact.com';
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 aihot-fansai/0.1.0';

export async function fetchAihotItems(params) {
  const r = await fetch(`${UPSTREAM}/api/public/items?${params.toString()}`, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
  });
  const body = await r.text();
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    parsed = { count: 0, items: [], hasNext: false };
  }
  return { status: r.status, parsed };
}

// params: URLSearchParams（保留 mode/since/category/take/q 原样透传给上游）
// 返回 { status, parsed, items } —— items 为合并+排序+翻译后的结果
export async function buildMergedItems(params) {
  const [{ status, parsed }, hfAll, arxivAll] = await Promise.all([
    fetchAihotItems(params),
    fetchHFPapers(),
    fetchArxiv(),
  ]);

  const base = Array.isArray(parsed.items) ? parsed.items : [];
  const opts = { since: params.get('since'), q: params.get('q'), category: params.get('category') };
  const extras = [...filterHF(hfAll, opts), ...filterArxiv(arxivAll, opts)];
  const seen = new Set(base.map((i) => i.url));
  const merged = [...base, ...extras.filter((i) => !seen.has(i.url))].sort(
    (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
  );
  const take = parseInt(params.get('take') || '50', 10);
  const items = await translateItems(merged.slice(0, take));
  return { status, parsed, items };
}
