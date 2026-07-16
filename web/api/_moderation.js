// 社媒内容安全：黄赌毒过滤 + 外语翻译，两层防线。
// 1) keywordBlocked()：关键词黑名单（中/英/日），normalize 时即拦截，命中的根本不入库
// 2) translateAndModerate()：MiniMax 逐条审核 + 翻译（处理关键词漏网的软色情/擦边内容，
//    比如靠视频画面吸引但文案干净的帖子，模型能从上下文识别大部分）
import { minimaxChat, parseModelJson, hasMinimaxKey } from './_minimax.js';

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

const BATCH = 15;

// posts: [{id, text, authorName}] → { id: { zh: string|'' , blocked: boolean } }
// zh 为 '' 表示无需翻译（本身是中文）；blocked=true 表示模型判定涉黄赌毒/引流。
export async function translateAndModerate(posts) {
  if (!hasMinimaxKey() || !Array.isArray(posts) || posts.length === 0) return {};
  const out = {};
  for (let start = 0; start < posts.length; start += BATCH) {
    const batch = posts.slice(start, start + BATCH);
    const payload = batch.map((p, i) => ({
      idx: i,
      author: (p.authorName || '').slice(0, 40),
      text: (p.text || '').slice(0, 600),
    }));
    const prompt = `你是 FansAI 内部 AI 资讯站的社媒内容处理器。对下面 ${payload.length} 条社媒帖子逐条做两件事：

1. flag：内容审核。若帖子涉及 色情/软色情/擦边（含用暧昧标题或"福利"暗示导流的）、赌博/博彩、毒品、或纯引流广告（加群看片/带单/资源群类），标 "block"；正常内容（包括正常讨论 AI、批评、新闻、作品分享）标 "ok"。宁可略严：明显在打擦边球的标 "block"。
2. zh：若正文不是中文，翻译成自然流畅的简体中文（保留 @提及、#话题标签、产品名原文）；若已是中文，返回空字符串 ""。

输入（JSON 数组）：
${JSON.stringify(payload, null, 2)}

输出**仅** JSON 数组，按 idx 一一对应：
[{"idx":0,"flag":"ok","zh":"……"}, ...]
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
      };
    }
  }
  return out;
}
