// 热点聚类：把近 7 天讨论「同一事件/同一争论」的社媒帖归组成「今日热点」，
// 解决热榜信息堆积的问题（比如 Suno 被黑会有 N 条重复帖 → 归成一个热点，
// 点开看：源头帖 / 热度最高 / 上升最快 / 其他观点）。
// 每轮 cron 用 MiniMax 重算一次，结果存 social_stories 表（latest 单行）。
import { minimaxChat, parseModelJson, hasMinimaxKey } from './_minimax.js';
import { querySocialPosts, saveStories, getStories, getSocialPostsByIds } from './_db.js';
import { TOPICS } from './_topics.js';

// 用可见的高热度帖跑一次聚类并入库。返回统计。
export async function rebuildStories() {
  if (!hasMinimaxKey()) return { ok: false, reason: 'MINIMAX_API_KEY 未配置' };

  // 取全专题近 7 天按热度前 110 条（querySocialPosts 已做黑名单/相关性过滤）
  const posts = await querySocialPosts({ sort: 'heat', days: 7, take: 110 });
  if (posts.length < 4) return { ok: true, stories: 0, reason: '可用帖子太少' };

  const payload = posts.map((p, i) => ({
    idx: i,
    topic: TOPICS.find((t) => t.key === p.topic)?.label || p.topic,
    platform: p.platform,
    likes: p.likes,
    views: p.views,
    at: (p.publishedAt || '').slice(0, 10),
    text: (p.textZh || p.text || '').slice(0, 180),
  }));

  const prompt = `你是 FansAI 的社媒情报分析师。下面是近 7 天 AI 内容赛道的高热度社媒帖。请把**明显在讨论同一事件 / 同一争论**的帖子归组成「热点」。

规则：
- 只归并真正同一事件/同一话题争论的（如"Suno 被黑客攻击"的多条报道与评论算一组）；不确定就不要归组
- 每组 ≥2 条；输出 3~8 个热点，按重要性排序
- title：热点标题，≤18 字，事件本身（如"Suno 遭黑客入侵泄源码"）
- summary：≤70 字，讲清楚发生了什么 + 为什么值得 FansAI 关注（判断口吻，不复述）
- idxs：属于该热点的帖子 idx 列表

输入（JSON 数组）：
${JSON.stringify(payload)}

输出**仅** JSON 数组：
[{"title":"……","summary":"……","idxs":[0,5,12]}, ...]
不要 markdown 代码块，不要解释。`;

  const parsed = parseModelJson(await minimaxChat(prompt, { maxTokens: 4000 }));
  if (!Array.isArray(parsed)) return { ok: false, reason: 'minimax 聚类输出解析失败' };

  const stories = [];
  for (const s of parsed) {
    if (!s || !s.title || !Array.isArray(s.idxs)) continue;
    const ids = [...new Set(s.idxs.map((i) => posts[i]?.id).filter(Boolean))];
    if (ids.length < 2) continue;
    const members = ids.map((id) => posts.find((p) => p.id === id)).filter(Boolean);
    const totalHeat = members.reduce((acc, p) => acc + (p.heat || 0), 0);
    stories.push({
      title: String(s.title).slice(0, 30),
      summary: String(s.summary || '').slice(0, 120),
      ids,
      totalHeat: Math.round(totalHeat),
      topics: [...new Set(members.map((p) => p.topic))],
      platforms: [...new Set(members.map((p) => p.platform))],
    });
  }
  stories.sort((a, b) => b.totalHeat - a.totalHeat);
  await saveStories(stories);
  return { ok: true, stories: stories.length, clustered: stories.reduce((a, s) => a + s.ids.length, 0) };
}

// 读取热点（带成员帖 + 角色标注：源头 / 热度最高 / 上升最快）
export async function readStories() {
  const { stories, updatedAt } = await getStories();
  const out = [];
  for (const s of stories) {
    const posts = await getSocialPostsByIds(s.ids);
    if (posts.length < 1) continue;
    const byTime = [...posts].sort((a, b) => new Date(a.publishedAt) - new Date(b.publishedAt));
    const byHeat = [...posts].sort((a, b) => b.heat - a.heat);
    const byRising = [...posts].sort((a, b) => b.rising - a.rising);
    const roles = {};
    const addRole = (id, role) => {
      roles[id] = roles[id] || [];
      roles[id].push(role);
    };
    if (byTime[0]) addRole(byTime[0].id, '源头');
    if (byHeat[0]) addRole(byHeat[0].id, '热度最高');
    if (byRising[0] && byRising[0].rising >= 30) addRole(byRising[0].id, '上升最快');
    out.push({
      title: s.title,
      summary: s.summary,
      totalHeat: s.totalHeat,
      topics: s.topics,
      platforms: s.platforms,
      posts: byHeat.map((p) => ({ ...p, roles: roles[p.id] || [] })),
    });
  }
  return { stories: out, updatedAt };
}
