// Neon (Postgres) 持久层 —— 把抓到的条目囤进自己的库，支持跨全部历史搜索。
// 没配 DATABASE_URL 时全部退化为 no-op，站点行为跟以前完全一样。
import { neon } from '@neondatabase/serverless';

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
  schemaReady = true;
}

// 批量 upsert（按 url 去重，重复则更新可变字段）。返回写入条数。
export async function upsertItems(items) {
  if (!sql || !Array.isArray(items) || items.length === 0) return 0;
  await ensureSchema();
  let n = 0;
  for (const it of items) {
    if (!it || !it.url) continue;
    await sql`
      insert into items (url, title, title_en, summary, source, category, permalink, published_at, score, selected, reason)
      values (
        ${it.url}, ${it.title || null}, ${it.title_en || null}, ${it.summary || null},
        ${it.source || null}, ${it.category || null}, ${it.permalink || null},
        ${it.publishedAt ? new Date(it.publishedAt) : null}, ${it.score ?? null}, ${it.selected ?? null},
        ${it.reason || null}
      )
      on conflict (url) do update set
        title    = excluded.title,
        title_en = excluded.title_en,
        summary  = excluded.summary,
        category = excluded.category,
        score    = excluded.score,
        selected = excluded.selected,
        reason   = coalesce(excluded.reason, items.reason)
    `;
    n++;
  }
  return n;
}

// 取一批 url 已有的推荐理由（用于在实时列表里附加理由）。返回 { url: reason }
export async function getReasons(urls) {
  if (!sql || !Array.isArray(urls) || urls.length === 0) return {};
  await ensureSchema();
  const rows = await sql`select url, reason from items where url = any(${urls}) and reason is not null`;
  const map = {};
  for (const r of rows) map[r.url] = r.reason;
  return map;
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
    select url, title, title_en, summary, source, category, permalink,
           published_at, score, selected, reason
    from items
    where title ~* ${regex} or summary ~* ${regex}
    order by published_at desc
    limit ${take}
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
    reason: r.reason || null,
  }));
}
