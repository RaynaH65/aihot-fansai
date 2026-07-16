// 社媒声量抓取：X / Reddit / YouTube / Instagram 四平台，按平台顺序、专题并行。
// 需要环境变量 APIFY_TOKEN；缺失时返回 {ok:false}，不报错。
//
// 实测约束（2026-07）：
// - X (apidojo/tweet-scraper)：不支持 "(A OR B)" 括号与 "-filter:"，用 `词 min_faves:N since:日期`；
//   Top 排序必须加 since:，否则返回全时段；多 term 共享 maxItems 会导致排后的 term 饿死 → 每专题独立 run
// - Reddit (harshmaur/reddit-scraper)：站内搜索模糊匹配严重（会混进无关热帖）→ matchesTopic 后置过滤；
//   includeNSFW=false 源头排除 + over18 双保险
// - YouTube (streamers/youtube-scraper)：同样需要 matchesTopic 后置过滤；isAgeRestricted 排除
// - Instagram (apify/instagram-hashtag-scraper)：官方 actor，按 hashtag 抓，无时间过滤 → 查询层按时间截
// - 所有平台再过 keywordBlocked 黑名单；入库后 MiniMax 翻译+审核二次把关（cron 里跑）
import { TOPICS, matchesTopic } from './_topics.js';
import { keywordBlocked } from './_moderation.js';
import { upsertSocialPosts } from './_db.js';

export const hasApifyToken = () => !!process.env.APIFY_TOKEN;

const runSyncUrl = (actor) =>
  `https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?token=${process.env.APIFY_TOKEN}&format=json&timeout=120`;

async function callActor(actor, input, timeoutMs = 150_000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(runSyncUrl(actor), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 200);
      return { error: `apify http ${res.status}: ${detail}` };
    }
    const raw = await res.json();
    return Array.isArray(raw) ? { items: raw } : { error: 'unexpected apify response' };
  } catch (err) {
    return { error: String(err?.message || err) };
  } finally {
    clearTimeout(timer);
  }
}

function sinceDate(days) {
  return new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
}

// ---------- 各平台 scraper：topic → 规整后的帖子数组 ----------

const X_ACTOR = 'apidojo~tweet-scraper';
export function topicSearchTerms(topic, days = 7) {
  const since = sinceDate(days);
  return topic.xTerms.map((x) => `${x} min_faves:${topic.minFaves} since:${since}`);
}

function pickTweetMedia(t) {
  const media = t?.extendedEntities?.media || t?.entities?.media || [];
  const out = [];
  for (const m of media.slice(0, 4)) {
    if (!m) continue;
    if (m.type === 'video' || m.type === 'animated_gif') {
      const variants = (m.video_info?.variants || [])
        .filter((v) => v.content_type === 'video/mp4' && v.url)
        .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
      out.push({ type: 'video', preview: m.media_url_https || null, url: variants[0]?.url || null });
    } else if (m.media_url_https) {
      out.push({ type: 'photo', preview: m.media_url_https, url: m.media_url_https });
    }
  }
  return out.length ? out : null;
}

async function scrapeX(topic, { days, perTopic }) {
  const { items, error } = await callActor(X_ACTOR, {
    searchTerms: topicSearchTerms(topic, days),
    sort: 'Top',
    maxItems: perTopic,
    includeSearchTerms: true,
  });
  if (error) return { error };
  const posts = [];
  for (const t of items) {
    if (!t || t.noResults || !t.id || !t.url) continue;
    if (t.possiblySensitive || t.author?.possiblySensitive) continue; // X 官方敏感标记
    const text = (t.fullText || t.text || '').slice(0, 2000);
    if (keywordBlocked(text, t.author?.name, t.author?.userName)) continue;
    const publishedAt = t.createdAt ? new Date(t.createdAt) : null;
    if (!publishedAt || isNaN(publishedAt.getTime())) continue;
    posts.push({
      id: `x-${t.id}`,
      topic: topic.key,
      platform: 'x',
      url: t.url || t.twitterUrl,
      authorName: t.author?.name || null,
      authorHandle: t.author?.userName || null,
      authorAvatar: t.author?.profilePicture?.replace('_normal.', '_bigger.') || null,
      authorFollowers: t.author?.followers ?? null,
      text,
      lang: t.lang || null,
      publishedAt: publishedAt.toISOString(),
      likes: t.likeCount ?? 0,
      reposts: t.retweetCount ?? 0,
      replies: t.replyCount ?? 0,
      views: t.viewCount ?? 0,
      bookmarks: t.bookmarkCount ?? 0,
      media: pickTweetMedia(t),
    });
  }
  return { posts };
}

