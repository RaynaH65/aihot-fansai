// 翻译模块（可选）：把英文条目（HF/arXiv）批量翻译为中文
// 需要环境变量 ANTHROPIC_API_KEY；缺失时直接 passthrough，不报错
const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-haiku-4-5';
const TTL_MS = 24 * 3600_000; // 24 小时（翻译结果稳定）
const translationCache = new Map(); // key: item.id → { title, summary }

function hasKey() {
  return !!process.env.ANTHROPIC_API_KEY;
}

// 判断是否需要翻译（标题或摘要里有较多英文字母 → 英文内容）
function looksEnglish(s) {
  if (!s) return false;
  const letters = (s.match(/[a-zA-Z]/g) || []).length;
  const cjk = (s.match(/[一-鿿]/g) || []).length;
  return letters > 20 && letters > cjk * 2;
}

export async function translateItems(items) {
  if (!hasKey()) return items;
  if (!items.length) return items;

  // 找出需要翻译且未缓存的
  const need = [];
  for (const it of items) {
    if (!looksEnglish(it.title) && !looksEnglish(it.summary)) continue;
    const cached = translationCache.get(it.id);
    if (cached && Date.now() - cached.ts < TTL_MS) continue;
    need.push(it);
  }

  if (need.length) {
    try {
      const payload = need.map((it, i) => ({
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

      const res = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 4000,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const text = data?.content?.[0]?.text || '';
        const jsonText = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
        const parsed = JSON.parse(jsonText);
        for (const entry of parsed) {
          const item = need[entry.idx];
          if (!item) continue;
          translationCache.set(item.id, {
            ts: Date.now(),
            title: entry.title || item.title,
            summary: entry.summary || item.summary,
          });
        }
      }
    } catch (err) {
      // 翻译失败不影响主流程
      console.error('[translate] error:', err?.message || err);
    }
  }

  // 应用翻译（保留原文到 _en 字段）
  return items.map((it) => {
    const t = translationCache.get(it.id);
    if (!t) return it;
    return {
      ...it,
      title: t.title,
      title_en: it.title,
      summary: t.summary,
      _summary_en: it.summary,
    };
  });
}
