// Neon (Postgres) 持久层 —— 把抓到的条目囤进自己的库，支持跨全部历史搜索。
// 没配 DATABASE_URL 时全部退化为 no-op，站点行为跟以前完全一样。
import { neon } from '@neondatabase/serverless';
import { keywordBlocked } from './_moderation.js';

// Vercel 的 Neon / Postgres 集成可能用不同的变量名注入连接串，挨个认一遍。
const CANDIDATES = [
  'DATABASE_URL',
  'POSTGRES_URL',
  'POSTGRES_PRISMA_URL',
  'DATABASE_URL_UNPOOLED',
  'POSTGRES_URL_NON_POOLING',
  'NEON_DATABASE_URL',
];
const VAR = CANDIDATES.find((k) => process.env[k]);
const URL = (VAR && process.env[VAR]) || '';
const sql = URL ? neon(URL) : null;

export const dbEnabled = () => !!sql;
export const dbVar = () => VAR || null; // 调试用：实际命中的变量名

let schemaReady = false;
async function ensureSchema() {
  if (schemaReady || !sql) return;
  await sql`create table if not exists items (
    url           text primary key,
    title         text,
    title_en      text,
    summary       text,
    source        text,
    category      text,
    permalink     text,
    published_at  timestamptz,
    score         integer,
    selected      boolean,
    reason        text,
    ingested_at   timestamptz default now()
  )`;
  await sql`create index if not exists items_published_idx on items (published_at desc)`;
  // 兼容已存在的旧表：补列（已存在则忽略）
  await sql`alter table items add column if not exists reason text`;
  await sql`alter table items add column if not exists title_zh text`;
  await sql`alter table items add column if not exists summary_zh text`;
  await sql`alter table items add column if not exists highlights jsonb`;
  await sql`alter table items add column if not exists image text`;

  // 社媒声量表（Apify 抓 X 等平台的高互动帖）
  await sql`create table if not exists social_posts (
    id            text primary key,
    topic         text,
    platform      text default 'x',
    url           text,
    author_name   text,
    author_handle text,
    author_avatar text,
    author_followers bigint,
    text_content  text,
    lang          text,
    published_at  timestamptz,
    likes         bigint default 0,
    reposts       bigint default 0,
    replies       bigint default 0,
    views         bigint default 0,
    bookmarks     bigint default 0,
    prev_likes    bigint,
    prev_views    bigint,
    prev_fetched_at timestamptz,
    media         jsonb,
    first_seen_at timestamptz default now(),
    fetched_at    timestamptz default now()
  )`;
  await sql`create index if not exists social_topic_idx on social_posts (topic, published_at desc)`;
  // 兼容旧表补列：中文翻译（''=已处理无需翻译，null=待处理）+ 内容安全拦截标记
  await sql`alter table social_posts add column if not exists text_zh text`;
  await sql`alter table social_posts add column if not exists blocked boolean default false`;
  schemaReady = true;
}

// 批量 upsert（按 url 去重，重复则更新可变字段；富化字段用 coalesce 保留旧值）。返回写入条数。
export async function upsertItems(items) {
  if (!sql || !Array.isArray(items) || items.length === 0) return 0;
  await ensureSchema();
  let n = 0;
  for (const it of items) {
    if (!it || !it.url) continue;
    await sql`
      insert into items (url, title, title_en, summary, source, category, permalink, published_at, score, selected, reason, title_zh, summary_zh, highlights, image)
      values (
        ${it.url}, ${it.title || null}, ${it.title_en || null}, ${it.summary || null},
        ${it.source || null}, ${it.category || null}, ${it.permalink || null},
        ${it.publishedAt ? new Date(it.publishedAt) : null}, ${it.score ?? null}, ${it.selected ?? null},
        ${it.reason || null}, ${it.title_zh || null}, ${it.summary_zh || null},
        ${it.highlights ? JSON.stringify(it.highlights) : null}, ${it.image ?? null}
      )
      on conflict (url) do update set
        title      = excluded.title,
        title_en   = excluded.title_en,
        summary    = excluded.summary,
        category   = excluded.category,
        score      = excluded.score,
        selected   = excluded.selected,
        reason     = coalesce(excluded.reason, items.reason),
        title_zh   = coalesce(excluded.title_zh, items.title_zh),
        summary_zh = coalesce(excluded.summary_zh, items.summary_zh),
        highlights = coalesce(excluded.highlights, items.highlights),
        image      = coalesce(excluded.image, items.image)
    `;
    n++;
  }
  return n;
}

