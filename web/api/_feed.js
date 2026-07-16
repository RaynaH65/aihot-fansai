// 共享取数层：aihot 公开 API + HuggingFace Papers + arXiv RSS 合并、排序。
// 翻译/理由/亮点/配图等富化不在这里做 —— 见 _enrich.js（请求路径查库应用，cron 补齐）。
// 被 api/[...path].js（线上）、api/cron/ingest.js（定时囤货）、proxy/server.js（本地）复用。
import { fetchHFPapers, filterHF } from './_hf.js';
import { fetchArxiv, filterArxiv } from './_arxiv.js';

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
// 返回 { status, parsed, items } —— items 为合并+排序后的原始结果（未富化）
export async function buildMergedItems(params) {
  const [{ status, parsed }, hfAll, arxivAll] = await Promise.all([
    fetchAihotItems(params),
    fetchHFPapers(),
    fetchArxiv(),
  ]);

  const base = Array.isArray(parsed.items) ? parsed.items : [];
  const opts = {
    since: params.get('since'),
    q: params.get('q'),
    category: params.get('category'),
    mode: params.get('mode') || 'selected',
  };
  const hfItems = filterHF(hfAll, opts);
  // HF 与 arXiv 常是同一篇论文（不同 url）——按标题去重，arXiv 版让位给带缩略图的 HF 版
  const normTitle = (s) => (s || '').toLowerCase().replace(/[^a-z0-9一-鿿]+/g, '');
  const hfTitles = new Set(hfItems.map((i) => normTitle(i.title)));
  const arxivItems = filterArxiv(arxivAll, opts).filter((i) => !hfTitles.has(normTitle(i.title)));
  const extras = [...hfItems, ...arxivItems];
  const seen = new Set(base.map((i) => i.url));
  const merged = [...base, ...extras.filter((i) => !seen.has(i.url))].sort(
    (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
  );
  const take = parseInt(params.get('take') || '50', 10);
  return { status, parsed, items: merged.slice(0, take) };
}
