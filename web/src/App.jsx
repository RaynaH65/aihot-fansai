import { useEffect, useMemo, useState } from 'react';

const MODES = [
  { key: 'selected', label: '精选', subtitle: 'AI 自动挑选的高价值内容' },
  { key: 'all', label: '全部 AI 动态', subtitle: '过去 7 天所有更新' },
  { key: 'daily', label: 'AI 日报', subtitle: '按分类组织的每日速览' },
];

const CATEGORIES = [
  { key: 'all', label: '全部' },
  { key: 'ai-models', label: '模型' },
  { key: 'ai-products', label: '产品' },
  { key: 'industry', label: '行业' },
  { key: 'paper', label: '论文' },
  { key: 'tip', label: '技巧' },
];

// 「重点关注」专题：FansAI 关心的 AI 原生内容方向。
// 每个专题 = 一组关键词，后端对历史库做 OR 聚合（title/summary 命中即收）。
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
  'ai-models': { label: '模型', fg: 'var(--color-cat-model)', bg: 'var(--color-cat-model-bg)' },
  'ai-products': { label: '产品', fg: 'var(--color-cat-product)', bg: 'var(--color-cat-product-bg)' },
  industry: { label: '行业', fg: 'var(--color-cat-industry)', bg: 'var(--color-cat-industry-bg)' },
  paper: { label: '论文', fg: 'var(--color-cat-paper)', bg: 'var(--color-cat-paper-bg)' },
  tip: { label: '技巧', fg: 'var(--color-cat-tip)', bg: 'var(--color-cat-tip-bg)' },
};

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
  const today = new Date();
  const tBJ = toBeijing(today.toISOString());
  const todayKey = `${tBJ.getUTCFullYear()}-${String(tBJ.getUTCMonth() + 1).padStart(2, '0')}-${String(tBJ.getUTCDate()).padStart(2, '0')}`;
  if (key === todayKey) return '今天';
  const yest = new Date(today.getTime() - 86400000);
  const yBJ = toBeijing(yest.toISOString());
  const yestKey = `${yBJ.getUTCFullYear()}-${String(yBJ.getUTCMonth() + 1).padStart(2, '0')}-${String(yBJ.getUTCDate()).padStart(2, '0')}`;
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

function CategoryPill({ category }) {
  const meta = CAT_META[category];
  if (!meta) return null;
  return (
    <span
      className="inline-flex items-center text-[11px] px-2 py-0.5 rounded font-medium"
      style={{ color: meta.fg, backgroundColor: meta.bg }}
    >
      {meta.label}
    </span>
  );
}

function TimelineItem({ item, isFirst, isLast, onOpen }) {
  return (
    <div className="flex gap-5 relative">
      {/* 时间 + 圆点 + 竖线 */}
      <div className="flex-none w-16 flex flex-col items-end pt-5 relative">
        <span className="text-xs font-mono tabular-nums text-[var(--color-mute)]">
          {timeLabel(item.publishedAt)}
        </span>
      </div>
      <div className="flex-none w-3 flex flex-col items-center relative">
        {!isFirst && <div className="w-px h-5 bg-[var(--color-line)]" />}
        <div className="w-2.5 h-2.5 rounded-full bg-[var(--color-card)] border-2 border-[var(--color-accent)] mt-1.5 z-10" />
        {!isLast && <div className="w-px flex-1 bg-[var(--color-line)] mt-1.5" />}
      </div>
      {/* 卡片（点击打开详情） */}
      <div className="flex-1 min-w-0 pb-6">
        <article
          onClick={() => onOpen(item)}
          className="cursor-pointer bg-[var(--color-card)] border border-[var(--color-line)] rounded-xl px-5 py-4 hover:shadow-sm hover:border-[var(--color-accent-soft)] transition-all"
        >
          <div className="text-xs text-[var(--color-mute)] mb-2 truncate">{item.source}</div>
          <h3 className="text-[16px] font-semibold leading-snug text-[var(--color-ink)] mb-2">
            {item.title}
          </h3>
          <p className="text-[13.5px] text-[var(--color-ink-2)] leading-relaxed line-clamp-4 whitespace-pre-line">
            {item.summary}
          </p>
          {item.reason && (
            <div className="mt-3 rounded-lg bg-[var(--color-accent-soft)] px-3 py-2 text-[13px] leading-relaxed text-[var(--color-ink-2)]">
              <span className="font-semibold text-[var(--color-accent)]">推荐理由：</span>
              {item.reason}
            </div>
          )}
          <div className="mt-3 flex items-center gap-2">
            <CategoryPill category={item.category} />
            <a
              href={item.url}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="ml-auto text-[11px] text-[var(--color-mute-2)] hover:text-[var(--color-accent)] truncate max-w-[200px]"
            >
              原文 ↗
            </a>
          </div>
        </article>
      </div>
    </div>
  );
}

