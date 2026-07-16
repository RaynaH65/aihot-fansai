// Vercel Cron 定时抓社媒声量：Apify (apidojo/tweet-scraper) 抓 X 上
// 8 个重点专题近 7 天的高互动帖 → 规整 → 写入 Neon social_posts。
// 由 vercel.json 的 crons 触发；也可手动访问 /api/cron/social 立即跑一次。
// 需要环境变量 APIFY_TOKEN（Apify 控制台 → Settings → API tokens）。
import { dbEnabled } from '../_db.js';
import { runSocialScrape, hasApifyToken } from '../_social.js';

export const config = { maxDuration: 300 };

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }

  if (!dbEnabled()) {
    return res.status(200).json({ ok: false, reason: 'DATABASE_URL 未配置' });
  }
  if (!hasApifyToken()) {
    return res.status(200).json({ ok: false, reason: 'APIFY_TOKEN 未配置（Vercel 环境变量里加上后 redeploy）' });
  }

  try {
    const u = new URL(req.url, 'http://x');
    const days = Math.min(parseInt(u.searchParams.get('days') || '7', 10) || 7, 30);
    const maxItems = Math.min(parseInt(u.searchParams.get('max') || '240', 10) || 240, 1000);
    const result = await runSocialScrape({ days, maxItems });
    return res.status(result.ok ? 200 : 502).json(result);
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) });
  }
}
