import { useEffect, useMemo, useState } from 'react';

const CATEGORIES = [
  { key: 'all', label: '全部' },
  { key: 'ai-models', label: '模型' },
  { key: 'ai-products', label: '产品' },
  { key: 'industry', label: '行业' },
  { key: 'paper', label: '论文' },
  { key: 'tip', label: '技巧' },
];

const MODES = [
  { key: 'selected', label: '精选' },
  { key: 'all', label: '全部 AI 动态' },
  { key: 'daily', label: 'AI 日报' },
];

const CAT_META = {
  'ai-models': { label: '模型', bg: 'bg-[var(--color-tag-model)]', dot: 'bg-amber-700' },
  'ai-products': { label: '产品', bg: 'bg-[var(--color-tag-product)]', dot: 'bg-emerald-700' },
  industry: { label: '行业', bg: 'bg-[var(--color-tag-industry)]', dot: 'bg-rose-700' },
  paper: { label: '论文', bg: 'bg-[var(--color-tag-paper)]', dot: 'bg-indigo-700' },
  tip: { label: '技巧', bg: 'bg-[var(--color-tag-tip)]', dot: 'bg-orange-700' },
};

function isoSinceDaysAgo(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 19) + 'Z';
}

function formatTime(iso) {
  const t = new Date(iso);
  const now = new Date();
  const diffMin = Math.round((now - t) / 60000);
  if (diffMin < 1) return '刚刚';
  if (diffMin < 60) return `${diffMin} 分钟前`;
  if (diffMin < 60 * 24) return `${Math.floor(diffMin / 60)} 小时前`;
  // 北京时间显示
  const beijing = new Date(t.getTime() + 8 * 3600 * 1000);
  const mm = String(beijing.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(beijing.getUTCDate()).padStart(2, '0');
  const hh = String(beijing.getUTCHours()).padStart(2, '0');
  const mi = String(beijing.getUTCMinutes()).padStart(2, '0');
  return `${mm}/${dd} ${hh}:${mi}`;
}

function Card({ item }) {
  const meta = CAT_META[item.category] || { label: item.category, bg: 'bg-gray-100', dot: 'bg-gray-500' };
  return (
    <article className="bg-[var(--color-card)] border border-[var(--color-line)] rounded-lg p-5 hover:border-[var(--color-ink-soft)] transition-colors">
      <div className="flex items-center gap-2 text-xs text-[var(--color-mute)] mb-2">
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded ${meta.bg} text-[var(--color-ink)]`}>
          <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
          {meta.label}
        </span>
        <span>·</span>
        <span className="truncate">{item.source}</span>
        <span>·</span>
        <time className="tabular-nums">{formatTime(item.publishedAt)}</time>
      </div>
      <a
        href={item.url}
        target="_blank"
        rel="noreferrer"
        className="block text-lg font-medium leading-snug text-[var(--color-ink)] hover:text-[var(--color-accent)] mb-2"
      >
        {item.title}
      </a>
      <p className="text-sm text-[var(--color-ink-soft)] leading-relaxed line-clamp-4 whitespace-pre-line">
        {item.summary}
      </p>
    </article>
  );
}

function DailySection({ section }) {
  return (
    <section>
      <h2 className="text-sm font-semibold tracking-wider text-[var(--color-mute)] uppercase mb-3">
        {section.label}
      </h2>
      <div className="space-y-3">
        {section.items.map((it, idx) => (
          <a
            key={idx}
            href={it.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="block bg-[var(--color-card)] border border-[var(--color-line)] rounded-lg p-4 hover:border-[var(--color-ink-soft)] transition-colors"
          >
            <div className="text-[15px] font-medium text-[var(--color-ink)] mb-1 hover:text-[var(--color-accent)]">
              {it.title}
            </div>
            <p className="text-sm text-[var(--color-ink-soft)] leading-relaxed line-clamp-3 whitespace-pre-line">
              {it.summary}
            </p>
            <div className="text-xs text-[var(--color-mute)] mt-2 truncate">{it.sourceName}</div>
          </a>
        ))}
      </div>
    </section>
  );
}

export default function App() {
  const [mode, setMode] = useState('selected');
  const [category, setCategory] = useState('all');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const url = useMemo(() => {
    if (mode === 'daily') return '/api/daily';
    const params = new URLSearchParams({
      mode: mode === 'all' ? 'all' : 'selected',
      since: isoSinceDaysAgo(1),
      take: '50',
    });
    if (category !== 'all') params.set('category', category);
    return `/api/items?${params.toString()}`;
  }, [mode, category]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);
    fetch(url)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        setData(d);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(String(e));
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [url]);

  const todayLabel = new Date().toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
    timeZone: 'Asia/Shanghai',
  });

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-[var(--color-line)] bg-[var(--color-paper)]/95 backdrop-blur sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-6 py-5">
          <div className="flex items-baseline justify-between mb-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">
                aihot <span className="text-[var(--color-accent)]">·</span> FansAI
              </h1>
              <p className="text-xs text-[var(--color-mute)] mt-1 tabular-nums">{todayLabel} · 内部速览</p>
            </div>
            <a
              href="https://aihot.virxact.com"
              target="_blank"
              rel="noreferrer"
              className="text-xs text-[var(--color-mute)] hover:text-[var(--color-ink)]"
            >
              数据源 ↗
            </a>
          </div>
          <nav className="flex flex-wrap gap-1 text-sm">
            {MODES.map((m) => (
              <button
                key={m.key}
                onClick={() => setMode(m.key)}
                className={`px-3 py-1.5 rounded-md transition-colors ${
                  mode === m.key
                    ? 'bg-[var(--color-ink)] text-[var(--color-paper)]'
                    : 'text-[var(--color-ink-soft)] hover:bg-[var(--color-line)]'
                }`}
              >
                {m.label}
              </button>
            ))}
            {mode !== 'daily' && (
              <>
                <span className="mx-2 text-[var(--color-line)]">|</span>
                {CATEGORIES.map((c) => (
                  <button
                    key={c.key}
                    onClick={() => setCategory(c.key)}
                    className={`px-2.5 py-1.5 rounded-md text-xs transition-colors ${
                      category === c.key
                        ? 'bg-[var(--color-line)] text-[var(--color-ink)]'
                        : 'text-[var(--color-mute)] hover:text-[var(--color-ink)]'
                    }`}
                  >
                    {c.label}
                  </button>
                ))}
              </>
            )}
          </nav>
        </div>
      </header>

      <main className="flex-1 max-w-3xl w-full mx-auto px-6 py-6">
        {loading && (
          <div className="text-center text-sm text-[var(--color-mute)] py-12">加载中…</div>
        )}
        {error && (
          <div className="text-center text-sm text-rose-700 py-12">
            出错了：{error}
            <div className="text-xs text-[var(--color-mute)] mt-2">
              （检查代理是否在 :8787 运行）
            </div>
          </div>
        )}
        {!loading && !error && data && Array.isArray(data.sections) && (
          <div className="space-y-8">
            <div className="text-sm text-[var(--color-mute)] tabular-nums">
              {data.date} 日报
            </div>
            {data.sections.map((s, i) => (
              <DailySection key={i} section={s} />
            ))}
          </div>
        )}
        {!loading && !error && data && Array.isArray(data.items) && (
          <div className="space-y-4">
            {data.items.length === 0 && (
              <div className="text-center text-sm text-[var(--color-mute)] py-12">暂无内容</div>
            )}
            {data.items.map((it) => (
              <Card key={it.id} item={it} />
            ))}
          </div>
        )}
      </main>

      <footer className="border-t border-[var(--color-line)] py-4 text-center text-xs text-[var(--color-mute)]">
        aihot-fansai · 数据来自 aihot.virxact.com · 仅供 FansAI 内部使用
      </footer>
    </div>
  );
}
