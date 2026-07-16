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

    const started = Date.now();
    let scrape = null;
    if (!onlyModerate) {
      if (!hasApifyToken()) {
        return res.status(200).json({ ok: false, reason: 'APIFY_TOKEN 未配置（Vercel 环境变量里加上后 redeploy）' });
      }
      scrape = await runSocialScrape({ days, maxItems });
    }

    // 翻译 + 审核：小批量循环、逐批落库（函数被掐掉也不丢已完成进度），剩余的下轮继续
    let moderation = null;
    if (hasMinimaxKey()) {
      const budgetMs = (onlyModerate ? 250 : 60) * 1000;
      moderation = { processed: 0, blocked: 0, rounds: 0 };
      while (Date.now() - started < budgetMs) {
        const pending = await getUnprocessedSocial(15);
        if (!pending.length) break;
        const map = await translateAndModerate(pending);
        if (!Object.keys(map).length) break; // MiniMax 异常时避免原地死循环
        moderation.processed += await saveSocialModeration(map);
        moderation.blocked += Object.values(map).filter((m) => m.blocked).length;
        moderation.rounds++;
      }
      moderation.remaining = (await getUnprocessedSocial(1)).length > 0;
    }

    return res.status(200).json({ ok: true, scrape, moderation });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) });
  }
}