const REDDIT_ACTOR = 'harshmaur~reddit-scraper';
async function scrapeReddit(topic, { perTopic }) {
  const { items, error } = await callActor(REDDIT_ACTOR, {
    searchTerms: topic.redditTerms,
    searchPosts: true,
    searchComments: false,
    searchSort: 'top',
    searchTime: 'week',
    includeNSFW: false,
    crawlCommentsPerPost: false,
    maxPostsCount: perTopic,
  });
  if (error) return { error };
  const posts = [];
  for (const r of items) {
    if (!r || r.dataType !== 'post' || !r.id || !r.postUrl) continue;
    if (r.over18) continue;
    const text = [r.title, (r.body || '').slice(0, 800)].filter(Boolean).join('\n');
    if (!matchesTopic(topic, text)) continue; // reddit 搜索模糊，只留真命中的
    if (keywordBlocked(text, r.authorName, r.communityName)) continue;
    const publishedAt = r.createdAt ? new Date(r.createdAt) : null;
    if (!publishedAt || isNaN(publishedAt.getTime())) continue;
    const media = [];
    if (r.videoUrl || r.media?.reddit_video?.fallback_url) {
      media.push({ type: 'video', preview: r.thumbnail || null, url: r.videoUrl || r.media.reddit_video.fallback_url });
    } else if (Array.isArray(r.images) && r.images[0]) {
      media.push({ type: 'photo', preview: r.images[0], url: r.images[0] });
    } else if (r.thumbnail && /^https?:/.test(r.thumbnail)) {
      media.push({ type: 'photo', preview: r.thumbnail, url: r.thumbnail });
    }
    posts.push({
      id: `rd-${r.id}`,
      topic: topic.key,
      platform: 'reddit',
      url: r.postUrl,
      authorName: r.authorName || null,
      authorHandle: r.communityName || null, // reddit 用社区名当第二行
      authorAvatar: null,
      authorFollowers: r.subredditSubscribers ?? null,
      text: text.slice(0, 2000),
      lang: null,
      publishedAt: publishedAt.toISOString(),
      likes: r.upVotes ?? r.score ?? 0,
      reposts: r.numCrossposts ?? 0,
      replies: r.commentsCount ?? 0,
      views: 0,
      bookmarks: 0,
      media: media.length ? media : null,
    });
  }
  return { posts };
}

const YT_ACTOR = 'streamers~youtube-scraper';
async function scrapeYouTube(topic, { perTopic }) {
  const { items, error } = await callActor(YT_ACTOR, {
    searchQueries: topic.ytQueries,
    maxResults: Math.max(5, Math.ceil(perTopic / topic.ytQueries.length)),
    maxResultsShorts: 0,
    sortingOrder: 'relevance',
    dateFilter: 'week',
  });
  if (error) return { error };
  const posts = [];
  for (const v of items) {
    if (!v || v.type !== 'video' || !v.id || !v.url) continue;
    if (v.isAgeRestricted) continue;
    const text = [v.title, (v.text || '').slice(0, 300)].filter(Boolean).join('\n');
    if (!matchesTopic(topic, text)) continue;
    if (keywordBlocked(text, v.channelName)) continue;
    const publishedAt = v.date ? new Date(v.date) : null;
    if (!publishedAt || isNaN(publishedAt.getTime())) continue;
    posts.push({
      id: `yt-${v.id}`,
      topic: topic.key,
      platform: 'youtube',
      url: v.url,
      authorName: v.channelName || null,
      authorHandle: v.channelUsername || null,
      authorAvatar: v.channelAvatarUrl || null,
      authorFollowers: v.numberOfSubscribers ?? null,
      text: [v.title, `⏱ ${v.duration || ''}`].filter(Boolean).join('\n'),
      lang: null,
      publishedAt: publishedAt.toISOString(),
      likes: v.likes ?? 0,
      reposts: 0,
      replies: v.commentsCount ?? 0,
      views: v.viewCount ?? 0,
      bookmarks: 0,
      media: v.thumbnailUrl ? [{ type: 'link-video', preview: v.thumbnailUrl, url: v.url }] : null,
    });
  }
  return { posts };
}

