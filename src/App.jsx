import React, { useMemo, useRef, useState } from 'react';

const emptySections = {
  'Product Updates': [],
  'Pricing Changes': [],
  'Notable News': []
};

// Strip markdown bold markers from bullet text
function cleanText(text) {
  return text.replace(/\*\*(.*?)\*\*/g, '$1').replace(/\*(.*?)\*/g, '$1');
}

function parseSummary(summary = '') {
  const sections = { ...emptySections };
  let currentSection = null;

  summary.split('\n').forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line) return;

    const heading = line.replace(/^#+\s*/, '').replace(/\*\*/g, '').replace(/:$/, '');
    if (sections[heading]) {
      currentSection = heading;
      return;
    }

    if (currentSection && /^[-*]\s+/.test(line)) {
      sections[currentSection].push(cleanText(line.replace(/^[-*]\s+/, '')));
    }
  });

  return sections;
}

function linkify(text) {
  const parts = text.split(/(https?:\/\/[^\s),\]]+)/g);
  return parts.map((part, index) => {
    if (!part.startsWith('http')) return part;
    return (
      <a
        className="inline-flex items-center gap-0.5 font-mono text-[11px] uppercase tracking-wider text-amber-400 hover:text-amber-300 transition-colors"
        href={part}
        key={`${part}-${index}`}
        rel="noreferrer"
        target="_blank"
      >
        ↗ src
      </a>
    );
  });
}

const SECTION_ICONS = {
  'Product Updates': '⬡',
  'Pricing Changes': '◈',
  'Notable News': '◎'
};

const SECTION_COLORS = {
  'Product Updates': 'border-amber-400/30 bg-amber-400/[0.03]',
  'Pricing Changes': 'border-blue-400/30 bg-blue-400/[0.03]',
  'Notable News': 'border-emerald-400/30 bg-emerald-400/[0.03]'
};

const SECTION_ICON_COLORS = {
  'Product Updates': 'text-amber-400',
  'Pricing Changes': 'text-blue-400',
  'Notable News': 'text-emerald-400'
};

const SECTION_BULLET_COLORS = {
  'Product Updates': 'border-amber-400/40',
  'Pricing Changes': 'border-blue-400/40',
  'Notable News': 'border-emerald-400/40'
};

