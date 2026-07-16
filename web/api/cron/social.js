// Vercel Cron 定时抓社媒声量：X / Reddit / YouTube / Instagram 四平台 ×
// 8 个重点专题近 7 天的高互动帖 → 安全过滤（黄赌毒）→ 写入 Neon →
// MiniMax 批量「翻译（英/日→中）+ 内容审核」补处理。
// 由 vercel.json 的 crons 触发；也可手动访问 /api/cron/social 立即跑一次。
// 需要环境变量 APIFY_TOKEN；SOCIAL_PLATFORMS 可裁剪平台（默认 x,reddit,youtube,instagram）。
import { dbEnabled, getUnprocessedSocial, saveSocialModeration } from '../_db.js';
import { runSocialScrape, hasApifyToken } from '../_social.js';
import { translateAndModerate } from '../_moderation.js';
import { hasMinimaxKey } from '../_minimax.js';

export const config = { maxDuration: 300 };

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }

  if (!dbEnabled()) {
    return res.status(200).json({ ok: false, reason: 'DATABASE_URL 未配置' });
  }

  try {
    const u = new URL(req.url, 'http://x');
    const days = Math.min(parseInt(u.searchParams.get('days') || '7', 10) || 7, 30);
    const maxItems = Math.min(parseInt(u.searchParams.get('max') || '400', 10) || 400, 1200);
    const onlyModerate = u.searchParams.get('moderate') === '1'; // 只跑翻译+审核（不抓新数据）

    let scrape = null;
    if (!onlyModerate) {
      if (!hasApifyToken()) {
        return res.status(200).json({ ok: false, reason: 'APIFY_TOKEN 未配置（Vercel 环境变量里加上后 redeploy）' });
      }
      scrape = await runSocialScrape({ days, maxItems });
    }

    // 翻译 + 审核：处理库里 text_zh 为 null 的（含刚抓的和历史存量）
    let moderation = null;
    if (hasMinimaxKey()) {
      const pending = await getUnprocessedSocial(90);
      if (pending.length) {
        const map = await translateAndModerate(pending);
        const saved = await saveSocialModeration(map);
        const blockedCount = Object.values(map).filter((m) => m.blocked).length;
        moderation = { processed: saved, blocked: blockedCount, pendingBefore: pending.length };
      } else {
        moderation = { processed: 0, blocked: 0, pendingBefore: 0 };
      }
    }

    return res.status(200).json({ ok: true, scrape, moderation });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) });
  }
}