const IG_ACTOR = 'apify~instagram-hashtag-scraper';
async function scrapeInstagram(topic, { perTopic }) {
  if (!topic.igHashtags?.length) return { posts: [] };
  const { items, error } = await callActor(IG_ACTOR, {
    hashtags: topic.igHashtags,
    resultsLimit: Math.max(5, Math.ceil(perTopic / topic.igHashtags.length)),
  });
  if (error) return { error };
  const posts = [];
  for (const g of items) {
    if (!g || !g.id || !g.url) continue;
    const text = (g.caption || '').slice(0, 2000);
    if (keywordBlocked(text, g.ownerUsername, g.ownerFullName)) continue;
    const publishedAt = g.timestamp ? new Date(g.timestamp) : null;
    if (!publishedAt || isNaN(publishedAt.getTime())) continue;
    posts.push({
      id: `ig-${g.id}`,
      topic: topic.key,
      platform: 'instagram',
      url: g.url,
      authorName: g.ownerFullName || g.ownerUsername || null,
      authorHandle: g.ownerUsername || null,
      authorAvatar: null,
      authorFollowers: null,
      text,
      lang: null,
      publishedAt: publishedAt.toISOString(),
      likes: g.likesCount ?? 0,
      reposts: 0,
      replies: g.commentsCount ?? 0,
      views: g.videoViewCount ?? g.videoPlayCount ?? 0,
      bookmarks: 0,
      media: g.displayUrl ? [{ type: g.type === 'Video' ? 'link-video' : 'photo', preview: g.displayUrl, url: g.url }] : null,
    });
  }
  return { posts };
}

const PLATFORMS = {
  x: { scrape: scrapeX, share: 0.4 },
  reddit: { scrape: scrapeReddit, share: 0.2 },
  youtube: { scrape: scrapeYouTube, share: 0.2 },
  instagram: { scrape: scrapeInstagram, share: 0.2 },
};

export function enabledPlatforms() {
  const conf = (process.env.SOCIAL_PLATFORMS || 'x,reddit,youtube,instagram')
    .split(',')
    .map((s) => s.trim())
    .filter((k) => PLATFORMS[k]);
  return conf.length ? conf : ['x'];
}

// 跑一轮全平台×全专题抓取并入库。maxItems 为总预算（按平台 share 分配）。
export async function runSocialScrape({ days = 7, maxItems = 400 } = {}) {
  if (!hasApifyToken()) return { ok: false, reason: 'APIFY_TOKEN 未配置' };

  const platforms = enabledPlatforms();
  const seen = new Set();
  const posts = [];
  const byTopic = {};
  const byPlatform = {};
  const errors = {};

  // 平台间串行（控制 Apify 并发配额），专题间并行
  for (const pk of platforms) {
    const P = PLATFORMS[pk];
    const perTopic = Math.max(6, Math.floor((maxItems * P.share) / TOPICS.length));
    const results = await Promise.all(
      TOPICS.map((t) =>
        P.scrape(t, { days, perTopic }).then((r) => ({ topic: t.key, ...r }))
      )
    );
    for (const r of results) {
      if (r.error) {
        errors[`${pk}:${r.topic}`] = r.error;
        continue;
      }
      for (const p of r.posts) {
        if (seen.has(p.id)) continue;
        seen.add(p.id);
        posts.push(p);
        byTopic[p.topic] = (byTopic[p.topic] || 0) + 1;
        byPlatform[pk] = (byPlatform[pk] || 0) + 1;
      }
    }
  }

  const upserted = await upsertSocialPosts(posts);
  return {
    ok: true,
    platforms,
    normalized: posts.length,
    upserted,
    byPlatform,
    byTopic,
    ...(Object.keys(errors).length ? { errors } : {}),
  };
}