// 只写富化字段（翻译/理由/亮点/配图），不动原始内容。enrich: { url: {title_zh?, summary_zh?, reason?, highlights?, image?} }
export async function saveEnrichment(enrich) {
  if (!sql) return 0;
  const entries = Object.entries(enrich || {}).filter(([, v]) => v);
  if (!entries.length) return 0;
  await ensureSchema();
  let n = 0;
  for (const [url, e] of entries) {
    await sql`
      update items set
        title_zh   = coalesce(${e.title_zh || null}, title_zh),
        summary_zh = coalesce(${e.summary_zh || null}, summary_zh),
        reason     = coalesce(${e.reason || null}, reason),
        highlights = coalesce(${e.highlights ? JSON.stringify(e.highlights) : null}, highlights),
        image      = coalesce(${e.image ?? null}, image)
      where url = ${url}
    `;
    n++;
  }
  return n;
}

// 取一批 url 的富化数据（翻译/理由/亮点/配图），用于在实时列表里附加。
// 返回 { url: {title_zh, summary_zh, reason, highlights, image} }
export async function getEnrichment(urls) {
  if (!sql || !Array.isArray(urls) || urls.length === 0) return {};
  await ensureSchema();
  const rows = await sql`
    select url, title_zh, summary_zh, reason, highlights, image
    from items where url = any(${urls})
  `;
  const map = {};
  for (const r of rows) {
    map[r.url] = {
      title_zh: r.title_zh,
      summary_zh: r.summary_zh,
      reason: r.reason,
      highlights: r.highlights,
      image: r.image,
    };
  }
  return map;
}

function rowToItem(r) {
  return {
    url: r.url,
    title: r.title_zh || r.title,
    title_en: r.title_en || (r.title_zh ? r.title : null),
    summary: r.summary_zh || r.summary,
    source: r.source,
    category: r.category,
    permalink: r.permalink,
    publishedAt: r.published_at ? new Date(r.published_at).toISOString() : null,
    score: r.score,
    selected: r.selected,
    reason: r.reason || null,
    highlights: r.highlights || null,
    image: r.image || null,
  };
}

// 跨全部历史的关键词搜索（标题或摘要命中）。
// q 支持用 "|" 分隔多个关键词做 OR（用于「重点关注」专题聚合）。
// 返回与前端一致的条目结构。
export async function searchItems(q, take = 100) {
  if (!sql || !q) return [];
  await ensureSchema();
  // 拆成多个词做 OR；每个词转义正则元字符，再用 | 连成正则交给 Postgres ~*（大小写不敏感、子串匹配，中文可用）
  const terms = String(q)
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean);
  if (terms.length === 0) return [];
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // 英文/ASCII 词加整词边界（\m..\M），避免 "Udio" 命中 "Studio"；中文按子串匹配。
  const isAscii = (s) => /^[\x00-\x7f]+$/.test(s);
  const regex = terms
    .map((t) => (isAscii(t) ? `\\m${esc(t)}\\M` : esc(t)))
    .join('|');
  const rows = await sql`
    select url, title, title_en, title_zh, summary, summary_zh, source, category, permalink,
           published_at, score, selected, reason, highlights, image
    from items
    where title ~* ${regex} or summary ~* ${regex} or title_zh ~* ${regex} or summary_zh ~* ${regex}
    order by published_at desc
    limit ${take}
  `;
  return rows.map(rowToItem);
}

