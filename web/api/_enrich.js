// 富化编排层：翻译（中文）+ 推荐理由 + 亮点 + 配图。
// - applyStoredEnrichment(items)：请求路径用 —— 只查库、零 LLM 调用，把已有富化数据合到条目上。
// - enrichMissingAndPersist(items)：cron 用 / 请求路径后台 fire-and-forget 用 ——
//   为缺翻译/理由/亮点/配图的条目补齐并写库。幂等，可重复调用。
import { dbEnabled, getEnrichment, saveEnrichment, upsertItems } from './_db.js';
import { translateItems, needsTranslation } from './_translate.js';
import { generateInsights } from './_reason.js';
import { fetchImagesFor } from './_media.js';
import { hasMinimaxKey } from './_minimax.js';

// 把库里的富化数据应用到实时条目上（返回新数组，不改原对象）。
// 返回 { items, enrichMap } —— enrichMap 供后续判断哪些还缺。
export async function applyStoredEnrichment(items) {
  if (!dbEnabled() || !items.length) return { items, enrichMap: {} };
  let enrichMap = {};
  try {
    enrichMap = await getEnrichment(items.map((i) => i.url));
  } catch {
    return { items, enrichMap: {} };
  }
  const out = items.map((it) => {
    const e = enrichMap[it.url];
    if (!e) return it;
    const next = { ...it };
    if (e.title_zh) {
      next.title_en = next.title_en || it.title;
      next.title = e.title_zh;
    }
    if (e.summary_zh) next.summary = e.summary_zh;
    if (e.reason) next.reason = e.reason;
    if (e.highlights) next.highlights = e.highlights;
    if (e.image) next.image = e.image; // '' 表示试过没图，不覆盖已有值
    return next;
  });
  return { items: out, enrichMap };
}

let inflight = false; // 同实例内防并发重复富化（多个请求同时打进来时只跑一份）

// items：原始（未富化）条目；enrichMap：applyStoredEnrichment 查到的库内数据。
// light 模式（请求路径后台）限制单次工作量，cron 模式全量补齐。
export async function enrichMissingAndPersist(items, enrichMap = {}, { light = false } = {}) {
  if (!dbEnabled() || !items.length) return { translated: 0, insights: 0, images: 0 };
  if (light && inflight) return { translated: 0, insights: 0, images: 0, skipped: true };
  inflight = true;
  try {
    // 先确保条目本体在库里（新条目要先 insert 才能 update 富化列）
    await upsertItems(items);

    const stats = { translated: 0, insights: 0, images: 0 };
    const enrich = {}; // url → patch

    // 1) 翻译：库里没有 title_zh 且看起来是英文的
    // light 配额给到 5 批（60 条）——覆盖一整屏 take=50，一次访问就能把当前视图补齐
    const needT = items.filter((it) => !enrichMap[it.url]?.title_zh && needsTranslation(it));
    if (needT.length && hasMinimaxKey()) {
      const tMap = await translateItems(needT, { maxBatches: light ? 5 : Infinity });
      for (const [url, t] of Object.entries(tMap)) {
        enrich[url] = { ...(enrich[url] || {}), title_zh: t.title, summary_zh: t.summary };
        stats.translated++;
      }
    }

    // 2) 理由 + 亮点：库里两者都缺的才生成（老数据已有 reason 的只缺 highlights 也会重生成一次，成本可忽略）
    const needI = items.filter((it) => {
      const e = enrichMap[it.url] || {};
      return !e.reason || !e.highlights;
    });
    if (needI.length && hasMinimaxKey()) {
      // 用中文版内容喂给模型（刚翻好的优先）
      const forModel = needI.slice(0, light ? 30 : Infinity).map((it) => {
        const t = enrich[it.url];
        const e = enrichMap[it.url] || {};
        return {
          url: it.url,
          title: t?.title_zh || e.title_zh || it.title,
          summary: t?.summary_zh || e.summary_zh || it.summary,
          source: it.source,
        };
      });
      const iMap = await generateInsights(forModel);
      for (const [url, ins] of Object.entries(iMap)) {
        enrich[url] = { ...(enrich[url] || {}), reason: ins.reason, highlights: ins.highlights };
        stats.insights++;
      }
    }

    // 3) 配图：库里 image 为 null 的（'' 表示试过没图，跳过）
    const needImg = items
      .filter((it) => {
        const e = enrichMap[it.url] || {};
        return e.image === null || e.image === undefined;
      })
      .map((it) => ({ url: it.url, image: it.image ?? null }));
    // HF 等来源自带缩略图，直接采纳，不用抓页面
    const withOwn = items.filter((it) => it.image && !(enrichMap[it.url] || {}).image);
    for (const it of withOwn) {
      enrich[it.url] = { ...(enrich[it.url] || {}), image: it.image };
      stats.images++;
    }
    const ownSet = new Set(withOwn.map((i) => i.url));
    const toFetch = needImg.filter((i) => !ownSet.has(i.url));
    if (toFetch.length) {
      const imgMap = await fetchImagesFor(toFetch, { cap: light ? 8 : 25 });
      for (const [url, img] of Object.entries(imgMap)) {
        enrich[url] = { ...(enrich[url] || {}), image: img };
        if (img) stats.images++;
      }
    }

    await saveEnrichment(enrich);
    return stats;
  } finally {
    inflight = false;
  }
}

// 论文「翻译好才上架」：中午新更新的 arXiv/HF 论文先不进信息流，等后台翻译完成再出现
// （enrichInBackground 收到的是含隐藏条目的全量，翻完下次请求自动上架；9 点 cron 兜底）。
// 超过 24h 仍没翻译的照常展示，防止 MiniMax 挂掉时论文永久消失。
export function hideUntranslatedFreshPapers(items) {
  if (!hasMinimaxKey()) return items; // 没配翻译 key（如本地开发）时永远翻不了，直接原样展示
  const now = Date.now();
  return items.filter((it) => {
    if (it.category !== 'paper' || !needsTranslation(it)) return true;
    const ageH = (now - new Date(it.publishedAt).getTime()) / 3600_000;
    return !(ageH >= 0 && ageH < 24);
  });
}

// 请求路径的后台富化：优先用 Vercel 的 waitUntil 保证响应后继续执行；
// 本地 node 进程常驻，直接 fire-and-forget 即可。
export function enrichInBackground(items, enrichMap) {
  const job = () =>
    enrichMissingAndPersist(items, enrichMap, { light: true }).catch((e) =>
      console.error('[enrich:bg]', e?.message || e)
    );
  import('@vercel/functions')
    .then((m) => (typeof m.waitUntil === 'function' ? m.waitUntil(job()) : job()))
    .catch(() => job());
}
