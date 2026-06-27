// Neon (Postgres) 持久层 —— 把抓到的条目囤进自己的库，支持跨全部历史搜索。
// 没配 DATABASE_URL 时全部退化为 no-op，站点行为跟以前完全一样。
import { neon } from '@neondatabase/serverless';

const URL = process.env.DATABASE_URL || '';
const sql = URL ? neon(URL) : null;

export const dbEnabled = () => !!sql;

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
    ingested_at   timestamptz default now()
  )`;
  await sql`create index if not exists items_published_idx on items (published_at desc)`;
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
      insert into items (url, title, title_en, summary, source, category, permalink, published_at, score, selected)
      values (
        ${it.url}, ${it.title || null}, ${it.title_en || null}, ${it.summary || null},
        ${it.source || null}, ${it.category || null}, ${it.permalink || null},
        ${it.publishedAt ? new Date(it.publishedAt) : null}, ${it.score ?? null}, ${it.selected ?? null}
      )
      on conflict (url) do update set
        title    = excluded.title,
        title_en = excluded.title_en,
        summary  = excluded.summary,
        category = excluded.category,
        score    = excluded.score,
        selected = excluded.selected
    `;
    n++;
  }
  return n;
}

// 跨全部历史的关键词搜索（标题或摘要命中）。返回与前端一致的条目结构。
export async function searchItems(q, take = 100) {
  if (!sql || !q) return [];
  await ensureSchema();
  const like = `%${q}%`;
  const rows = await sql`
    select url, title, title_en, summary, source, category, permalink,
           published_at, score, selected
    from items
    where title ilike ${like} or summary ilike ${like}
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
  }));
}
