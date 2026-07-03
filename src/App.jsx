import React, { useMemo, useRef, useState } from 'react';

const emptySections = {
  'Product Updates': [],
  'Pricing Changes': [],
  'Notable News': []
};

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
        className="inline-flex items-center gap-1 text-violet-400 hover:text-violet-300 transition-colors text-xs font-medium underline underline-offset-2"
        href={part}
        key={`${part}-${index}`}
        rel="noreferrer"
        target="_blank"
      >
        source ↗
      </a>
    );
  });
}

const SECTION_META = {
  'Product Updates': {
    icon: '🚀',
    gradient: 'from-violet-500/20 to-purple-500/5',
    border: 'border-violet-500/20',
    badge: 'bg-violet-500/10 text-violet-300 border-violet-500/20',
    bullet: 'bg-violet-400'
  },
  'Pricing Changes': {
    icon: '💰',
    gradient: 'from-indigo-500/20 to-blue-500/5',
    border: 'border-indigo-500/20',
    badge: 'bg-indigo-500/10 text-indigo-300 border-indigo-500/20',
    bullet: 'bg-indigo-400'
  },
  'Notable News': {
    icon: '📡',
    gradient: 'from-purple-500/20 to-pink-500/5',
    border: 'border-purple-500/20',
    badge: 'bg-purple-500/10 text-purple-300 border-purple-500/20',
    bullet: 'bg-purple-400'
  }
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
                if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
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
    <main className="min-h-screen bg-[#0c0a1a] px-4 py-10 text-slate-100 sm:px-6 lg:px-10"
      style={{
        backgroundImage: 'radial-gradient(ellipse 80% 50% at 50% -20%, rgba(120,80,220,0.15), transparent)'
      }}
    >
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-8">

        {/* Header */}
        <header className="text-center flex flex-col items-center gap-4 pt-4">
          <div className="inline-flex items-center gap-2 rounded-full border border-violet-500/20 bg-violet-500/10 px-4 py-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-violet-400 animate-pulse"></span>
            <span className="text-xs font-medium text-violet-300 tracking-wide">AI-Powered Competitor Intelligence</span>
          </div>
          <h1 className="text-4xl font-bold tracking-tight text-white sm:text-5xl">
            Competitor{' '}
            <span
              className="bg-clip-text text-transparent"
              style={{ backgroundImage: 'linear-gradient(135deg, #a78bfa, #7c3aed, #c084fc)' }}
            >
              Watch Agent
            </span>
          </h1>
          <p className="max-w-lg text-sm leading-6 text-slate-400">
            Type a company name. The agent searches the web, checks its memory for past findings, and delivers a structured brief — automatically.
          </p>
        </header>

        {/* Search form */}
        <form className="flex flex-col gap-3 sm:flex-row" onSubmit={startWatch}>
          <div className="relative flex-1">
            <input
              className="h-12 w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-violet-500/50 focus:bg-white/[0.06] focus:ring-2 focus:ring-violet-500/20"
              id="companyName"
              onChange={(event) => setCompanyName(event.target.value)}
              placeholder="Enter a company name, e.g. Notion, Linear, Figma..."
              value={companyName}
            />
          </div>
          <button
            className="h-12 rounded-xl px-6 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-40"
            disabled={isRunning || !companyName.trim()}
            style={{
              background: isRunning
                ? 'rgba(124,58,237,0.5)'
                : 'linear-gradient(135deg, #7c3aed, #6d28d9)',
              boxShadow: isRunning ? 'none' : '0 0 20px rgba(124,58,237,0.4)'
            }}
            type="submit"
          >
            {isRunning ? (
              <span className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse"></span>
                Watching...
              </span>
            ) : 'Start Watch →'}
          </button>
        </form>

        {/* Live agent log */}
        <div
          className="rounded-xl border border-white/[0.06] overflow-hidden"
          style={{ background: 'rgba(255,255,255,0.02)', backdropFilter: 'blur(12px)' }}
        >
          <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-3">
            <div className="flex items-center gap-3">
              <div className="flex gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-red-500/50"></span>
                <span className="h-2.5 w-2.5 rounded-full bg-yellow-500/50"></span>
                <span className="h-2.5 w-2.5 rounded-full bg-green-500/50"></span>
              </div>
              <span className="text-xs font-medium text-slate-500">Live Agent Log</span>
            </div>
            <div className="flex items-center gap-2">
              {isRunning && <span className="h-1.5 w-1.5 rounded-full bg-violet-400 animate-pulse"></span>}
              <span className={`text-xs font-medium ${isRunning ? 'text-violet-400' : 'text-slate-600'}`}>
                {isRunning ? 'Streaming' : 'Idle'}
              </span>
            </div>
          </div>
          <div
            ref={logRef}
            className="h-[200px] overflow-y-auto p-5 font-mono text-xs leading-6"
          >
            {logs.length === 0 ? (
              <p className="text-slate-700">{'>'} Awaiting a company to watch...</p>
            ) : (
              logs.map((line, index) => (
                <p key={`${line}-${index}`} className="flex gap-3">
                  <span className="text-violet-500/50 select-none shrink-0">{String(index + 1).padStart(2, '0')}</span>
                  <span className={
                    line.startsWith('Warning') ? 'text-yellow-400/80' :
                    line.startsWith('Error') ? 'text-red-400/80' :
                    line.includes('Done') || line.includes('ready') ? 'text-green-400' :
                    line.includes('Calling search_web') ? 'text-violet-300' :
                    line.includes('Saving') ? 'text-blue-300' :
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
          <div className="rounded-xl border border-red-500/20 bg-red-500/[0.05] px-4 py-3 text-sm text-red-300">
            ✕ {error}
          </div>
        )}

        {/* Summary cards */}
        {hasSummary && (
          <div className="flex flex-col gap-5">
            {meta?.wasCheckedBefore && meta?.lastChecked && (
              <div
                className="flex items-center justify-between rounded-xl border border-violet-500/20 px-4 py-3"
                style={{ background: 'rgba(124,58,237,0.08)' }}
              >
                <span className="text-sm text-slate-300">
                  <span className="font-semibold text-violet-300">{meta.newFindingsCount} new findings</span> since last check
                </span>
                <span className="text-xs text-slate-500">
                  Last checked {new Date(meta.lastChecked).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </span>
              </div>
            )}

            <div className="grid gap-4 md:grid-cols-3">
              {Object.entries(sections).map(([title, bullets]) => {
                const meta = SECTION_META[title];
                return (
                  <article
                    className={`rounded-xl border ${meta.border} p-5 flex flex-col gap-4`}
                    key={title}
                    style={{
                      background: `linear-gradient(135deg, ${meta.gradient.includes('violet') ? 'rgba(124,58,237,0.08)' : meta.gradient.includes('indigo') ? 'rgba(99,102,241,0.08)' : 'rgba(168,85,247,0.08)'}, rgba(0,0,0,0.2))`
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${meta.badge}`}>
                        {meta.icon} {title}
                      </span>
                    </div>
                    <ul className="space-y-3 flex-1">
                      {(bullets.length ? bullets : ['No recent updates found.']).map((item, index) => (
                        <li key={`${title}-${index}`} className="flex gap-2.5 text-xs leading-5 text-slate-400">
                          <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${meta.bullet}`}></span>
                          <span>{linkify(item)}</span>
                        </li>
                      ))}
                    </ul>
                  </article>
                );
              })}
            </div>

            <p className="text-center text-[11px] text-slate-700">
              Powered by OpenAI · Tavily · Supabase · Vercel
            </p>
          </div>
        )}
      </div>
    </main>
  );
}