// #4 详情页（二级页面）：复用已有中文摘要 + 推荐理由，不重复翻译；底部给原文链接。
function DetailView({ item, onBack }) {
  return (
    <div>
      <button
        type="button"
        onClick={onBack}
        className="mb-5 inline-flex items-center gap-1.5 text-sm text-[var(--color-mute)] hover:text-[var(--color-accent)]"
      >
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        返回
      </button>

      <div className="text-xs text-[var(--color-mute)] mb-2">{item.source}</div>
      <h1
        className="text-[26px] font-bold leading-snug text-[var(--color-ink)] mb-2"
        style={{ fontFamily: 'var(--font-serif)' }}
      >
        {item.title}
      </h1>
      <div className="flex items-center gap-3 text-xs text-[var(--color-mute)] mb-5">
        <CategoryPill category={item.category} />
        <span className="tabular-nums">
          {dateGroupKey(item.publishedAt)} {timeLabel(item.publishedAt)}
        </span>
      </div>

      {item.reason && (
        <div className="rounded-xl bg-[var(--color-accent-soft)] px-4 py-3 mb-4">
          <div className="text-xs font-semibold text-[var(--color-accent)] mb-1">推荐理由</div>
          <p className="text-[14px] leading-relaxed text-[var(--color-ink-2)]">{item.reason}</p>
        </div>
      )}

      <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-card)] px-4 py-3 mb-5">
        <div className="text-xs font-semibold text-[var(--color-mute)] mb-1">AI 摘要</div>
        <p className="text-[15px] leading-[1.85] text-[var(--color-ink)] whitespace-pre-line">
          {item.summary || '（暂无摘要）'}
        </p>
      </div>

      {item.title_en && (
        <div className="text-[13px] text-[var(--color-mute)] mb-5">
          原标题：<span className="text-[var(--color-ink-2)]">{item.title_en}</span>
        </div>
      )}

      <a
        href={item.url}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg bg-[var(--color-accent)] text-white hover:opacity-90"
      >
        阅读原文 ↗
      </a>
    </div>
  );
}

function DateDivider({ k, count, collapsed, onToggle }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="w-full flex items-center gap-3 my-1 pl-[88px] py-1 select-none cursor-pointer rounded hover:bg-[var(--color-line-2)]/60 transition-colors"
    >
      <svg
        className={`w-4 h-4 flex-none text-[var(--color-mute-2)] transition-transform ${collapsed ? '-rotate-90' : ''}`}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
      >
        <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <h3 className="text-sm font-semibold text-[var(--color-ink-2)]">{dateLabel(k)}</h3>
      <span className="text-xs text-[var(--color-mute-2)] tabular-nums">{k}</span>
      <span className="text-xs text-[var(--color-mute-2)]">· {count} 条</span>
    </button>
  );
}

