// Vercel Cron 定时抓社媒声量：X / Reddit / YouTube / Instagram 四平台 ×
// 8 个重点专题近 7 天的高互动帖 → 安全过滤（黄赌毒/营销引流）→ 写入 Neon →
// MiniMax 批量「翻译 + 审核 + 热度点判断」→ 热点聚类（今日热点）。
// 由 vercel.json 的 crons 触发；也可手动访问：
//   /api/cron/social            全流程
//   /api/cron/social?moderate=1 只跑翻译审核（清存量）
//   /api/cron/social?stories=1  只重算热点聚类
// 需要环境变量 APIFY_TOKEN；SOCIAL_PLATFORMS 可裁剪平台（默认 x,reddit,youtube,instagram）。
import { dbEnabled, getUnprocessedSocial, saveSocialModeration } from '../_db.js';
import { runSocialScrape, hasApifyToken } from '../_social.js';
import { translateAndModerate, MOD_VERSION } from '../_moderation.js';
import { rebuildStories } from '../_stories.js';
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
    const onlyModerate = u.searchParams.get('moderate') === '1';
    const onlyStories = u.searchParams.get('stories') === '1';

    const started = Date.now();

    if (onlyStories) {
      const stories = await rebuildStories();
      return res.status(200).json({ ok: true, stories });
    }

    let scrape = null;
    if (!onlyModerate) {
      if (!hasApifyToken()) {
        return res.status(200).json({ ok: false, reason: 'APIFY_TOKEN 未配置（Vercel 环境变量里加上后 redeploy）' });
      }
      scrape = await runSocialScrape({ days, maxItems });
    }

    // 翻译 + 审核 + 热度点：小批量循环、逐批落库（函数被掐掉也不丢已完成进度），剩余的下轮继续
    let moderation = null;
    if (hasMinimaxKey()) {
      const budgetMs = (onlyModerate ? 240 : 60) * 1000;
      moderation = { processed: 0, blocked: 0, rounds: 0 };
      while (Date.now() - started < budgetMs) {
        const pending = await getUnprocessedSocial(15, MOD_VERSION);
        if (!pending.length) break;
        const map = await translateAndModerate(pending);
        if (!Object.keys(map).length) break; // MiniMax 异常时避免原地死循环
        moderation.processed += await saveSocialModeration(map, MOD_VERSION);
        moderation.blocked += Object.values(map).filter((m) => m.blocked).length;
        moderation.rounds++;
      }
      moderation.remaining = (await getUnprocessedSocial(1, MOD_VERSION)).length > 0;

      // 审核清完且还有时间预算 → 顺手重算热点聚类
      if (!moderation.remaining && Date.now() - started < 250_000) {
        moderation.stories = await rebuildStories();
      }
    }

    return res.status(200).json({ ok: true, scrape, moderation });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) });
  }
}
