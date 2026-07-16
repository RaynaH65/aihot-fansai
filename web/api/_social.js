// 社媒声量抓取：调 Apify 的 apidojo/tweet-scraper（Tweet Scraper V2）抓 X 上
// 8 个重点专题的高互动帖，规整后写入 social_posts。
// 需要环境变量 APIFY_TOKEN；缺失时返回 {ok:false}，不报错。
//
// 实测约束（2026-07）：
// - searchTerms 不支持 "(A OR B)" 括号与 "-filter:"，用 `词 min_faves:N since:日期` 一词一条
// - sort=Top 不带时间约束会返回全时段热帖，必须加 since:
// - includeSearchTerms=true 时每条结果带 searchTerm 字段，用它把结果归回专题
import { TOPICS } from './_topics.js';
import { upsertSocialPosts } from './_db.js';

const ACTOR = 'apidojo~tweet-scraper';
const RUN_SYNC_URL = `https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items`;

export const hasApifyToken = () => !!process.env.APIFY_TOKEN;

function sinceDate(days) {
  const d = new Date(Date.now() - days * 86400_000);
  return d.toISOString().slice(0, 10);
}

// 生成单个专题的 searchTerms
export function topicSearchTerms(topic, days = 7) {
  const since = sinceDate(days);
  return topic.xTerms.map((x) => `${x} min_faves:${topic.minFaves} since:${since}`);
}

function pickMedia(tweet) {
  const media = tweet?.extendedEntities?.media || tweet?.entities?.media || [];
  const out = [];
  for (const m of media.slice(0, 4)) {
    if (!m) continue;
    if (m.type === 'video' || m.type === 'animated_gif') {
      const variants = (m.video_info?.variants || [])
        .filter((v) => v.content_type === 'video/mp4' && v.url)
        .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
      out.push({
        type: 'video',
        preview: m.media_url_https || null,
        url: variants[0]?.url || m.media_url_https || null,
      });
    } else if (m.media_url_https) {
      out.push({ type: 'photo', preview: m.media_url_https, url: m.media_url_https });
    }
  }
  return out.length ? out : null;
}

// tweet-scraper 的 createdAt 是 "Tue Mar 24 22:45:35 +0000 2026" 格式，Date 能直接解析
function normalizeTweet(t, topic) {
  if (!t || t.noResults || !t.id || !t.url) return null;
  if (!topic) return null;
  const publishedAt = t.createdAt ? new Date(t.createdAt) : null;
  if (!publishedAt || isNaN(publishedAt.getTime())) return null;
  return {
    id: `x-${t.id}`,
    topic,
    platform: 'x',
    url: t.url || t.twitterUrl,
    authorName: t.author?.name || null,
    authorHandle: t.author?.userName || null,
    authorAvatar: t.author?.profilePicture?.replace('_normal.', '_bigger.') || null,
    authorFollowers: t.author?.followers ?? null,
    text: (t.fullText || t.text || '').slice(0, 2000),
    lang: t.lang || null,
    publishedAt: publishedAt.toISOString(),
    likes: t.likeCount ?? 0,
    reposts: t.retweetCount ?? 0,
    replies: t.replyCount ?? 0,
    views: t.viewCount ?? 0,
    bookmarks: t.bookmarkCount ?? 0,
    media: pickMedia(t),
  };
}

// 跑单个专题的抓取（一次独立 actor run）。
// 实测：actor 按 term 顺序消费全局 maxItems，多专题合并跑会导致排后的专题拿不到配额，
// 所以每个专题单独一跑、并行执行，保证配额均衡。
async function scrapeTopic(topic, { days, perTopic }) {
  const input = {
    searchTerms: topicSearchTerms(topic, days),
    sort: 'Top',
    maxItems: perTopic,
    includeSearchTerms: true,
  };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 150_000);
  try {
    const res = await fetch(`${RUN_SYNC_URL}?token=${process.env.APIFY_TOKEN}&format=json&timeout=120`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 200);
      return { topic: topic.key, error: `apify http ${res.status}: ${detail}` };
    }
    const raw = await res.json();
    if (!Array.isArray(raw)) return { topic: topic.key, error: 'unexpected apify response' };
    const posts = raw.map((t) => normalizeTweet(t, topic.key)).filter(Boolean);
    return { topic: topic.key, fetched: raw.length, posts };
  } catch (err) {
    return { topic: topic.key, error: String(err?.message || err) };
  } finally {
    clearTimeout(timer);
  }
}

// 跑一轮全专题抓取并入库。perTopic 控制成本（$0.4/千条 → 8×30=240 条 ≈ $0.10/轮）。
export async function runSocialScrape({ days = 7, maxItems = 240 } = {}) {
  if (!hasApifyToken()) return { ok: false, reason: 'APIFY_TOKEN 未配置' };

  const perTopic = Math.max(10, Math.floor(maxItems / TOPICS.length));
  const results = await Promise.all(TOPICS.map((t) => scrapeTopic(t, { days, perTopic })));

  // 汇总 + 按 id 去重（同一条推可能命中多个专题，保留第一个归属）
  const seen = new Set();
  const posts = [];
  const byTopic = {};
  const errors = {};
  for (const r of results) {
    if (r.error) {
      errors[r.topic] = r.error;
      continue;
    }
    for (const p of r.posts) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      posts.push(p);
      byTopic[p.topic] = (byTopic[p.topic] || 0) + 1;
    }
  }

  const upserted = await upsertSocialPosts(posts);
  return {
    ok: true,
    normalized: posts.length,
    upserted,
    byTopic,
    ...(Object.keys(errors).length ? { errors } : {}),
  };
}
