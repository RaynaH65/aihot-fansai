// 社媒内容安全：黄赌毒/营销引流过滤 + 外语翻译 + 热度点判断，一次 MiniMax 调用全做。
// 1) keywordBlocked()：关键词黑名单（中/英/日），normalize 时即拦截，命中的根本不入库；
//    读取层（querySocialPosts）也过一遍，黑名单更新对存量立即生效
// 2) translateAndModerate()：逐条审核（含文案干净的擦边导流、卖课营销号）+ 翻译 + why（为什么火）
//
// MOD_VERSION：审核规则版本。改了规则/新增字段就 +1，存量会在 cron 里按版本号自动重跑。
import { minimaxChat, parseModelJson, hasMinimaxKey } from './_minimax.js';

export const MOD_VERSION = 2;

// 黑名单：命中即拦。保持词面具体，避免误伤（如 "sex" 用词边界、中文用完整词）。
const BLOCK_PATTERNS = [
  // 色情（中）
  /色情|涩情|瑟瑟|福利姬|约炮|裸聊|裸播|一夜情|叫床|自慰|催眠调教|风俗娘|无码|有码|里番|本子|工口|黄片|资源群|磁力链/,
  // 色情（英/日）
  /\b(porn|pornhub|nsfw|onlyfans|hentai|nude|nudes|xxx|blowjob|milf|fetish|bdsm|camgirl)\b/i,
  /エロ|全裸|乳首|巨乳|痴女|風俗|援交|セフレ/,
  // 赌博
  /赌场|赌博|博彩|菠菜|百家乐|龙虎斗|六合彩|时时彩|带单|上分|下注|棋牌室|开元棋牌|威尼斯人注册|太阳城集团/,
  /\b(casino|gambling|betting|jackpot|slots?|baccarat|sportsbook)\b/i,
  // 毒品
  /大麻|冰毒|摇头丸|氯胺酮|麻古|叶子烟|飞行员糖果|上头电子烟/,
  /\b(cannabis|marijuana|weed|cocaine|meth|mdma|ketamine|psychedelics?)\b/i,
  // 灰产引流
  /加微信看片|私聊看片|进群看|老司机资源|白嫖资源|翻墙梯子|USDT 带单|USDT带单/,
  // 擦边内容账号/作品的特征词（魔改坊类=成人向魔改二创；良辰共君欢类命名的"香艳短剧"）
  /魔改坊|香艳|深夜福利|涩涩|擦边|里区|良辰共君欢/,
  // 卖课/涨粉营销号的高置信话术（更宽泛的判断交给模型）
  /RT\s*\+\s*comment|comment\s+.{0,12}\s+and\s+I.?ll\s+DM|must\s+follow\s+for\s+dm|评论区扣|私信领取|关注\+点赞|转发抽|留言送/i,
];

// 返回 true = 命中黑名单，应拦截
export function keywordBlocked(...texts) {
  const hay = texts.filter(Boolean).join(' ');
  if (!hay) return false;
  return BLOCK_PATTERNS.some((re) => re.test(hay));
}

// 判断文本是否需要翻译（非中文为主 → 需要）
export function needsZh(s) {
  if (!s) return false;
  const cjk = (s.match(/[一-鿿]/g) || []).length;
  const total = s.replace(/\s+/g, '').length;
  return total >= 8 && cjk / Math.max(total, 1) < 0.35;
}

const BATCH = 12;

// posts: [{id, text, authorName, platform, likes, views, rising}]
// → { id: { zh: string|'', blocked: boolean, why: string|null } }
// zh 为 '' 表示无需翻译（本身是中文）；why = 一句「为什么有热度」的判断。
export async function translateAndModerate(posts) {
  if (!hasMinimaxKey() || !Array.isArray(posts) || posts.length === 0) return {};
  const out = {};
  for (let start = 0; start < posts.length; start += BATCH) {
    const batch = posts.slice(start, start + BATCH);
    const payload = batch.map((p, i) => ({
      idx: i,
      author: (p.authorName || '').slice(0, 40),
      platform: p.platform || 'x',
      likes: p.likes ?? 0,
      views: p.views ?? 0,
      text: (p.text || '').slice(0, 600),
    }));
    const prompt = `你是 FansAI 内部 AI 资讯站的社媒内容处理器。对下面 ${payload.length} 条社媒帖子逐条做三件事：

1. flag：内容审核，取值 "ok" 或 "block"。以下情况标 "block"：
   - 色情/软色情/擦边（含用暧昧标题或"福利"暗示导流的）、赌博/博彩、毒品
   - 纯引流营销：卖课/资料包（"XX课程从入门到精通+链接"）、"关注我领资源"、抽奖涨粉、affiliate 链接堆砌
   正常内容（AI 新闻、作品分享、观点争论、教程干货本身）标 "ok"。判断标准：这条帖的主要目的是内容还是导流。宁可略严。
2. zh：若正文不是中文，翻译成自然流畅的简体中文（保留 @提及、#话题标签、产品名原文）；已是中文返回 ""。
3. why：一句话（≤36字）判断这条帖为什么有热度/传播（结合互动数据推断）：是争议对立、新闻爆点、情绪宣泄、名人效应、实用干货、猎奇画面还是玩梗。写具体，别写"内容有趣"这种空话。被 block 的条目 why 返回 ""。

输入（JSON 数组）：
${JSON.stringify(payload, null, 2)}

输出**仅** JSON 数组，按 idx 一一对应：
[{"idx":0,"flag":"ok","zh":"……","why":"……"}, ...]
不要 markdown 代码块，不要解释。`;

    const parsed = parseModelJson(await minimaxChat(prompt, { maxTokens: 8000 }));
    if (!Array.isArray(parsed)) continue;
    for (const entry of parsed) {
      const p = batch[entry.idx];
      if (!p) continue;
      out[p.id] = {
        // 本身就是中文的帖子不存译文（模型有时会回显），'' = 已处理无需翻译
        zh: needsZh(p.text) && typeof entry.zh === 'string' ? entry.zh.trim() : '',
        blocked: entry.flag === 'block',
        why: typeof entry.why === 'string' && entry.why.trim() ? entry.why.trim().slice(0, 60) : null,
      };
    }
  }
  return out;
}
