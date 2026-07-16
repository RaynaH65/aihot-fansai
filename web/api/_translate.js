// 翻译模块：把英文条目（HF/arXiv 论文等）批量翻译为中文。
// 用 MiniMax（env MINIMAX_API_KEY，与推荐理由同一把 key）；缺失时直接 passthrough，不报错。
// 结果由调用方（_enrich.js）持久化到 Neon，这里只留一层进程内缓存兜底。
import { minimaxChat, parseModelJson, hasMinimaxKey } from './_minimax.js';

const TTL_MS = 24 * 3600_000; // 24 小时（翻译结果稳定）
const BATCH = 12; // 单次请求条数，控制时延与输出长度
const translationCache = new Map(); // key: item.url → { ts, title, summary }

// 判断是否需要翻译（标题或摘要里有较多英文字母 → 英文内容）
export function looksEnglish(s) {
  if (!s) return false;
  const letters = (s.match(/[a-zA-Z]/g) || []).length;
  const cjk = (s.match(/[一-鿿]/g) || []).length;
  return letters > 20 && letters > cjk * 2;
}

export function needsTranslation(it) {
  return looksEnglish(it.title) || looksEnglish(it.summary);
}

async function translateBatch(batch) {
  const payload = batch.map((it, i) => ({
    idx: i,
    title: it.title,
    summary: it.summary?.slice(0, 800) || '',
  }));
  const prompt = `把下面 ${payload.length} 条 AI 论文/资讯的英文标题和摘要翻译成中文。保留专业术语（如 "Transformer"、"RLHF"、"LLM"、模型名称等）。摘要要简洁、自然流畅，不超过原文长度。

输入（JSON 数组）：
${JSON.stringify(payload, null, 2)}

输出**仅** JSON 数组，格式严格如下，按 idx 一一对应：
[{"idx":0,"title":"中文标题","summary":"中文摘要"}, ...]

不要加 markdown 代码块标记，不要解释，直接输出 JSON 数组。`;

  const parsed = parseModelJson(await minimaxChat(prompt, { maxTokens: 6000 }));
  if (!Array.isArray(parsed)) return;
  for (const entry of parsed) {
    const item = batch[entry.idx];
    if (!item) continue;
    translationCache.set(item.url, {
      ts: Date.now(),
      title: entry.title || item.title,
      summary: entry.summary || item.summary,
    });
  }
}

// 为一批条目生成翻译，返回 { url: {title, summary} }（只含成功翻译的）。
// maxBatches 用于限制单次调用的时延（请求路径传 1-2，cron 传 Infinity）。
export async function translateItems(items, { maxBatches = Infinity } = {}) {
  const out = {};
  if (!items.length) return out;

  const need = [];
  for (const it of items) {
    if (!needsTranslation(it)) continue;
    const cached = translationCache.get(it.url);
    if (cached && Date.now() - cached.ts < TTL_MS) continue;
    need.push(it);
  }

  if (need.length && hasMinimaxKey()) {
    const batches = [];
    for (let i = 0; i < need.length; i += BATCH) batches.push(need.slice(i, i + BATCH));
    for (const b of batches.slice(0, maxBatches)) {
      await translateBatch(b);
    }
  }

  for (const it of items) {
    const t = translationCache.get(it.url);
    if (t) out[it.url] = { title: t.title, summary: t.summary };
  }
  return out;
}