export default function App() {
  const [companyName, setCompanyName] = useState('');
  const [logs, setLogs] = useState([]);
  const [summary, setSummary] = useState('');
  const [meta, setMeta] = useState(null);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState('');
  const logRef = useRef(null);
  const abortRef = useRef(null);

  const sections = useMemo(() => parseSummary(summary), [summary]);

  async function startWatch(event) {
    event.preventDefault();
    const trimmed = companyName.trim();
    if (!trimmed || isRunning) return;

    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setLogs([]);
    setSummary('');
    setMeta(null);
    setError('');
    setIsRunning(true);

    try {
      const response = await fetch('/api/watch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyName: trimmed }),
        signal: abortRef.current.signal
      });

      if (!response.ok || !response.body) {
        const message = await response.text();
        throw new Error(message || 'The watch could not be started.');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() || '';

        events.forEach((eventBlock) => {
          const eventType = eventBlock.match(/^event:\s*(.+)$/m)?.[1] || 'message';
          const dataLine = eventBlock.match(/^data:\s*(.+)$/m)?.[1];
          if (!dataLine) return;

          const payload = JSON.parse(dataLine);
          if (eventType === 'log') {
            setLogs((current) => {
              const next = [...current, payload.message];
              setTimeout(() => {
                if (logRef.current) {
                  logRef.current.scrollTop = logRef.current.scrollHeight;
                }
              }, 0);
              return next;
            });
          }
          if (eventType === 'final') {
            setSummary(payload.summary || '');
            setMeta(payload.meta || null);
          }
          if (eventType === 'error') {
            setError(payload.message || 'Something went wrong.');
            setLogs((current) => [...current, `Error: ${payload.message}`]);
          }
        });
      }
    } catch (watchError) {
      if (watchError.name !== 'AbortError') {
        setError(watchError.message);
      }
    } finally {
      setIsRunning(false);
    }
  }

  const hasSummary = Boolean(summary);

  return (
    <main className="min-h-screen bg-[#080a0d] px-4 py-8 text-slate-100 sm:px-6 lg:px-10">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">

        {/* Header */}
        <header className="relative">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="flex items-center gap-2 mb-3">
                <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-amber-400/70">v1.0</span>
                <span className="h-px w-8 bg-amber-400/20"></span>
                <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-slate-500">AI Research Agent</span>
              </div>
              <h1 className="text-4xl font-bold tracking-tight text-white sm:text-5xl">
                Competitor<br />
                <span className="text-amber-400">Watch</span> Agent
              </h1>
              <p className="mt-3 max-w-lg text-sm leading-6 text-slate-400">
                Autonomously searches the web, remembers past findings, and surfaces only what's changed — delivered as a structured brief.
              </p>
            </div>
            <div className="flex flex-col items-end gap-1 pb-1">
              <div className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                <span className="font-mono text-[11px] text-slate-500">live · powered by gpt-4o-mini</span>
              </div>
              <span className="font-mono text-[11px] text-slate-600">tavily · supabase · vercel</span>
            </div>
          </div>
          <div className="mt-6 h-px bg-gradient-to-r from-amber-400/30 via-slate-700/50 to-transparent"></div>
        </header>

        {/* Search form */}
        <form className="flex flex-col gap-3 sm:flex-row" onSubmit={startWatch}>
          <div className="relative flex-1">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 font-mono text-sm text-amber-400/60 select-none">$</span>
            <input
              className="h-12 w-full rounded-sm border border-white/10 bg-white/[0.03] pl-8 pr-4 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-amber-400/50 focus:bg-white/[0.05] focus:ring-1 focus:ring-amber-400/20"
              id="companyName"
              onChange={(event) => setCompanyName(event.target.value)}
              placeholder="notion, linear, figma, stripe..."
              value={companyName}
            />
          </div>
          <button
            className="h-12 rounded-sm bg-amber-400 px-6 font-mono text-sm font-bold uppercase tracking-wider text-slate-950 transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={isRunning || !companyName.trim()}
            type="submit"
          >
            {isRunning ? (
              <span className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-slate-950 animate-pulse"></span>
                Watching
              </span>
            ) : 'Run Agent'}
          </button>
        </form>

        {/* Live agent log */}
        <div className="rounded-sm border border-white/[0.07] bg-black/60 overflow-hidden">
          <div className="flex items-center justify-between border-b border-white/[0.07] px-4 py-2.5">
            <div className="flex items-center gap-2">
              <div className="flex gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-red-500/40"></span>
                <span className="h-2.5 w-2.5 rounded-full bg-yellow-500/40"></span>
                <span className="h-2.5 w-2.5 rounded-full bg-green-500/40"></span>
              </div>
              <span className="font-mono text-[11px] text-slate-500 ml-1">agent.log</span>
            </div>
            <span className={`font-mono text-[10px] uppercase tracking-wider ${isRunning ? 'text-amber-400' : 'text-slate-600'}`}>
              {isRunning ? '● streaming' : '○ idle'}
            </span>
          </div>
          <div
            ref={logRef}
            className="h-[200px] overflow-y-auto p-4 font-mono text-xs leading-6 text-slate-400 scrollbar-thin"
          >
            {logs.length === 0 ? (
              <p className="text-slate-700">$ awaiting input...</p>
            ) : (
              logs.map((line, index) => (
                <p key={`${line}-${index}`} className="flex gap-2">
                  <span className="text-amber-400/60 select-none shrink-0">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <span className={
                    line.startsWith('Warning') ? 'text-yellow-400/70' :
                    line.startsWith('Error') ? 'text-red-400/70' :
                    line.includes('Done') ? 'text-emerald-400' :
                    line.includes('Calling search_web') ? 'text-amber-300' :
                    'text-slate-400'
                  }>
                    {line}
                  </span>
                </p>
              ))
            )}
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="rounded-sm border border-red-500/20 bg-red-500/[0.06] px-4 py-3 font-mono text-xs text-red-300">
            ✕ {error}
          </div>
        )}

        {/* Summary cards */}
        {hasSummary && (
          <div className="flex flex-col gap-4">
            {meta?.wasCheckedBefore && meta?.lastChecked && (
              <div className="flex items-center gap-3">
                <span className="h-px flex-1 bg-white/[0.06]"></span>
                <span className="font-mono text-[11px] text-slate-500">
                  {meta.newFindingsCount} findings · last checked {new Date(meta.lastChecked).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </span>
                <span className="h-px flex-1 bg-white/[0.06]"></span>
              </div>
            )}

            <div className="grid gap-4 md:grid-cols-3">
              {Object.entries(sections).map(([title, bullets]) => (
                <article
                  className={`rounded-sm border p-5 ${SECTION_COLORS[title]}`}
                  key={title}
                >
                  <div className="flex items-center gap-2 mb-4">
                    <span className={`text-lg leading-none ${SECTION_ICON_COLORS[title]}`}>
                      {SECTION_ICONS[title]}
                    </span>
                    <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                      {title}
                    </h2>
                  </div>
                  <ul className="space-y-3">
                    {(bullets.length ? bullets : ['No recent updates found.']).map((item, index) => (
                      <li
                        className={`border-l-2 pl-3 text-xs leading-5 text-slate-400 ${SECTION_BULLET_COLORS[title]}`}
                        key={`${title}-${index}`}
                      >
                        {linkify(item)}
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>

            <p className="text-center font-mono text-[10px] text-slate-700">
              data sourced via tavily · summarized by gpt-4o-mini · stored in supabase
            </p>
          </div>
        )}
      </div>
    </main>
  );
}