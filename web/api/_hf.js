// HuggingFace Daily Papers 数据源
// 公开 API：https://huggingface.co/api/daily_papers — 免 key、无 CORS（服务端调）
// 把 HF schema 映射到 aihot items schema，让前端无感
const HF_URL = 'https://huggingface.co/api/daily_papers';
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 aihot-fansai/0.1.0';

const TTL_MS = 30 * 60_000; // 30 分钟，HF 每天更新
// 注入到时间轴的上限：默认 5 条，只挑 upvotes 最高的，避免 50 篇一次性涌入挤掉其他内容
const DEFAULT_MAX = 5;
let cache = null;

export async function fetchHFPapers() {
  if (cache && Date.now() - cache.ts < TTL_MS) return cache.items;
  try {
    const r = await fetch(HF_URL, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
    if (!r.ok) return cache?.items || [];
    const arr = await r.json();
    const items = arr
      .filter((entry) => entry?.paper?.id && entry?.paper?.title)
      .map((entry) => {
        const p = entry.paper;
        return {
          id: `hf-${p.id}`,
          title: p.title,
          title_en: p.title,
          url: `https://huggingface.co/papers/${p.id}`,
          source: 'HuggingFace Daily Papers（社区热门论文）',
          publishedAt: p.submittedOnDailyAt || p.publishedAt || entry.publishedAt,
          summary: p.ai_summary || p.summary || entry.summary || '',
          category: 'paper',
          _upvotes: p.upvotes ?? 0, // 内部用：排序
        };
      });
    cache = { ts: Date.now(), items };
    return items;
  } catch {
    return cache?.items || [];
  }
}

// 按用户请求的 since / q / category 过滤，并限制最大注入条数（按 upvotes 排序取 top）
export function filterHF(items, { since, q, category, max = DEFAULT_MAX }) {
  let out = items;
  if (category && category !== 'paper') return []; // 显式过滤了别的分类，HF 不出现
  if (since) {
    const cutoff = new Date(since).getTime();
    if (!Number.isNaN(cutoff)) out = out.filter((i) => new Date(i.publishedAt).getTime() >= cutoff);
  }
  if (q && q.length >= 2) {
    const needle = q.toLowerCase();
    out = out.filter(
      (i) =>
        i.title.toLowerCase().includes(needle) ||
        (i.summary && i.summary.toLowerCase().includes(needle))
    );
  }
  // category=paper 时给更多（10 条），否则用默认 max
  const cap = category === 'paper' ? Math.max(max, 10) : max;
  return out
    .slice()
    .sort((a, b) => (b._upvotes ?? 0) - (a._upvotes ?? 0))
    .slice(0, cap)
    .map(({ _upvotes, ...rest }) => rest); // 去掉内部字段
}
