import { useEffect, useMemo, useRef, useState } from 'react';

// ============ 常量 ============

const MODES = [
  { key: 'selected', label: '精选情报', en: 'SELECTED', subtitle: 'AI 自动挑选的高价值内容' },
  { key: 'all', label: '全部动态', en: 'ALL FEED', subtitle: '过去 7 天所有更新' },
  { key: 'daily', label: 'AI 日报', en: 'DAILY', subtitle: '按分类组织的每日速览' },
];

const CATEGORIES = [
  { key: 'all', label: '全部' },
  { key: 'ai-models', label: '模型' },
  { key: 'ai-products', label: '产品' },
  { key: 'industry', label: '行业' },
  { key: 'paper', label: '论文' },
  { key: 'tip', label: '技巧' },
];

// 「重点关注」专题（关键词用于查资讯历史库；社媒声量由后端按同 key 抓取）
const TOPICS = [
  { key: 't-game', label: 'AI 互动影游', terms: ['互动影游', '互动剧', 'AI 游戏', 'AI游戏', '影游', 'interactive film', 'AI NPC'] },
  { key: 't-video', label: 'AI 视频', terms: ['AI 视频', 'AI视频', '视频生成', 'text-to-video', '文生视频', 'Sora', 'Veo', 'Runway'] },
  { key: 't-world', label: '世界模型', terms: ['世界模型', 'world model', 'world simulator', 'Genie'] },
  { key: 't-vmodel', label: '视频模型', terms: ['视频模型', 'video model', '可灵', 'Kling', '即梦', 'Veo', 'Runway', 'Sora', '海螺'] },
  { key: 't-music', label: 'AI 音乐', terms: ['AI 音乐', 'AI音乐', '音乐生成', 'Suno', 'Udio', '音乐模型', 'text-to-music'] },
  { key: 't-comic', label: 'AI 漫画', terms: ['AI 漫画', 'AI漫画', '漫画生成', 'AI comic', 'webtoon'] },
  { key: 't-drama', label: 'AI 漫剧', terms: ['漫剧', 'AI 短剧', 'AI短剧', '短剧'] },
  { key: 't-dance', label: 'AI 舞蹈', terms: ['AI 舞蹈', 'AI舞蹈', '舞蹈生成', '动作生成', 'motion generation', 'dance'] },
];

const CAT_META = {
  'ai-models': { label: '模型', color: 'var(--color-cat-model)' },
  'ai-products': { label: '产品', color: 'var(--color-cat-product)' },
  industry: { label: '行业', color: 'var(--color-cat-industry)' },
  paper: { label: '论文', color: 'var(--color-cat-paper)' },
  tip: { label: '技巧', color: 'var(--color-cat-tip)' },
};

// ============ 工具 ============

