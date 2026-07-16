// 配图抓取：从条目原文页面抓 og:image / twitter:image 作为卡片配图。
// 约定：image 字段 null = 还没试过；'' = 试过但没有图（避免反复重抓）。
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 aihot-fansai/0.1.0';
const FETCH_TIMEOUT_MS = 5000;
const MAX_HTML_BYTES = 200_000; // 只读前 200KB，og 标签都在 <head>

function extractOgImage(html, baseUrl) {
  const patterns = [
    /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::secure_url)?["']/i,
    /<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image(?::src)?["']/i,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m && m[1]) {
      let url = m[1].trim().replace(/&amp;/g, '&');
      if (url.startsWith('//')) url = 'https:' + url;
      if (url.startsWith('/')) {
        try {
          url = new URL(url, baseUrl).href;
        } catch {
          return null;
        }
      }
      if (/^https?:\/\//.test(url)) return url;
    }
  }
  return null;
}

async function fetchOgImage(pageUrl) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(pageUrl, {
      headers: { 'User-Agent': UA, Accept: 'text/html' },
      signal: ctrl.signal,
      redirect: 'follow',
    });
    if (!r.ok || !(r.headers.get('content-type') || '').includes('html')) return '';
    // 只读开头一段，避免大页面拖慢
    const reader = r.body?.getReader?.();
    let html = '';
    if (reader) {
      const decoder = new TextDecoder();
      let bytes = 0;
      while (bytes < MAX_HTML_BYTES) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        html += decoder.decode(value, { stream: true });
        if (html.includes('</head>')) break;
      }
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
    } else {
      html = (await r.text()).slice(0, MAX_HTML_BYTES);
    }
    return extractOgImage(html, pageUrl) || '';
  } catch {
    return ''; // 超时/网络失败也记为「没有图」，下轮 cron 不再重试同一批
  } finally {
    clearTimeout(timer);
  }
}

// 微信公众号等平台的图床有防盗链，抓到也显示不出来，直接跳过
const SKIP_HOSTS = [/mp\.weixin\.qq\.com/, /weibo\.(com|cn)/, /arxiv\.org/];

// items: [{url, image}]，只处理 image == null 的；cap 限制单次抓取数量。
// 返回 { url: imageUrl | '' }
export async function fetchImagesFor(items, { cap = 12 } = {}) {
  const need = items.filter((it) => it.url && (it.image === null || it.image === undefined)).slice(0, cap);
  const out = {};
  await Promise.all(
    need.map(async (it) => {
      if (SKIP_HOSTS.some((re) => re.test(it.url))) {
        out[it.url] = '';
        return;
      }
      out[it.url] = await fetchOgImage(it.url);
    })
  );
  return out;
}
