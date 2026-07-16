// 洞察生成：用 MiniMax 为每条资讯生成 FansAI 视角的「推荐理由」+ 2~3 个「亮点」。
// 公开 API 不提供这些，这里自己生成，结果由调用方持久化到 Neon。
// 需要环境变量 MINIMAX_API_KEY；缺失时返回空对象，不报错。
import { minimaxChat, parseModelJson, hasMinimaxKey } from './_minimax.js';

const BATCH = 15;

// items: [{url,title,summary,category,source}]（title/summary 传中文版本效果最好）
// 返回 { url: { reason, highlights: [string] } }
export async function generateInsights(items) {
  if (!hasMinimaxKey() || !Array.isArray(items) || items.length === 0) return {};

  const out = {};
  for (let start = 0; start < items.length; start += BATCH) {
    const batch = items.slice(start, start + BATCH);
    const payload = batch.map((it, i) => ({
      idx: i,
      title: it.title,
      summary: (it.summary || '').slice(0, 500),
      source: it.source || '',
    }));
    const prompt = `你是 FansAI（专注 AI 原生内容：AI 互动影游、AI 视频、世界模型、AI 音乐、AI 漫画/漫剧等）的资讯编辑。
为下面 ${payload.length} 条 AI 资讯各生成：
1. reason：一句「推荐理由」——点出它为什么值得关注、对行业或对 FansAI 的意义，带判断和观点，不复述摘要。40 字以内，犀利、不空话。
2. highlights：2~3 个「亮点」——从内容里提炼的关键信息点（数字、能力、结论、影响），每个 18 字以内，名词短语或短句，方便扫读。

输入（JSON 数组）：
${JSON.stringify(payload, null, 2)}

输出**仅** JSON 数组，按 idx 一一对应：
[{"idx":0,"reason":"……","highlights":["……","……"]}, ...]
全部中文（专业术语/模型名保留英文）。不要 markdown 代码块，不要解释，直接输出 JSON 数组。`;

    const parsed = parseModelJson(await minimaxChat(prompt, { maxTokens: 6000 }));
    if (!Array.isArray(parsed)) continue;
    for (const entry of parsed) {
      const item = batch[entry.idx];
      if (!item) continue;
      const highlights = Array.isArray(entry.highlights)
        ? entry.highlights.map((h) => String(h).trim()).filter(Boolean).slice(0, 3)
        : null;
      out[item.url] = {
        reason: entry.reason ? String(entry.reason).trim() : null,
        highlights: highlights && highlights.length ? highlights : null,
      };
    }
  }
  return out;
}