function isoSinceDaysAgo(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 19) + 'Z';
}
function toBeijing(iso) {
  return new Date(new Date(iso).getTime() + 8 * 3600 * 1000);
}
function timeLabel(iso) {
  const b = toBeijing(iso);
  return `${String(b.getUTCHours()).padStart(2, '0')}:${String(b.getUTCMinutes()).padStart(2, '0')}`;
}
function dateGroupKey(iso) {
  const b = toBeijing(iso);
  return `${b.getUTCFullYear()}-${String(b.getUTCMonth() + 1).padStart(2, '0')}-${String(b.getUTCDate()).padStart(2, '0')}`;
}
function dateLabel(key) {
  const [, mm, dd] = key.split('-');
  const now = new Date();
  const todayKey = dateGroupKey(now.toISOString());
  if (key === todayKey) return '今天';
  const yestKey = dateGroupKey(new Date(now.getTime() - 86400000).toISOString());
  if (key === yestKey) return '昨天';
  return `${parseInt(mm)}月${parseInt(dd)}日`;
}
function groupByDate(items) {
  const groups = new Map();
  for (const it of items) {
    const k = dateGroupKey(it.publishedAt);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(it);
  }
  return [...groups.entries()];
}
function fmtNum(n) {
  if (n == null) return '0';
  if (n >= 100000000) return (n / 100000000).toFixed(1) + '亿';
  if (n >= 10000) return (n / 10000).toFixed(1) + '万';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(n);
}
function relTime(iso) {
  if (!iso) return '';
  const h = (Date.now() - new Date(iso).getTime()) / 3600000;
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} 分钟前`;
  if (h < 24) return `${Math.round(h)} 小时前`;
  return `${Math.round(h / 24)} 天前`;
}
// 从条目标题里提一个「产品名感」的词，用于匹配相关社媒帖
function socialQueryFor(item) {
  const src = `${item.title_en || ''} ${item.title || ''}`;
  const m = src.match(/[A-Z][A-Za-z0-9]{2,}(?:\s+[A-Z0-9][A-Za-z0-9]*)?/g) || [];
  const stop = new Set(['The', 'How', 'Why', 'What', 'With', 'From', 'Using', 'Toward', 'Towards', 'And', 'For', 'New', 'This', 'That', 'Record', 'Token', 'Level']);
  const cand = m.filter((w) => !stop.has(w.split(' ')[0]) && w.length >= 4);
  return cand[0] || null;
}

// ============ 原子组件 ============

function Icon({ d, className = 'w-4 h-4', strokeWidth = 1.8 }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      {d.split('|').map((p, i) => <path key={i} d={p} />)}
    </svg>
  );
}
const I = {
  back: 'M15 18l-6-6 6-6',
  chev: 'M6 9l6 6 6-6',
  up: 'M12 19V5|M5 12l7-7 7 7',
  ext: 'M7 17L17 7|M8 7h9v9',
  search: 'M21 21l-4.8-4.8|M10.8 18a7.2 7.2 0 1 0 0-14.4 7.2 7.2 0 0 0 0 14.4z',
  menu: 'M4 7h16|M4 12h16|M4 17h16',
  close: 'M6 6l12 12|M18 6L6 18',
  heart: 'M12 20s-7-4.6-9.2-8.8C1.2 8 3 5 6.2 5c2 0 3.3 1 4.1 2.2h3.4C14.5 6 15.8 5 17.8 5c3.2 0 5 3 3.4 6.2C19 15.4 12 20 12 20z',
  repost: 'M17 2l4 4-4 4|M3 11V9a4 4 0 0 1 4-4h14|M7 22l-4-4 4-4|M21 13v2a4 4 0 0 1-4 4H3',
  reply: 'M21 12a8 8 0 0 1-8 8H4l3-3a8 8 0 1 1 14-5z',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z|M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  flame: 'M12 22c4.4 0 7-2.8 7-6.5 0-2.5-1.4-4.6-3-6.5-.6 1.6-1.6 2.4-2.5 2.5.3-2.8-.8-6-3.5-7.5.3 2-0.4 3.6-1.8 5.2C6.6 11 5 12.9 5 15.5 5 19.2 7.6 22 12 22z',
  trend: 'M3 17l6-6 4 4 8-8|M15 7h6v6',
  play: 'M8 5.5v13l11-6.5z',
  spark: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z|M12 2v2|M12 20v2|M4.9 4.9l1.4 1.4|M17.7 17.7l1.4 1.4|M2 12h2|M20 12h2|M4.9 19.1l1.4-1.4|M17.7 6.3l1.4-1.4',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z',
  auto: 'M4 5h16v11H4z|M9 20h6|M12 16v4',
};

// ---- 主题（auto=跟随系统 / light / dark）----
function useTheme() {
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem('fansai-theme') || 'auto'; } catch { return 'auto'; }
  });
  const [resolved, setResolved] = useState('dark');
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const apply = () => {
      const r = theme === 'auto' ? (mq.matches ? 'light' : 'dark') : theme;
      setResolved(r);
      document.documentElement.dataset.theme = r;
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', r === 'light' ? '#f3f4f8' : '#0b0c10');
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);
  const cycle = () => {
    setTheme((t) => {
      const next = t === 'auto' ? 'light' : t === 'light' ? 'dark' : 'auto';
      try { localStorage.setItem('fansai-theme', next); } catch { /* ignore */ }
      return next;
    });
  };
  return { theme, resolved, cycle };
}

const THEME_META = {
  auto: { icon: 'auto', label: '跟随系统' },
  light: { icon: 'sun', label: '日间模式' },
  dark: { icon: 'moon', label: '夜间模式' },
};

function ThemeToggle({ theme, onCycle, compact = false }) {
  const meta = THEME_META[theme];
  if (compact) {
    return (
      <button
        onClick={onCycle}
        aria-label={`主题：${meta.label}（点按切换）`}
        title={`主题：${meta.label}（点按切换）`}
        className="text-[var(--color-mute)] hover:text-[var(--color-accent)] transition-colors"
      >
        <Icon d={I[meta.icon]} className="w-[18px] h-[18px]" />
      </button>
    );
  }
  return (
    <button
      onClick={onCycle}
      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg border border-[var(--color-line)] text-[var(--color-mute)] hover:text-[var(--color-ink-2)] hover:bg-[var(--color-line-2)] transition-colors"
    >
      <Icon d={I[meta.icon]} className="w-4 h-4" />
      <span className="text-[12px]">{meta.label}</span>
      <span className="ml-auto tape text-[var(--color-mute-2)]">{theme}</span>
    </button>
  );
}

function CatTag({ category, className = '' }) {
  const meta = CAT_META[category];
  if (!meta) return null;
  return (
    <span className={`inline-flex items-center gap-1.5 tape ${className}`} style={{ color: meta.color }}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: meta.color }} />
      {meta.label}
    </span>
  );
}

function Thumb({ src, className, alt = '' }) {
  const [ok, setOk] = useState(true);
  if (!src || !ok) return null;
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setOk(false)}
      className={className}
    />
  );
}

function Highlights({ items, className = '' }) {
  if (!items || !items.length) return null;
  return (
    <div className={`flex flex-wrap gap-x-4 gap-y-1.5 ${className}`}>
      {items.map((h, i) => (
        <span key={i} className="inline-flex items-start gap-1.5 text-[12.5px] leading-relaxed text-[var(--color-ink-2)]">
          <Icon d={I.spark} className="w-3 h-3 mt-1 flex-none text-[var(--color-signal)]" strokeWidth={1.6} />
          {h}
        </span>
      ))}
    </div>
  );
}

function Loading({ text = '加载情报流' }) {
  return (
    <div className="py-20 text-center">
      <span className="tape text-[var(--color-mute)]">
        {text} <span className="cursor-blink text-[var(--color-accent)]">▍</span>
      </span>
    </div>
  );
}

function Empty({ children }) {
  return (
    <div className="py-20 text-center space-y-2">
      <div className="tape text-[var(--color-mute-2)]">NO SIGNAL</div>
      <div className="text-sm text-[var(--color-mute)]">{children}</div>
    </div>
  );
}

// ============ 资讯卡片 ============

function NewsCard({ item, onOpen, dense = false }) {
  return (
    <article
      onClick={() => onOpen(item)}
      className="card-hover group cursor-pointer bg-[var(--color-card)] border border-[var(--color-line)] rounded-xl overflow-hidden"
    >
      {/* 移动端：图在上方通栏 */}
      {item.image && (
        <div className="sm:hidden">
          <Thumb src={item.image} className="w-full aspect-[2/1] object-cover" />
        </div>
      )}
      <div className="px-5 py-4 flex gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-2">
            <CatTag category={item.category} />
            <span className="text-[11px] text-[var(--color-mute-2)] truncate">{item.source}</span>
          </div>
          <h3 className="text-[15.5px] font-semibold leading-snug text-[var(--color-ink)] mb-1.5 group-hover:text-[var(--color-accent)] transition-colors">
            {item.selected && <Icon d={I.spark} className="w-3.5 h-3.5 inline-block mr-1.5 -mt-0.5 text-[var(--color-signal)]" />}
            {item.title}
          </h3>
          {!dense && (
            <p className="text-[13px] text-[var(--color-mute)] leading-relaxed clamp-2 whitespace-pre-line">
              {item.summary}
            </p>
          )}
          <Highlights items={item.highlights} className="mt-2.5" />
          {item.reason && (
            <div className="mt-3 pl-3 border-l-2 border-[var(--color-accent-deep)] text-[12.5px] leading-relaxed text-[var(--color-ink-2)]">
              <span className="tape text-[var(--color-accent)] mr-2">编辑判断</span>
              {item.reason}
            </div>
          )}
        </div>
        {/* 桌面端：右侧缩略图 */}
        {item.image && (
          <div className="hidden sm:block flex-none self-start">
            <Thumb src={item.image} className="w-[124px] h-[86px] object-cover rounded-lg border border-[var(--color-line-2)]" />
          </div>
        )}
      </div>
    </article>
  );
}

function TimelineItem({ item, isLast, onOpen }) {
  return (
    <div className="flex gap-0 sm:gap-5 relative">
      {/* 时间轨（桌面端） */}
      <div className="hidden sm:flex flex-none w-14 flex-col items-end pt-4">
        <span className="tape text-[var(--color-mute-2)] tabular-nums !tracking-[0.08em]">{timeLabel(item.publishedAt)}</span>
      </div>
      <div className="hidden sm:flex flex-none w-3 flex-col items-center">
        <div className={`w-[7px] h-[7px] rounded-full mt-[19px] z-10 ${item.selected ? 'bg-[var(--color-signal)]' : 'bg-[var(--color-accent-deep)]'}`} />
        {!isLast && <div className="w-px flex-1 bg-[var(--color-line-2)] mt-1.5" />}
      </div>
      <div className="flex-1 min-w-0 pb-4">
        <NewsCard item={item} onOpen={onOpen} />
      </div>
    </div>
  );
}

function DateDivider({ k, count, collapsed, onToggle }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="w-full flex items-center gap-3 mb-3 mt-1 sm:pl-[68px] py-1.5 select-none cursor-pointer group"
    >
      <Icon d={I.chev} className={`w-3.5 h-3.5 flex-none text-[var(--color-mute-2)] transition-transform ${collapsed ? '-rotate-90' : ''}`} />
      <span className="text-[15px] masthead font-bold text-[var(--color-ink)]">{dateLabel(k)}</span>
      <span className="tape text-[var(--color-mute-2)]">{k.replaceAll('-', '.')}</span>
      <span className="flex-1 h-px bg-[var(--color-line-2)] group-hover:bg-[var(--color-line)] transition-colors" />
      <span className="tape text-[var(--color-mute-2)]">{count} 条</span>
    </button>
  );
}

// ============ 日报视图 ============

function DailyView({ data, onOpen }) {
  const labelMap = {
    '模型发布/更新': 'ai-models',
    '产品发布/更新': 'ai-products',
    '行业动态': 'industry',
    '论文研究': 'paper',
    '技巧与观点': 'tip',
  };
  return (
    <div className="space-y-10">
      {data.sections.map((s, i) => (
        <section key={i} className="anim-rise" style={{ animationDelay: `${Math.min(i, 8) * 60}ms` }}>
          <div className="flex items-center gap-3 mb-4">
            <CatTag category={labelMap[s.label] || 'tip'} />
            <h2 className="text-[17px] masthead font-bold text-[var(--color-ink)]">{s.label}</h2>
            <span className="flex-1 h-px bg-[var(--color-line-2)]" />
            <span className="tape text-[var(--color-mute-2)]">{s.items.length} 条</span>
          </div>
          <div className="space-y-3">
            {s.items.map((it, idx) => (
              <a
                key={idx}
                href={it.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="card-hover block bg-[var(--color-card)] border border-[var(--color-line)] rounded-xl px-5 py-4"
              >
                <div className="text-[14.5px] font-semibold text-[var(--color-ink)] mb-1">{it.title}</div>
                <p className="text-[13px] text-[var(--color-mute)] leading-relaxed clamp-2 whitespace-pre-line">{it.summary}</p>
                <div className="tape text-[var(--color-mute-2)] mt-2.5 truncate !normal-case !tracking-normal">{it.sourceName}</div>
              </a>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

// ============ 社媒声量 ============

function Metric({ icon, value, hot }) {
  if (value == null || value === 0) return null;
  return (
    <span className={`inline-flex items-center gap-1 ${hot ? 'text-[var(--color-signal)]' : ''}`}>
      <Icon d={icon} className="w-3.5 h-3.5" strokeWidth={1.6} />
      <span className="font-mono text-[11px] tabular-nums">{fmtNum(value)}</span>
    </span>
  );
}

function MediaGrid({ media }) {
  if (!media || !media.length) return null;
  const items = media.slice(0, 2);
  return (
    <div className={`mt-3 grid gap-1.5 ${items.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
      {items.map((m, i) =>
        m.type === 'video' && m.url ? (
          <video
            key={i}
            controls
            preload="none"
            poster={m.preview || undefined}
            src={m.url}
            className="w-full rounded-lg border border-[var(--color-line-2)] bg-black aspect-video object-cover"
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <Thumb key={i} src={m.preview} className={`w-full rounded-lg border border-[var(--color-line-2)] object-cover ${items.length > 1 ? 'aspect-square' : 'max-h-[300px]'}`} />
        )
      )}
    </div>
  );
}

