// MiniMax 文本生成的最小客户端 —— _translate.js / _reason.js 共用。
// 需要环境变量 MINIMAX_API_KEY；缺失时调用方各自退化为 no-op。
// 端点可用 MINIMAX_BASE_URL 覆盖（默认 api.minimaxi.chat；若 key 属于 minimaxi.com 平台则配成 https://api.minimaxi.com）
const BASE = (process.env.MINIMAX_BASE_URL || 'https://api.minimaxi.chat').replace(/\/$/, '');
const API_URL = `${BASE}/v1/text/chatcompletion_v2`;
const MODEL = process.env.MINIMAX_MODEL || 'MiniMax-Text-01';

export const hasMinimaxKey = () => !!process.env.MINIMAX_API_KEY;

// 发一轮对话，返回纯文本（失败返回 null，不抛错）
export async function minimaxChat(prompt, { maxTokens = 4000 } = {}) {
  if (!hasMinimaxKey()) return null;
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${process.env.MINIMAX_API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) {
      console.error('[minimax] http', res.status);
      return null;
    }
    const data = await res.json();
    if (data?.base_resp && data.base_resp.status_code !== 0) {
      console.error('[minimax] error:', data.base_resp.status_msg);
      return null;
    }
    return data?.choices?.[0]?.message?.content || null;
  } catch (err) {
    console.error('[minimax] fetch error:', err?.message || err);
    return null;
  }
}

// 从模型输出里剥出 JSON（容忍 ```json 代码块包裹）并解析；失败返回 null
export function parseModelJson(text) {
  if (!text) return null;
  const jsonText = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  try {
    return JSON.parse(jsonText);
  } catch {
    // 再救一次：截取第一个 [ 到最后一个 ] 之间的内容
    const start = jsonText.indexOf('[');
    const end = jsonText.lastIndexOf(']');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(jsonText.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}