// 挑一批还缺富化数据的历史条目（翻译/理由/亮点/配图任一缺失），给 cron 回填用。
// 返回「原始条目」形状 + 附带 _enrich（当前库内富化状态）。
export async function getBackfillItems(limit = 40) {
  if (!sql) return [];
  await ensureSchema();
  const rows = await sql`
    select url, title, title_en, summary, source, category, permalink, published_at, score, selected,
           title_zh, summary_zh, reason, highlights, image
    from items
    where (title_zh is null and title ~ '[A-Za-z]{4}')
       or highlights is null
       or reason is null
       or image is null
    order by published_at desc
    limit ${limit}
  `;
  return rows.map((r) => ({
    url: r.url,
    title: r.title,
    title_en: r.title_en,
    summary: r.summary,
    source: r.source,
    category: r.category,
    permalink: r.permalink,
    publishedAt: r.published_at ? new Date(r.published_at).toISOString() : null,
    score: r.score,
    selected: r.selected,
    image: r.image,
    _enrich: {
      title_zh: r.title_zh,
      summary_zh: r.summary_zh,
      reason: r.reason,
      highlights: r.highlights,
      image: r.image,
    },
  }));
}

// ---------- 社媒声量 ----------

// 批量 upsert 社媒帖子；重复时把旧指标滚动进 prev_*，用于计算增长。
export async function upsertSocialPosts(posts) {
  if (!sql || !Array.isArray(posts) || posts.length === 0) return 0;
  await ensureSchema();
  let n = 0;
  for (const p of posts) {
    if (!p || !p.id) continue;
    await sql`
      insert into social_posts (id, topic, platform, url, author_name, author_handle, author_avatar, author_followers,
                                text_content, lang, published_at, likes, reposts, replies, views, bookmarks, media, blocked, fetched_at)
      values (
        ${p.id}, ${p.topic || null}, ${p.platform || 'x'}, ${p.url || null},
        ${p.authorName || null}, ${p.authorHandle || null}, ${p.authorAvatar || null}, ${p.authorFollowers ?? null},
        ${p.text || null}, ${p.lang || null}, ${p.publishedAt ? new Date(p.publishedAt) : null},
        ${p.likes ?? 0}, ${p.reposts ?? 0}, ${p.replies ?? 0}, ${p.views ?? 0}, ${p.bookmarks ?? 0},
        ${p.media ? JSON.stringify(p.media) : null}, ${p.blocked ?? false}, now()
      )
      on conflict (id) do update set
        prev_likes      = social_posts.likes,
        prev_views      = social_posts.views,
        prev_fetched_at = social_posts.fetched_at,
        likes     = excluded.likes,
        reposts   = excluded.reposts,
        replies   = excluded.replies,
        views     = excluded.views,
        bookmarks = excluded.bookmarks,
        author_followers = excluded.author_followers,
        media     = coalesce(excluded.media, social_posts.media),
        blocked   = social_posts.blocked or excluded.blocked,
        fetched_at = now()
    `;
    n++;
  }
  return n;
}

