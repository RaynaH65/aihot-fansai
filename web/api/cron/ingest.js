// Vercel Cron 定时囤货：拉一遍当前全量动态写入 Neon。
// 由 vercel.json 的 crons 触发；也可手动访问 /api/cron/ingest 立即跑一次。
import { buildMergedItems } from '../_feed.js';
import { upsertItems, dbEnabled, dbVar } from '../_db.js';

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
    const upserted = await upsertItems(items);
    return res.status(200).json({ ok: true, dbVar: dbVar(), fetched: items.length, upserted });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) });
  }
}
