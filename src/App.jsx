import React, { useMemo, useRef, useState } from 'react';

const emptySections = {
  'Product Updates': [],
  'Pricing Changes': [],
  'Notable News': []
};

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
      sections[currentSection].push(line.replace(/^[-*]\s+/, ''));
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
        className="text-amberAccent underline decoration-amberAccent/40 underline-offset-4 hover:text-amber-300"
        href={part}
        key={`${part}-${index}`}
        rel="noreferrer"
        target="_blank"
      >
        source
      </a>
    );
  });
}

export default function App() {
  const [companyName, setCompanyName] = useState('');
  const [logs, setLogs] = useState([]);
  const [summary, setSummary] = useState('');
  const [meta, setMeta] = useState(null);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState('');
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
            setLogs((current) => [...current, payload.message]);
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
    <main className="min-h-screen bg-panel px-4 py-6 text-slate-100 sm:px-6 lg:px-8">
      <section className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <header className="border-b border-white/10 pb-5">
          <p className="text-sm font-semibold uppercase tracking-[0.22em] text-amberAccent">AI research desk</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-normal text-white sm:text-5xl">
            Competitor Watch Agent
          </h1>
        </header>

        <form className="grid gap-3 sm:grid-cols-[1fr_auto]" onSubmit={startWatch}>
          <label className="sr-only" htmlFor="companyName">
            Company name
          </label>
          <input
            className="h-12 rounded-md border border-white/10 bg-white/[0.04] px-4 text-base text-white outline-none transition placeholder:text-slate-500 focus:border-amberAccent focus:ring-2 focus:ring-amberAccent/20"
            id="companyName"
            onChange={(event) => setCompanyName(event.target.value)}
            placeholder="Enter a company, e.g. Notion"
            value={companyName}
          />
          <button
            className="h-12 rounded-md bg-amberAccent px-5 font-semibold text-slate-950 transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isRunning || !companyName.trim()}
            type="submit"
          >
            {isRunning ? 'Watching...' : 'Start Watch'}
          </button>
        </form>

        <section className="min-h-[280px] rounded-md border border-white/10 bg-black/40 p-4 shadow-2xl shadow-black/30">
          <div className="mb-3 flex items-center justify-between border-b border-white/10 pb-3">
            <span className="text-sm font-medium text-slate-300">Live agent log</span>
            <span className={isRunning ? 'text-sm text-amberAccent' : 'text-sm text-slate-500'}>
              {isRunning ? 'streaming' : 'idle'}
            </span>
          </div>
          <div className="h-[220px] overflow-y-auto font-mono text-sm leading-6 text-slate-300">
            {logs.length === 0 ? (
              <p className="text-slate-600">&gt; Awaiting a company to watch...</p>
            ) : (
              logs.map((line, index) => (
                <p key={`${line}-${index}`}>
                  <span className="text-amberAccent">&gt;</span> {line}
                </p>
              ))
            )}
          </div>
        </section>

        {error && (
          <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        )}

        {hasSummary && (
          <section className="rounded-md border border-white/10 bg-slate-950/80 p-5 shadow-2xl shadow-black/30 sm:p-6">
            {meta?.wasCheckedBefore && meta?.lastChecked && (
              <div className="mb-4 inline-flex rounded-full border border-amberAccent/40 bg-amberAccent/10 px-3 py-1 text-sm font-medium text-amber-200">
                {meta.newFindingsCount} new findings since last check on{' '}
                {new Date(meta.lastChecked).toLocaleDateString()}
              </div>
            )}
            <div className="grid gap-5 md:grid-cols-3">
              {Object.entries(sections).map(([title, bullets]) => (
                <article className="rounded-md border border-white/10 bg-white/[0.03] p-4" key={title}>
                  <h2 className="text-base font-semibold text-white">{title}</h2>
                  <ul className="mt-3 space-y-3 text-sm leading-6 text-slate-300">
                    {(bullets.length ? bullets : ['No specific finding returned for this section.']).map((item, index) => (
                      <li className="border-l border-amberAccent/50 pl-3" key={`${title}-${index}`}>
                        {linkify(item)}
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          </section>
        )}
      </section>
    </main>
  );
}