// 查社媒帖子：按专题/平台/关键词，近 N 天，带热度与增速评分。已拦截（blocked）的不出。
// 读取层再过一遍关键词黑名单（防线三）：黑名单更新后对历史存量立即生效，不用等重新审核。
// sort: 'heat'（总热度）| 'rising'（上升快）
export async function querySocialPosts({ topic, platform, q, sort = 'heat', days = 7, take = 30 } = {}) {
  if (!sql) return [];
  await ensureSchema();
  const since = new Date(Date.now() - days * 86400_000);
  const pf = platform || null;
  let rows;
  if (topic) {
    rows = await sql`
      select * from social_posts
      where topic = ${topic} and published_at >= ${since}
        and coalesce(blocked, false) = false
        and (${pf}::text is null or platform = ${pf})
      order by published_at desc limit 400
    `;
  } else if (q) {
    const esc = q.replace(/[%_\\]/g, '\\$&');
    rows = await sql`
      select * from social_posts
      where (text_content ilike ${'%' + esc + '%'} or text_zh ilike ${'%' + esc + '%'})
        and published_at >= ${since}
        and coalesce(blocked, false) = false
        and (${pf}::text is null or platform = ${pf})
      order by published_at desc limit 400
    `;
  } else {
    rows = await sql`
      select * from social_posts
      where published_at >= ${since}
        and coalesce(blocked, false) = false
        and (${pf}::text is null or platform = ${pf})
      order by published_at desc limit 800
    `;
  }

  const now = Date.now();
  const visible = rows.filter(
    (r) => !keywordBlocked(r.text_content, r.text_zh, r.author_name, r.author_handle)
  );
  const posts = visible.map((r) => {
    const likes = Number(r.likes) || 0;
    const reposts = Number(r.reposts) || 0;
    const replies = Number(r.replies) || 0;
    const views = Number(r.views) || 0;
    const bookmarks = Number(r.bookmarks) || 0;
    const heat = likes + 2 * reposts + replies + 2 * bookmarks + views / 500;
    const ageH = Math.max((now - new Date(r.published_at).getTime()) / 3600_000, 6);
    let rising = heat / ageH; // 互动速度：每小时热度
    // 抓过两次的帖子用真实增量（likes/views 每小时增长）替代估算
    if (r.prev_fetched_at && r.prev_likes != null) {
      const dtH = Math.max((new Date(r.fetched_at).getTime() - new Date(r.prev_fetched_at).getTime()) / 3600_000, 0.5);
      const dLikes = likes - Number(r.prev_likes || 0);
      const dViews = views - Number(r.prev_views || 0);
      rising = Math.max(rising, (dLikes + dViews / 500) / dtH);
    }
    return {
      id: r.id,
      topic: r.topic,
      platform: r.platform,
      url: r.url,
      authorName: r.author_name,
      authorHandle: r.author_handle,
      authorAvatar: r.author_avatar,
      authorFollowers: r.author_followers != null ? Number(r.author_followers) : null,
      text: r.text_content,
      textZh: r.text_zh || null, // ''（无需翻译）归一成 null，前端直接判空
      lang: r.lang,
      publishedAt: r.published_at ? new Date(r.published_at).toISOString() : null,
      likes, reposts, replies, views, bookmarks,
      media: r.media || null,
      heat: Math.round(heat),
      rising: Math.round(rising * 10) / 10,
    };
  });

  posts.sort((a, b) => (sort === 'rising' ? b.rising - a.rising : b.heat - a.heat));
  return posts.slice(0, take);
}

// 取一批还没做「翻译+审核」的帖子（text_zh 为 null 即未处理；''=已处理无需翻译）
export async function getUnprocessedSocial(limit = 80) {
  if (!sql) return [];
  await ensureSchema();
  const rows = await sql`
    select id, text_content, author_name from social_posts
    where text_zh is null
    order by fetched_at desc
    limit ${limit}
  `;
  return rows.map((r) => ({ id: r.id, text: r.text_content, authorName: r.author_name }));
}

// 写回翻译+审核结果。map: { id: { zh, blocked } }
export async function saveSocialModeration(map) {
  if (!sql) return 0;
  const entries = Object.entries(map || {});
  if (!entries.length) return 0;
  await ensureSchema();
  let n = 0;
  for (const [id, m] of entries) {
    await sql`
      update social_posts set
        text_zh = ${m.zh ?? ''},
        blocked = blocked or ${!!m.blocked}
      where id = ${id}
    `;
    n++;
  }
  return n;
}

// 社媒库整体状态（前端用来提示「还没抓过/上次抓取时间」）
export async function socialStatus() {
  if (!sql) return { enabled: false, count: 0, lastFetchedAt: null };
  await ensureSchema();
  const [row] = await sql`select count(*)::int as count, max(fetched_at) as last from social_posts`;
  return {
    enabled: true,
    count: row?.count || 0,
    lastFetchedAt: row?.last ? new Date(row.last).toISOString() : null,
  };
}
