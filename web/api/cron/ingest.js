// Vercel Cron 定时囤货：拉一遍当前全量动态写入 Neon。
// 由 vercel.json 的 crons 触发；也可手动访问 /api/cron/ingest 立即跑一次。
import { buildMergedItems } from '../_feed.js';
import { upsertItems, dbEnabled, dbVar, getReasons } from '../_db.js';
import { generateReasons } from '../_reason.js';

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

    // 为「还没有推荐理由」的条目生成理由（有 ANTHROPIC_API_KEY 才会真生成）
    const existing = await getReasons(items.map((i) => i.url));
    const need = items.filter((i) => !existing[i.url]);
    const generated = await generateReasons(need);
    for (const it of items) {
      it.reason = generated[it.url] || existing[it.url] || null;
    }

    const upserted = await upsertItems(items);
    return res.status(200).json({
      ok: true,
      dbVar: dbVar(),
      fetched: items.length,
      upserted,
      reasonsGenerated: Object.keys(generated).length,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) });
  }
}