function SocialCard({ post, showTopic = false, rank = null }) {
  const topic = TOPICS.find((t) => t.key === post.topic);
  return (
    <div className="card-hover bg-[var(--color-card)] border border-[var(--color-line)] rounded-xl px-4 py-3.5 flex flex-col">
      <div className="flex items-center gap-2.5 mb-2.5">
        {rank != null && (
          <span className={`font-mono text-[13px] w-5 text-center flex-none ${rank < 3 ? 'text-[var(--color-signal)]' : 'text-[var(--color-mute-2)]'}`}>
            {rank + 1}
          </span>
        )}
        <Thumb src={post.authorAvatar} className="w-8 h-8 rounded-full border border-[var(--color-line)] flex-none" />
        <div className="min-w-0 flex-1 leading-tight">
          <div className="text-[13px] font-semibold text-[var(--color-ink)] truncate">{post.authorName}</div>
          <div className="tape !tracking-[0.06em] text-[var(--color-mute-2)] truncate !normal-case">
            @{post.authorHandle}{post.authorFollowers ? ` · ${fmtNum(post.authorFollowers)} 粉` : ''}
          </div>
        </div>
        {post.rising >= 50 && (
          <span className="flex-none inline-flex items-center gap-1 tape text-[var(--color-signal)] bg-[var(--color-signal-soft)] px-2 py-1 rounded">
            <Icon d={I.trend} className="w-3 h-3" /> 上升
          </span>
        )}
      </div>
      <p className="text-[13px] leading-relaxed text-[var(--color-ink-2)] clamp-4 whitespace-pre-line flex-1">{post.text}</p>
      <MediaGrid media={post.media} />
      <div className="mt-3 flex items-center gap-3.5 text-[var(--color-mute)]">
        <Metric icon={I.heart} value={post.likes} hot={post.likes >= 1000} />
        <Metric icon={I.repost} value={post.reposts} />
        <Metric icon={I.reply} value={post.replies} />
        <Metric icon={I.eye} value={post.views} />
        <span className="ml-auto flex items-center gap-2">
          {showTopic && topic && <span className="tape text-[var(--color-accent)]">{topic.label}</span>}
          <a
            href={post.url}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="tape text-[var(--color-mute-2)] hover:text-[var(--color-accent)] transition-colors inline-flex items-center gap-1"
          >
            {relTime(post.publishedAt)} <Icon d={I.ext} className="w-3 h-3" />
          </a>
        </span>
      </div>
    </div>
  );
}