function DailyView({ data }) {
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
        <section key={i}>
          <div className="flex items-baseline gap-3 mb-4 pl-1">
            <CategoryPill category={labelMap[s.label] || 'tip'} />
            <h2 className="text-base font-semibold text-[var(--color-ink)]">{s.label}</h2>
            <span className="text-xs text-[var(--color-mute-2)] tabular-nums">{s.items.length} 条</span>
          </div>
          <div className="space-y-3">
            {s.items.map((it, idx) => (
              <a
                key={idx}
                href={it.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="block bg-[var(--color-card)] border border-[var(--color-line)] rounded-xl px-5 py-4 hover:shadow-sm hover:border-[var(--color-accent-soft)] transition-all"
              >
                <div className="text-[15px] font-semibold text-[var(--color-ink)] mb-1 hover:text-[var(--color-accent)]">
                  {it.title}
                </div>
                <p className="text-[13.5px] text-[var(--color-ink-2)] leading-relaxed line-clamp-3 whitespace-pre-line">
                  {it.summary}
                </p>
                <div className="text-xs text-[var(--color-mute)] mt-2 truncate">{it.sourceName}</div>
              </a>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function SidebarItem({ active, label, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors flex items-center gap-2 ${
        active
          ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)] font-medium'
          : 'text-[var(--color-ink-2)] hover:bg-[var(--color-line-2)]'
      }`}
    >
      <span className={`w-1 h-4 rounded-full ${active ? 'bg-[var(--color-accent)]' : 'bg-transparent'}`} />
      {label}
    </button>
  );
}

export default function App() {
  const [mode, setMode] = useState('selected');
  const [category, setCategory] = useState('all');
  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [showTop, setShowTop] = useState(false);
  const [topic, setTopic] = useState(null); // #5 重点关注专题 key
  const [selected, setSelected] = useState(null); // #4 详情页打开的条目

  const toggleDate = (k) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(k) ? next.delete(k) : next.add(k);
      return next;
    });

  // 下滑超过一屏时显示「返回顶部」（页面是 window 级滚动）
  useEffect(() => {
    const onScroll = () => setShowTop(window.scrollY > 400);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const url = useMemo(() => {
    const activeTopic = TOPICS.find((t) => t.key === topic);
    if (mode === 'daily' && !activeTopic) return '/api/daily';
    // 专题用关键词 OR 聚合；否则用搜索框关键词
    const q = activeTopic
      ? activeTopic.terms.join('|')
      : submittedQuery && submittedQuery.length >= 2
        ? submittedQuery
        : '';
    const params = new URLSearchParams({
      mode: mode === 'all' ? 'all' : 'selected',
      take: q ? '100' : '50',
    });
    // 有关键词（专题/搜索）时不限时间窗口 → 查自有历史库（可跨 30 天+）；平时只看过去 7 天。
    if (!q) params.set('since', isoSinceDaysAgo(7));
    if (!activeTopic && category !== 'all') params.set('category', category);
    if (q) params.set('q', q);
    return `/api/items?${params.toString()}`;
  }, [mode, category, submittedQuery, topic]);

  useEffect(() => {
    let cancelled = false;
    setSelected(null); // 切换导航/搜索时关闭详情页
    setLoading(true);
    setError(null);
    setData(null);
    fetch(url)
      .then((r) => r.json())
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setError(String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [url]);

  const currentMode = MODES.find((m) => m.key === mode);
  const activeTopic = TOPICS.find((t) => t.key === topic);
  const headerLabel = activeTopic ? activeTopic.label : currentMode?.label;
  const headerSub = activeTopic
    ? `重点关注 · 跨全部历史聚合「${activeTopic.label}」相关动态`
    : currentMode?.subtitle;
  const items = data?.items || [];
  const grouped = useMemo(() => groupByDate(items), [items]);

  return (
    <div className="min-h-screen flex">
      {/* 左侧栏（sticky，滚动时保持可见） */}
      <aside className="w-56 flex-none border-r border-[var(--color-line)] bg-[var(--color-card)] flex flex-col sticky top-0 h-screen self-start overflow-y-auto">
        <div className="px-5 py-5 border-b border-[var(--color-line-2)]">
          {/* logo 来自 web/public/logo.svg —— 用真正的 FansAI logo 覆盖该文件即可 */}
          <div className="flex items-center gap-2.5">
            <img
              src="/logo.svg"
              alt="FansAI"
              className="h-7 w-auto"
              onError={(e) => {
                e.currentTarget.style.display = 'none';
                e.currentTarget.nextElementSibling.style.display = 'block';
              }}
            />
            <span
              style={{ display: 'none' }}
              className="font-bold tracking-tight text-[var(--color-ink)] text-[17px]"
            >
              FansAI
            </span>
            <span className="text-[10px] text-[var(--color-mute)] tracking-[0.15em] uppercase">内部</span>
          </div>
        </div>
        <nav className="px-3 py-4 space-y-1">
          {MODES.map((m) => (
            <SidebarItem
              key={m.key}
              active={mode === m.key && !topic}
              label={m.label}
              onClick={() => {
                setMode(m.key);
                setTopic(null);
              }}
            />
          ))}

          {/* #5 重点关注专题 */}
          <div className="px-3 pt-4 pb-1 text-[11px] font-semibold text-[var(--color-mute)] tracking-wide">
            重点关注
          </div>
          {TOPICS.map((t) => (
            <SidebarItem
              key={t.key}
              active={topic === t.key}
              label={t.label}
              onClick={() => {
                setTopic(t.key);
                setCategory('all');
                setQuery('');
                setSubmittedQuery('');
                if (mode === 'daily') setMode('all');
                window.scrollTo({ top: 0 });
              }}
            />
          ))}

          <div className="h-px bg-[var(--color-line-2)] my-3" />
          <a
            href="https://github.com/RaynaH65/aihot-fansai"
            target="_blank"
            rel="noreferrer"
            className="block w-full text-left px-3 py-2 rounded-lg text-sm text-[var(--color-mute)] hover:bg-[var(--color-line-2)]"
          >
            GitHub ↗
          </a>
        </nav>
        <div className="mt-auto px-5 py-4 text-[11px] text-[var(--color-mute-2)] leading-relaxed border-t border-[var(--color-line-2)]">
          FansAI 内部速览
        </div>
      </aside>

      {/* 右侧主区 */}
      <main className="flex-1 min-w-0">
        <div className="max-w-4xl mx-auto px-8 py-8">
          {selected ? (
            <DetailView item={selected} onBack={() => setSelected(null)} />
          ) : (
          <>
          {/* 标题 + 副标题 */}
          <header className="mb-6">
            <h1
              className="text-[34px] font-bold tracking-tight text-[var(--color-ink)] mb-1"
              style={{ fontFamily: 'var(--font-serif)' }}
            >
              {headerLabel}
            </h1>
            <p className="text-sm text-[var(--color-mute)]">{headerSub}</p>
          </header>

          {/* 过滤栏（专题模式下隐藏分类） */}
          {mode !== 'daily' && !activeTopic && (
            <div className="bg-[var(--color-card)] border border-[var(--color-line)] rounded-xl px-4 py-3 mb-6 flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-1">
                {CATEGORIES.map((c) => (
                  <button
                    key={c.key}
                    onClick={() => {
                      setCategory(c.key);
                      setTopic(null);
                    }}
                    className={`px-3 py-1.5 rounded-md text-sm transition-colors ${
                      category === c.key
                        ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)] font-medium'
                        : 'text-[var(--color-ink-2)] hover:bg-[var(--color-line-2)]'
                    }`}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  setTopic(null);
                  setSubmittedQuery(query.trim());
                }}
                className="ml-auto flex items-center gap-2"
              >
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="搜索标题/摘要..."
                  className="text-sm px-3 py-1.5 rounded-md border border-[var(--color-line)] bg-[var(--color-bg)] focus:outline-none focus:border-[var(--color-accent)] focus:bg-[var(--color-card)] transition-colors w-48"
                />
                <button
                  type="submit"
                  className="text-sm px-3 py-1.5 rounded-md bg-[var(--color-accent)] text-white hover:opacity-90"
                >
                  搜索
                </button>
                {submittedQuery && (
                  <button
                    type="button"
                    onClick={() => {
                      setQuery('');
                      setSubmittedQuery('');
                    }}
                    className="text-xs text-[var(--color-mute)] hover:text-[var(--color-ink)]"
                  >
                    清除
                  </button>
                )}
              </form>
            </div>
          )}

          {loading && (
            <div className="text-center text-sm text-[var(--color-mute)] py-16">加载中…</div>
          )}
          {error && (
            <div className="text-center text-sm text-rose-700 py-16">
              出错了：{error}
              <div className="text-xs text-[var(--color-mute)] mt-2">
                （线上请检查 Vercel 部署，本地请检查代理 :8787）
              </div>
            </div>
          )}

          {!loading && !error && data && Array.isArray(data.sections) && (
            <DailyView data={data} />
          )}

          {!loading && !error && data && Array.isArray(data.items) && (
            <div>
              {items.length === 0 && (
                <div className="text-center text-sm text-[var(--color-mute)] py-16">
                  暂无内容
                  {activeTopic && <span> · 专题「{activeTopic.label}」（历史库攒够后会更多）</span>}
                  {!activeTopic && submittedQuery && <span> · 关键词 "{submittedQuery}"</span>}
                </div>
              )}
              {grouped.map(([k, group], gi) => {
                const isCollapsed = collapsed.has(k);
                return (
                  <div key={k} className="mb-4">
                    <DateDivider
                      k={k}
                      count={group.length}
                      collapsed={isCollapsed}
                      onToggle={() => toggleDate(k)}
                    />
                    {!isCollapsed &&
                      group.map((it, idx) => (
                        <TimelineItem
                          key={it.id}
                          item={it}
                          isFirst={gi === 0 && idx === 0}
                          isLast={gi === grouped.length - 1 && idx === group.length - 1}
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

      {showTop && (
        <button
          type="button"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          aria-label="返回顶部"
          title="返回顶部"
          className="fixed bottom-6 right-6 z-50 w-11 h-11 rounded-full bg-[var(--color-card)] border border-[var(--color-line)] shadow-md grid place-items-center text-[var(--color-ink-2)] hover:text-[var(--color-accent)] hover:border-[var(--color-accent-soft)] transition-all"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 19V5M5 12l7-7 7 7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
    </div>
  );
}
