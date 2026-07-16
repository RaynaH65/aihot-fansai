// Vercel Cron 定时囤货：拉一遍当前全量动态写入 Neon，并补齐富化数据
// （中文翻译 MiniMax / 推荐理由 / 亮点 / 配图）。
// 由 vercel.json 的 crons 触发；也可手动访问 /api/cron/ingest 立即跑一次。
import { buildMergedItems } from '../_feed.js';
import { dbEnabled, dbVar, getBackfillItems } from '../_db.js';
import { applyStoredEnrichment, enrichMissingAndPersist } from '../_enrich.js';

export const config = { maxDuration: 300 };

export default async function handler(req, res) {
  // 若设了 CRON_SECRET，则校验（Vercel Cron 会自动带 Authorization: Bearer <secret>）。
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }

  if (!dbEnabled()) {
    return res.status(200).json({ ok: false, reason: 'DATABASE_URL 未配置，跳过囤货' });
  }

  try {
    // mode=all 抓全量（不只精选），take=100 接近公开 API 的全部当前窗口。
    const params = new URLSearchParams({ mode: 'all', take: '100' });
    const { items } = await buildMergedItems(params);

    const { enrichMap } = await applyStoredEnrichment(items);
    const stats = await enrichMissingAndPersist(items, enrichMap); // 全量补齐（含 upsert）

    // 历史库存量回填：每轮补最多 40 条旧数据的翻译/理由/亮点/配图，几天内逐步清完积压
    let backfill = null;
    try {
      const olds = await getBackfillItems(40);
      const inCurrent = new Set(items.map((i) => i.url));
      const targets = olds.filter((o) => !inCurrent.has(o.url));
      if (targets.length) {
        const bMap = {};
        for (const o of targets) bMap[o.url] = o._enrich;
        backfill = await enrichMissingAndPersist(targets, bMap);
        backfill.scanned = targets.length;
      }
    } catch (e) {
      backfill = { error: String(e?.message || e) };
    }

    return res.status(200).json({
      ok: true,
      dbVar: dbVar(),
      hasMinimaxKey: !!process.env.MINIMAX_API_KEY, // 诊断：函数能否读到 key（不暴露 key 本身）
      fetched: items.length,
      ...stats,
      backfill,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) });
  }
}
