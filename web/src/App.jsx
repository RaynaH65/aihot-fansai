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

function TimelineItem({ item, isFirst, isLast }) {
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
      {/* 卡片 */}
      <div className="flex-1 min-w-0 pb-6">
        <article className="bg-[var(--color-card)] border border-[var(--color-line)] rounded-xl px-5 py-4 hover:shadow-sm hover:border-[var(--color-line)] transition-all">
          <div className="text-xs text-[var(--color-mute)] mb-2 truncate">
            {item.source}
          </div>
          <a
            href={item.url}
            target="_blank"
            rel="noreferrer"
            className="block text-[16px] font-semibold leading-snug text-[var(--color-ink)] hover:text-[var(--color-accent)] mb-2"
          >
            {item.title}
          </a>
          <p className="text-[13.5px] text-[var(--color-ink-2)] leading-relaxed line-clamp-4 whitespace-pre-line">
            {item.summary}
          </p>
          <div className="mt-3 flex items-center gap-2">
            <CategoryPill category={item.category} />
            <a
              href={item.url}
              target="_blank"
              rel="noreferrer"
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

function DateDivider({ k }) {
  return (
    <div className="flex items-center gap-3 my-1 pl-[88px]">
      <h3 className="text-sm font-semibold text-[var(--color-ink-2)]">{dateLabel(k)}</h3>
      <span className="text-xs text-[var(--color-mute-2)] tabular-nums">{k}</span>
    </div>
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

  const url = useMemo(() => {
    if (mode === 'daily') return '/api/daily';
    const searching = submittedQuery && submittedQuery.length >= 2;
    const params = new URLSearchParams({
      mode: mode === 'all' ? 'all' : 'selected',
      take: searching ? '100' : '50',
    });
    // 搜索时不限时间窗口 —— 让后端查自有历史库（可跨 30 天+）；
    // 平时只看过去 7 天。
    if (!searching) params.set('since', isoSinceDaysAgo(7));
    if (category !== 'all') params.set('category', category);
    if (searching) params.set('q', submittedQuery);
    return `/api/items?${params.toString()}`;
  }, [mode, category, submittedQuery]);

  useEffect(() => {
    let cancelled = false;
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
  const items = data?.items || [];
  const grouped = useMemo(() => groupByDate(items), [items]);

  return (
    <div className="min-h-screen flex">
      {/* 左侧栏（sticky，滚动时保持可见） */}
      <aside className="w-56 flex-none border-r border-[var(--color-line)] bg-[var(--color-card)] flex flex-col sticky top-0 h-screen self-start overflow-y-auto">
        <div className="px-5 py-5 border-b border-[var(--color-line-2)]">
          {/* TODO: 拿到正式 logo 后改成 <img src="/logo.svg" className="h-8" /> */}
          <div className="flex items-center gap-2.5">
            <span className="inline-block w-8 h-8 rounded-full bg-[var(--color-accent)] grid place-items-center font-bold text-[var(--color-bg)] text-sm">F</span>
            <div className="leading-tight">
              <div className="font-bold tracking-tight text-[var(--color-ink)] text-[15px]">FansAI</div>
              <div className="text-[10px] text-[var(--color-mute)] tracking-[0.15em] uppercase mt-0.5">aihot · 内部</div>
            </div>
          </div>
        </div>
        <nav className="px-3 py-4 space-y-1">
          {MODES.map((m) => (
            <SidebarItem
              key={m.key}
              active={mode === m.key}
              label={m.label}
              onClick={() => setMode(m.key)}
            />
          ))}
          <div className="h-px bg-[var(--color-line-2)] my-3" />
          <a
            href="https://aihot.virxact.com"
            target="_blank"
            rel="noreferrer"
            className="block w-full text-left px-3 py-2 rounded-lg text-sm text-[var(--color-mute)] hover:bg-[var(--color-line-2)]"
          >
            数据源 ↗
          </a>
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
          内部速览 · 数据来自 aihot.virxact.com
        </div>
      </aside>

      {/* 右侧主区 */}
      <main className="flex-1 min-w-0">
        <div className="max-w-4xl mx-auto px-8 py-8">
          {/* 标题 + 副标题 */}
          <header className="mb-6">
            <h1
              className="text-[34px] font-bold tracking-tight text-[var(--color-ink)] mb-1"
              style={{ fontFamily: 'var(--font-serif)' }}
            >
              {currentMode?.label}
            </h1>
            <p className="text-sm text-[var(--color-mute)]">{currentMode?.subtitle}</p>
          </header>

          {/* 过滤栏 */}
          {mode !== 'daily' && (
            <div className="bg-[var(--color-card)] border border-[var(--color-line)] rounded-xl px-4 py-3 mb-6 flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-1">
                {CATEGORIES.map((c) => (
                  <button
                    key={c.key}
                    onClick={() => setCategory(c.key)}
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
                  {submittedQuery && <span> · 关键词 "{submittedQuery}"</span>}
                </div>
              )}
              {grouped.map(([k, group], gi) => (
                <div key={k} className="mb-4">
                  <DateDivider k={k} />
                  {group.map((it, idx) => (
                    <TimelineItem
                      key={it.id}
                      item={it}
                      isFirst={gi === 0 && idx === 0}
                      isLast={gi === grouped.length - 1 && idx === group.length - 1}
                    />
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
