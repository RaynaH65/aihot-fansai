// 推荐理由生成（可选）：用 Claude 为每条资讯写一句 FansAI 视角的「推荐理由」。
// 公开 API 不提供推荐理由，这里自己生成。需要 ANTHROPIC_API_KEY；缺失时返回空，不报错。
// 只为「还没有理由」的条目生成，避免重复花钱。
const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-haiku-4-5';

function hasKey() {
  return !!process.env.ANTHROPIC_API_KEY;
}

// items: [{url,title,summary,category,source}]，返回 { url: reason }
export async function generateReasons(items) {
  if (!hasKey() || !Array.isArray(items) || items.length === 0) return {};

  // 一次最多处理 25 条，过多就分批
  const out = {};
  for (let start = 0; start < items.length; start += 25) {
    const batch = items.slice(start, start + 25);
    const payload = batch.map((it, i) => ({
      idx: i,
      title: it.title,
      summary: (it.summary || '').slice(0, 500),
      source: it.source || '',
    }));
    const prompt = `你是 FansAI（专注 AI 原生内容：AI 互动影游、AI 视频、世界模型、AI 音乐、AI 漫画/漫剧等）的资讯编辑。
为下面 ${payload.length} 条 AI 资讯各写一句「推荐理由」：点出它为什么值得关注、对行业或对 FansAI 的意义，带一点判断和观点，而不是复述摘要。每条 40 字以内，中文，犀利、不空话。

输入（JSON 数组）：
${JSON.stringify(payload, null, 2)}

输出**仅** JSON 数组，按 idx 一一对应：
[{"idx":0,"reason":"……"}, ...]
不要 markdown 代码块，不要解释，直接输出 JSON 数组。`;

    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 2000,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      if (!res.ok) continue;
      const data = await res.json();
      const text = data?.content?.[0]?.text || '';
      const jsonText = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
      const parsed = JSON.parse(jsonText);
      for (const entry of parsed) {
        const item = batch[entry.idx];
        if (item && entry.reason) out[item.url] = String(entry.reason).trim();
      }
    } catch (err) {
      console.error('[reason] error:', err?.message || err);
    }
  }
  return out;
}