function SortToggle({ sort, onChange }) {
  return (
    <div className="inline-flex rounded-lg border border-[var(--color-line)] p-0.5 bg-[var(--color-bg-2)]">
      {[
        { k: 'heat', label: '热度', icon: I.flame },
        { k: 'rising', label: '上升', icon: I.trend },
      ].map((o) => (
        <button
          key={o.k}
          onClick={() => onChange(o.k)}
          className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-[12px] transition-colors ${
            sort === o.k ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]' : 'text-[var(--color-mute)] hover:text-[var(--color-ink-2)]'
          }`}
        >
          <Icon d={o.icon} className="w-3.5 h-3.5" /> {o.label}
        </button>
      ))}
    </div>
  );
}

// 专题页顶部的社媒声量条
function SocialStrip({ topicKey }) {
  const [posts, setPosts] = useState(null);
  const [sort, setSort] = useState('heat');
  const [status, setStatus] = useState(null);
  useEffect(() => {
    let cancelled = false;
    setPosts(null);
    fetch(`/api/social?topic=${topicKey}&sort=${sort}&take=6`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        setPosts(d.posts || []);
        setStatus(d);
      })
      .catch(() => !cancelled && setPosts([]));
    return () => { cancelled = true; };
  }, [topicKey, sort]);

  if (posts && posts.length === 0) {
    return (
      <div className="mb-8 rounded-xl border border-dashed border-[var(--color-line)] px-5 py-4">
        <span className="tape text-[var(--color-mute-2)]">
          社媒声量 · {status?.enabled === false || !status?.count ? '数据源就绪后每日自动抓取（需配置 APIFY_TOKEN）' : '该专题近 7 天暂无高互动帖'}
        </span>
      </div>
    );
  }
  return (
    <section className="mb-8">
      <div className="flex items-center gap-3 mb-3.5">
        <Icon d={I.flame} className="w-4 h-4 text-[var(--color-signal)]" />
        <h2 className="text-[15px] masthead font-bold">社媒声量</h2>
        <span className="tape text-[var(--color-mute-2)]">X · 近 7 天</span>
        <span className="flex-1" />
        <SortToggle sort={sort} onChange={setSort} />
      </div>
      {!posts ? (
        <Loading text="扫描声量" />
      ) : (
        <div className="grid sm:grid-cols-2 gap-3">
          {posts.map((p, i) => (
            <div key={p.id} className="anim-rise" style={{ animationDelay: `${Math.min(i, 8) * 50}ms` }}>
              <SocialCard post={p} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// 社媒热榜（全专题）
function SocialBoard() {
  const [posts, setPosts] = useState(null);
  const [sort, setSort] = useState('heat');
  const [topicFilter, setTopicFilter] = useState('all');
  const [status, setStatus] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setPosts(null);
    const t = topicFilter === 'all' ? '' : `&topic=${topicFilter}`;
    fetch(`/api/social?sort=${sort}&take=40${t}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        setPosts(d.posts || []);
        setStatus(d);
      })
      .catch(() => !cancelled && setPosts([]));
    return () => { cancelled = true; };
  }, [sort, topicFilter]);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2.5 mb-5">
        <SortToggle sort={sort} onChange={setSort} />
        <div className="flex items-center gap-1 overflow-x-auto no-scrollbar -mx-1 px-1">
          {[{ key: 'all', label: '全部' }, ...TOPICS].map((t) => (
            <button
              key={t.key}
              onClick={() => setTopicFilter(t.key)}
              className={`flex-none px-2.5 py-1 rounded-md text-[12px] transition-colors ${
                topicFilter === t.key ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]' : 'text-[var(--color-mute)] hover:text-[var(--color-ink-2)]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      {!posts ? (
        <Loading text="扫描全网声量" />
      ) : posts.length === 0 ? (
        <Empty>
          {status?.count ? '该筛选下暂无帖子' : '还没有社媒数据 —— 在 Vercel 配置 APIFY_TOKEN 后访问 /api/cron/social 抓一轮'}
        </Empty>
      ) : (
        <div className="grid sm:grid-cols-2 gap-3">
          {posts.map((p, i) => (
            <div key={p.id} className="anim-rise" style={{ animationDelay: `${Math.min(i, 10) * 40}ms` }}>
              <SocialCard post={p} showTopic rank={i} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============ 详情页 ============

function DetailView({ item, onBack }) {
  const [related, setRelated] = useState(null);
  useEffect(() => {
    let cancelled = false;
    const q = socialQueryFor(item);
    if (!q) { setRelated([]); return; }
    fetch(`/api/social?q=${encodeURIComponent(q)}&take=4`)
      .then((r) => r.json())
      .then((d) => !cancelled && setRelated(d.posts || []))
      .catch(() => !cancelled && setRelated([]));
    return () => { cancelled = true; };
  }, [item]);

  return (
    <div className="anim-rise">
      <button
        type="button"
        onClick={onBack}
        className="mb-6 inline-flex items-center gap-1.5 tape text-[var(--color-mute)] hover:text-[var(--color-accent)] transition-colors"
      >
        <Icon d={I.back} className="w-4 h-4" /> 返回情报流
      </button>

      <div className="flex items-center gap-3 mb-3">
        <CatTag category={item.category} />
        <span className="tape text-[var(--color-mute-2)]">{dateGroupKey(item.publishedAt).replaceAll('-', '.')} {timeLabel(item.publishedAt)}</span>
        <span className="text-[11px] text-[var(--color-mute-2)] truncate">{item.source}</span>
      </div>

      <h1 className="masthead text-[26px] sm:text-[32px] font-bold leading-snug text-[var(--color-ink)] mb-2">
        {item.title}
      </h1>
      {item.title_en && item.title_en !== item.title && (
        <div className="text-[13px] text-[var(--color-mute-2)] mb-5 leading-relaxed">{item.title_en}</div>
      )}

      {item.image && (
        <Thumb src={item.image} className="w-full max-h-[360px] object-cover rounded-xl border border-[var(--color-line)] mb-6" />
      )}

      {item.highlights && item.highlights.length > 0 && (
        <div className="rounded-xl bg-[var(--color-signal-soft)] border border-[rgba(232,180,90,0.2)] px-5 py-4 mb-4">
          <div className="tape text-[var(--color-signal)] mb-2.5">亮点</div>
          <div className="space-y-1.5">
            {item.highlights.map((h, i) => (
              <div key={i} className="flex items-start gap-2.5 text-[14px] leading-relaxed text-[var(--color-ink)]">
                <Icon d={I.spark} className="w-3.5 h-3.5 mt-1 flex-none text-[var(--color-signal)]" />
                {h}
              </div>
            ))}
          </div>
        </div>
      )}

      {item.reason && (
        <div className="rounded-xl bg-[var(--color-accent-soft)] border border-[rgba(141,156,255,0.16)] px-5 py-4 mb-4">
          <div className="tape text-[var(--color-accent)] mb-1.5">编辑判断</div>
          <p className="text-[14px] leading-relaxed text-[var(--color-ink)]">{item.reason}</p>
        </div>
      )}

      <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-card)] px-5 py-4 mb-6">
        <div className="tape text-[var(--color-mute)] mb-2">AI 摘要</div>
        <p className="text-[14.5px] leading-[1.9] text-[var(--color-ink-2)] whitespace-pre-line">
          {item.summary || '（暂无摘要）'}
        </p>
      </div>

      <a
        href={item.url}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-2 text-sm px-5 py-2.5 rounded-lg bg-[var(--color-accent-deep)] text-white hover:bg-[var(--color-accent)] hover:text-[#0b0c10] transition-colors font-medium"
      >
        阅读原文 <Icon d={I.ext} className="w-4 h-4" />
      </a>

      {related && related.length > 0 && (
        <section className="mt-10">
          <div className="flex items-center gap-3 mb-3.5">
            <Icon d={I.flame} className="w-4 h-4 text-[var(--color-signal)]" />
            <h2 className="text-[15px] masthead font-bold">相关声量</h2>
            <span className="tape text-[var(--color-mute-2)]">X 上关于「{socialQueryFor(item)}」的讨论</span>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            {related.map((p) => <SocialCard key={p.id} post={p} showTopic />)}
          </div>
        </section>
      )}
    </div>
  );
}

// ============ 侧栏 / 导航 ============

function NavItem({ active, label, sub, onClick, mono }) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left pl-3 pr-2 py-[7px] rounded-lg text-[13.5px] transition-all flex items-center gap-2.5 group ${
        active
          ? 'bg-[var(--color-accent-soft)] text-[var(--color-ink)]'
          : 'text-[var(--color-mute)] hover:text-[var(--color-ink-2)] hover:bg-[var(--color-line-2)]'
      }`}
    >
      {mono != null && (
        <span className={`font-mono text-[10px] tabular-nums ${active ? 'text-[var(--color-accent)]' : 'text-[var(--color-mute-2)]'}`}>
          {mono}
        </span>
      )}
      <span className="flex-1 truncate">{label}</span>
      {sub && <span className="tape text-[var(--color-mute-2)] group-hover:text-[var(--color-mute)]">{sub}</span>}
      {active && <span className="w-1 h-1 rounded-full bg-[var(--color-accent)] dot-live" />}
    </button>
  );
}

function SidebarContent({ nav, go }) {
  return (
    <>
      <div className="tape text-[var(--color-mute-2)] px-3 pt-1 pb-2">浏览</div>
      {MODES.map((m) => (
        <NavItem
          key={m.key}
          active={nav.view === 'mode' && nav.mode === m.key}
          label={m.label}
          sub={m.en}
          onClick={() => go({ view: 'mode', mode: m.key })}
        />
      ))}
      <div className="tape text-[var(--color-mute-2)] px-3 pt-5 pb-2">重点关注</div>
      {TOPICS.map((t, i) => (
        <NavItem
          key={t.key}
          active={nav.view === 'topic' && nav.topic === t.key}
          label={t.label}
          mono={String(i + 1).padStart(2, '0')}
          onClick={() => go({ view: 'topic', topic: t.key })}
        />
      ))}
      <div className="tape text-[var(--color-mute-2)] px-3 pt-5 pb-2">声量</div>
      <NavItem
        active={nav.view === 'social'}
        label="社媒热榜"
        sub="X"
        onClick={() => go({ view: 'social' })}
      />
    </>
  );
}

// ============ 主应用 ============

export default function App() {
  // nav: {view:'mode',mode} | {view:'topic',topic} | {view:'social'}
  const [nav, setNav] = useState({ view: 'mode', mode: 'selected' });
  const [category, setCategory] = useState('all');
  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [showTop, setShowTop] = useState(false);
  const [selected, setSelected] = useState(null);
  const [drawer, setDrawer] = useState(false);
  const searchRef = useRef(null);
  const { theme, resolved, cycle } = useTheme();
  const logoSrc = resolved === 'light' ? '/logo.svg' : '/logo-dark.svg';

  const go = (next) => {
    setNav(next);
    setSelected(null);
    setDrawer(false);
    setCategory('all');
    setQuery('');
    setSubmittedQuery('');
    window.scrollTo({ top: 0 });
  };

  const toggleDate = (k) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(k) ? next.delete(k) : next.add(k);
      return next;
    });

  useEffect(() => {
    const onScroll = () => setShowTop(window.scrollY > 400);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const activeTopic = nav.view === 'topic' ? TOPICS.find((t) => t.key === nav.topic) : null;
  const mode = nav.view === 'mode' ? nav.mode : 'all';

  // 资讯请求 URL（社媒热榜视图不走这里）
  const url = useMemo(() => {
    if (nav.view === 'social') return null;
    if (nav.view === 'mode' && nav.mode === 'daily') return '/api/daily';
    const q = activeTopic
      ? activeTopic.terms.join('|')
      : submittedQuery && submittedQuery.length >= 2
        ? submittedQuery
        : '';
    const params = new URLSearchParams({
      mode: mode === 'all' ? 'all' : 'selected',
      take: q ? '100' : '50',
    });
    if (!q) params.set('since', isoSinceDaysAgo(7));
    if (!activeTopic && category !== 'all') params.set('category', category);
    if (q) params.set('q', q);
    return `/api/items?${params.toString()}`;
  }, [nav, category, submittedQuery]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!url) { setData(null); setLoading(false); setError(null); return; }
    let cancelled = false;
    setSelected(null);
    setLoading(true);
    setError(null);
    setData(null);
    fetch(url)
      .then((r) => r.json())
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setError(String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [url]);

  const currentMode = MODES.find((m) => m.key === mode);
  const headerLabel =
    nav.view === 'social' ? '社媒热榜' : activeTopic ? activeTopic.label : currentMode?.label;
  const headerEn =
    nav.view === 'social' ? 'SOCIAL RADAR' : activeTopic ? 'FOCUS TOPIC' : currentMode?.en;
  const headerSub =
    nav.view === 'social'
      ? '重点专题在 X 上的高热度 / 高增速内容'
      : activeTopic
        ? `跨全部历史聚合「${activeTopic.label}」相关情报与声量`
        : currentMode?.subtitle;

  const items = data?.items || [];
  const grouped = useMemo(() => groupByDate(items), [items]);
  const latestAt = items[0]?.publishedAt;

  const now = new Date();
  const dateStamp = `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}.${String(now.getDate()).padStart(2, '0')}`;
  const weekday = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][now.getDay()];

  return (
    <div className="min-h-screen flex">
      {/* ---- 桌面侧栏 ---- */}
      <aside className="hidden lg:flex w-[232px] flex-none border-r border-[var(--color-line-2)] bg-[var(--color-bg-2)]/80 backdrop-blur flex-col sticky top-0 h-screen overflow-y-auto">
        <div className="px-5 pt-6 pb-5">
          <div className="flex items-center gap-2.5">
            <img
              src={logoSrc}
              alt="FansAI"
              className="h-[22px] w-auto"
              onError={(e) => {
                e.currentTarget.style.display = 'none';
                e.currentTarget.nextElementSibling.style.display = 'inline';
              }}
            />
            <span style={{ display: 'none' }} className="font-bold tracking-tight text-[17px]">FansAI</span>
            <span className="tape text-[var(--color-mute-2)] border border-[var(--color-line)] rounded px-1.5 py-0.5">内部</span>
          </div>
          <div className="tape text-[var(--color-mute-2)] mt-3 whitespace-nowrap">Intelligence Desk</div>
        </div>
        <nav className="px-3 pb-4 space-y-0.5 flex-1">
          <SidebarContent nav={nav} go={go} />
        </nav>
        <div className="px-4 py-4 border-t border-[var(--color-line-2)] space-y-3">
          <ThemeToggle theme={theme} onCycle={cycle} />
          <div className="px-1 space-y-1.5">
            <a href="https://github.com/RaynaH65/aihot-fansai" target="_blank" rel="noreferrer" className="tape text-[var(--color-mute-2)] hover:text-[var(--color-accent)] transition-colors block">
              GitHub ↗
            </a>
            <div className="tape text-[var(--color-mute-2)]">FANSAI EYES ONLY</div>
          </div>
        </div>
      </aside>

      {/* ---- 移动端顶栏 ---- */}
      <div className="lg:hidden fixed top-0 inset-x-0 z-40 bg-[var(--color-bg)]/85 backdrop-blur border-b border-[var(--color-line-2)]">
        <div className="flex items-center gap-3 px-4 h-[52px]">
          <button onClick={() => setDrawer(true)} aria-label="菜单" className="text-[var(--color-ink-2)]">
            <Icon d={I.menu} className="w-5 h-5" />
          </button>
          <img src={logoSrc} alt="FansAI" className="h-[18px] w-auto" />
          <span className="tape text-[var(--color-mute-2)]">情报局</span>
          <span className="flex-1" />
          <span className="tape text-[var(--color-mute-2)]">{dateStamp}</span>
          <ThemeToggle theme={theme} onCycle={cycle} compact />
        </div>
      </div>

      {/* ---- 移动端抽屉 ---- */}
      {drawer && (
        <div className="lg:hidden fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/60" onClick={() => setDrawer(false)} />
          <div className="absolute left-0 top-0 bottom-0 w-[264px] bg-[var(--color-bg-2)] border-r border-[var(--color-line)] p-4 overflow-y-auto anim-rise">
            <div className="flex items-center justify-between mb-4 px-1">
              <img src={logoSrc} alt="FansAI" className="h-[20px] w-auto" />
              <button onClick={() => setDrawer(false)} aria-label="关闭" className="text-[var(--color-mute)]">
                <Icon d={I.close} className="w-5 h-5" />
              </button>
            </div>
            <nav className="space-y-0.5">
              <SidebarContent nav={nav} go={go} />
            </nav>
          </div>
        </div>
      )}

      {/* ---- 主区 ---- */}
      <main className="flex-1 min-w-0 pt-[52px] lg:pt-0">
        <div className="max-w-[880px] mx-auto px-4 sm:px-8 py-7 sm:py-9">
          {selected ? (
            <DetailView item={selected} onBack={() => setSelected(null)} />
          ) : (
            <>
              {/* 报头 */}
              <header className="mb-7 anim-rise">
                <div className="flex items-baseline justify-between border-b border-[var(--color-line)] pb-1.5 mb-4">
                  <span className="tape text-[var(--color-mute)]">{headerEn}</span>
                  <span className="hidden sm:block tape text-[var(--color-mute-2)]">{dateStamp} {weekday} · 北京时间</span>
                </div>
                <h1 className="masthead text-[30px] sm:text-[38px] font-bold tracking-tight leading-tight">
                  {headerLabel}
                </h1>
                <div className="flex items-center gap-3 mt-1.5">
                  <p className="text-[13px] text-[var(--color-mute)]">{headerSub}</p>
                  {latestAt && (
                    <span className="hidden sm:inline tape text-[var(--color-mute-2)]">
                      LAST SYNC {dateGroupKey(latestAt).slice(5).replace('-', '.')} {timeLabel(latestAt)}
                    </span>
                  )}
                </div>
              </header>

              {/* 专题页：社媒声量条 */}
              {activeTopic && <SocialStrip topicKey={activeTopic.key} />}

              {/* 社媒热榜视图 */}
              {nav.view === 'social' && <SocialBoard />}

              {/* 过滤栏（普通浏览模式） */}
              {nav.view === 'mode' && nav.mode !== 'daily' && (
                <div className="mb-6 flex flex-wrap items-center gap-2 anim-rise" style={{ animationDelay: '80ms' }}>
                  <div className="flex items-center gap-1 overflow-x-auto no-scrollbar -mx-1 px-1">
                    {CATEGORIES.map((c) => (
                      <button
                        key={c.key}
                        onClick={() => setCategory(c.key)}
                        className={`flex-none px-3 py-1.5 rounded-lg text-[13px] transition-colors ${
                          category === c.key
                            ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)] font-medium'
                            : 'text-[var(--color-mute)] hover:text-[var(--color-ink-2)] hover:bg-[var(--color-line-2)]'
                        }`}
                      >
                        {c.label}
                      </button>
                    ))}
                  </div>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      setSubmittedQuery(query.trim());
                    }}
                    className="ml-auto flex items-center gap-2 flex-1 sm:flex-none min-w-[180px]"
                  >
                    <div className="relative flex-1 sm:w-[220px]">
                      <Icon d={I.search} className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-mute-2)]" />
                      <input
                        ref={searchRef}
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="搜索全部历史…"
                        className="w-full text-[13px] pl-8 pr-3 py-1.5 rounded-lg border border-[var(--color-line)] bg-[var(--color-card)] placeholder:text-[var(--color-mute-2)] focus:outline-none focus:border-[var(--color-accent-deep)] transition-colors"
                      />
                    </div>
                    {submittedQuery && (
                      <button
                        type="button"
                        onClick={() => { setQuery(''); setSubmittedQuery(''); }}
                        className="tape text-[var(--color-mute)] hover:text-[var(--color-ink)]"
                      >
                        清除
                      </button>
                    )}
                  </form>
                </div>
              )}

              {loading && <Loading />}
              {error && (
                <div className="py-16 text-center">
                  <div className="tape text-[var(--color-danger)] mb-2">SIGNAL LOST</div>
                  <div className="text-sm text-[var(--color-mute)]">{error}</div>
                  <div className="tape text-[var(--color-mute-2)] mt-2">线上查 Vercel 部署 · 本地查代理 :8787</div>
                </div>
              )}

              {!loading && !error && data && Array.isArray(data.sections) && (
                <DailyView data={data} onOpen={setSelected} />
              )}

              {!loading && !error && data && Array.isArray(data.items) && (
                <div>
                  {items.length === 0 && (
                    <Empty>
                      暂无内容
                      {activeTopic && <span> · 专题「{activeTopic.label}」（历史库攒够后会更多）</span>}
                      {!activeTopic && submittedQuery && <span> · 关键词 "{submittedQuery}"</span>}
                    </Empty>
                  )}
                  {grouped.map(([k, group], gi) => {
                    const isCollapsed = collapsed.has(k);
                    return (
                      <div key={k} className="mb-2 anim-rise" style={{ animationDelay: `${Math.min(gi, 6) * 70}ms` }}>
                        <DateDivider k={k} count={group.length} collapsed={isCollapsed} onToggle={() => toggleDate(k)} />
                        {!isCollapsed &&
                          group.map((it, idx) => (
                            <TimelineItem
                              key={it.id || it.url}
                              item={it}
                              isLast={idx === group.length - 1}
                              onOpen={setSelected}
                            />
                          ))}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </main>

      {/* 返回顶部 */}
      {showTop && (
        <button
          type="button"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          aria-label="返回顶部"
          className="fixed bottom-6 right-5 z-40 w-10 h-10 rounded-full bg-[var(--color-card)] border border-[var(--color-line)] grid place-items-center text-[var(--color-mute)] hover:text-[var(--color-accent)] hover:border-[rgba(141,156,255,0.4)] transition-all shadow-lg"
        >
          <Icon d={I.up} className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}
