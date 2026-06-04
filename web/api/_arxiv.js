// arXiv RSS 数据源（cs.AI / cs.CL / cs.CV / cs.LG）
// 公开 RSS，无需 key，每天 04:00 UTC 更新
const FEEDS = [
  { key: 'cs.AI', label: '人工智能', url: 'https://rss.arxiv.org/rss/cs.AI' },
  { key: 'cs.CL', label: '计算语言学', url: 'https://rss.arxiv.org/rss/cs.CL' },
  { key: 'cs.CV', label: '计算机视觉', url: 'https://rss.arxiv.org/rss/cs.CV' },
  { key: 'cs.LG', label: '机器学习', url: 'https://rss.arxiv.org/rss/cs.LG' },
];
const UA = 'aihot-fansai/0.1.0';

const TTL_MS = 60 * 60_000; // 1 小时，arxiv 每天更新
let cache = null;

// 极简 XML 取值：从一段 XML 里抓 <tag>...</tag>
function tagText(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
  return m ? m[1].trim() : '';
}
function tagAll(xml, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'g');
  const out = [];
  let m;
  while ((m = re.exec(xml))) out.push(m[1].trim());
  return out;
}

// 把单个 RSS XML 解析成 items
function parseFeed(xml, feedMeta) {
  const items = tagAll(xml, 'item');
  return items
    .map((item) => {
      const announceType = tagText(item, 'arxiv:announce_type');
      if (announceType && announceType !== 'new') return null; // 只要新发布的，不要 cross/replace
      const title = tagText(item, 'title').replace(/\s+/g, ' ').trim();
      const link = tagText(item, 'link');
      const pubDateStr = tagText(item, 'pubDate');
      const description = tagText(item, 'description');
      // 抽 arxiv id
      const idMatch = link.match(/arxiv\.org\/abs\/([\d.]+(?:v\d+)?)/);
      if (!idMatch) return null;
      const arxivId = idMatch[1].replace(/v\d+$/, '');
      // 抽摘要（去掉 "arXiv:XXXX Announce Type: new\nAbstract: " 前缀）
      const abstractMatch = description.match(/Abstract:\s*([\s\S]+)/);
      const summary = abstractMatch
        ? abstractMatch[1].trim().replace(/\s+/g, ' ').slice(0, 600)
        : description.replace(/^arXiv:[^\n]+/, '').trim().slice(0, 600);
      const publishedAt = pubDateStr ? new Date(pubDateStr).toISOString() : new Date().toISOString();
      return {
        id: `arxiv-${arxivId}`,
        title,
        title_en: title,
        url: `https://arxiv.org/abs/${arxivId}`,
        source: `arXiv：${feedMeta.key}（${feedMeta.label}）`,
        publishedAt,
        summary,
        category: 'paper',
        _arxivCat: feedMeta.key,
      };
    })
    .filter(Boolean);
}

export async function fetchArxiv() {
  if (cache && Date.now() - cache.ts < TTL_MS) return cache.items;
  try {
    const responses = await Promise.all(
      FEEDS.map((f) =>
        fetch(f.url, { headers: { 'User-Agent': UA, Accept: 'application/rss+xml' } })
          .then((r) => (r.ok ? r.text() : ''))
          .then((xml) => parseFeed(xml, f))
          .catch(() => [])
      )
    );
    // 按 arxiv id 去重（一篇论文可能在多个 category）
    const seen = new Map();
    for (const arr of responses) {
      for (const item of arr) {
        if (!seen.has(item.id)) seen.set(item.id, item);
      }
    }
    const items = [...seen.values()];
    cache = { ts: Date.now(), items };
    return items;
  } catch {
    return cache?.items || [];
  }
}

// 限制注入数：默认每分类 2 篇 → 总约 6-8 篇；category=paper 时每分类 5 篇 → 约 15-20 篇
export function filterArxiv(items, { since, q, category, perCat = 2 }) {
  if (category && category !== 'paper') return [];
  let out = items;
  if (since) {
    const cutoff = new Date(since).getTime();
    if (!Number.isNaN(cutoff)) out = out.filter((i) => new Date(i.publishedAt).getTime() >= cutoff);
  }
  if (q && q.length >= 2) {
    const needle = q.toLowerCase();
    out = out.filter(
      (i) => i.title.toLowerCase().includes(needle) || i.summary.toLowerCase().includes(needle)
    );
  }
  const cap = category === 'paper' ? 5 : perCat;
  // 按 arxiv 子分类分桶，各取前 cap 条
  const buckets = new Map();
  for (const it of out) {
    const k = it._arxivCat;
    if (!buckets.has(k)) buckets.set(k, []);
    if (buckets.get(k).length < cap) buckets.get(k).push(it);
  }
  return [...buckets.values()].flat().map(({ _arxivCat, ...rest }) => rest);
}
