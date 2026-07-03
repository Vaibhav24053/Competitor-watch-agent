import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';

export const config = {
  runtime: 'nodejs',
  maxDuration: 60,
};

function sendEvent(res, event, payload) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function normalizeCompanyName(companyName) {
  return companyName.trim().toLowerCase();
}

function createSupabaseClient() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Supabase environment variables are not configured.');
  }
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false }
  });
}

async function checkWatchlist(companyName) {
  const supabase = createSupabaseClient();
  const normalized = normalizeCompanyName(companyName);
  const { data, error } = await supabase
    .from('watchlist')
    .select('company_name, findings, last_checked')
    .eq('company_name', normalized)
    .maybeSingle();

  if (error) throw error;
  if (!data) return { found: false };

  return {
    found: true,
    last_checked: data.last_checked,
    previous_findings: data.findings
  };
}

async function searchWeb(query) {
  if (!process.env.TAVILY_API_KEY) {
    throw new Error('Tavily API key is not configured.');
  }

  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: process.env.TAVILY_API_KEY,
      query,
      search_depth: 'advanced',
      max_results: 5,
      days: 30
    })
  });

  if (!response.ok) {
    throw new Error(`Tavily returned ${response.status}`);
  }

  const data = await response.json();
  return (data.results || []).map((result) => ({
    title: result.title,
    snippet: result.content || result.snippet || '',
    url: result.url
  }));
}

async function saveToWatchlist(companyName, findings) {
  const supabase = createSupabaseClient();
  const normalized = normalizeCompanyName(companyName);
  const { data, error } = await supabase
    .from('watchlist')
    .upsert(
      {
        company_name: normalized,
        findings,
        last_checked: new Date().toISOString()
      },
      { onConflict: 'company_name' }
    )
    .select('company_name, last_checked')
    .single();

  if (error) throw error;
  return { saved: true, company_name: data.company_name, last_checked: data.last_checked };
}

function countSummaryBullets(summary) {
  return summary.split('\n').filter((line) => /^[-*]\s+/.test(line.trim())).length;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).send('Method not allowed');
  }

  const companyName = typeof req.body?.companyName === 'string' ? req.body.companyName.trim() : '';
  if (!companyName) {
    return res.status(400).send('Company name is required.');
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  });

  if (!process.env.OPENAI_API_KEY) {
    sendEvent(res, 'error', { message: 'OpenAI API key is not configured.' });
    return res.end();
  }

  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    timeout: 50000,
    maxRetries: 0
  });

  const today = new Date();
  const currentYear = today.getFullYear();
  const currentMonth = today.toLocaleString('default', { month: 'long' });
  const todayStr = today.toISOString().split('T')[0];

  // We generate search queries ourselves so the model cannot anchor to 2023
  const searchQueries = [
    `${companyName} product updates ${currentMonth} ${currentYear}`,
    `${companyName} pricing changes ${currentYear}`,
    `${companyName} latest news ${currentMonth} ${currentYear}`
  ];

  sendEvent(res, 'log', { message: `Starting competitor watch for "${companyName}"...` });

  // Step 1: Check watchlist for previous findings
  let watchlistResult = { found: false };
  sendEvent(res, 'log', { message: `Checking watchlist for previous findings on "${companyName}"...` });
  try {
    watchlistResult = await checkWatchlist(companyName);
    if (watchlistResult.found) {
      const days = Math.max(0, Math.round(
        (Date.now() - new Date(watchlistResult.last_checked).getTime()) / 86_400_000
      ));
      sendEvent(res, 'log', { message: `Found previous check from ${days} days ago. Focusing on what changed since then.` });
    } else {
      sendEvent(res, 'log', { message: 'No previous watchlist entry found. Starting a fresh research pass.' });
    }
  } catch (err) {
    sendEvent(res, 'log', { message: `Warning: watchlist check failed (${err.message}). Continuing without prior context.` });
  }

  // Step 2: Run all searches ourselves with date-anchored queries
  const allResults = [];
  for (const query of searchQueries) {
    sendEvent(res, 'log', { message: `Calling search_web("${query}")` });
    try {
      const results = await searchWeb(query);
      allResults.push({ query, results });
      sendEvent(res, 'log', { message: `Got ${results.length} results, evaluating relevance...` });
    } catch (err) {
      sendEvent(res, 'log', { message: `Warning: search failed for "${query}", continuing...` });
    }
  }

  // Step 3: Ask OpenAI to summarize ONLY from the search results we provide
  // No tools passed — model cannot call search_web, it can only write the summary
  const searchContext = allResults.map(r =>
    `Search query: "${r.query}"\nResults:\n${r.results.map(x =>
      `- ${x.title}: ${x.snippet} (source: ${x.url})`
    ).join('\n')}`
  ).join('\n\n');

  const priorContext = watchlistResult.found
    ? `\n\nPrevious findings from ${watchlistResult.last_checked}:\n${JSON.stringify(watchlistResult.previous_findings, null, 2)}`
    : '';

  sendEvent(res, 'log', { message: 'Agent is deciding the next step...' });

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are a competitor research analyst. Today is ${todayStr}. Your job is to summarize the provided search results into a structured report. You must ONLY use information from the search results provided — do not use your training data or make up facts. If a section has no relevant results, say "No recent updates found."`
        },
        {
          role: 'user',
          content: `Here are the latest search results for "${companyName}" from ${currentMonth} ${currentYear}:

${searchContext}${priorContext}

Based ONLY on the search results above, write a structured summary with exactly these three sections:

## Product Updates
- [bullet with source URL]

## Pricing Changes  
- [bullet with source URL]

## Notable News
- [bullet with source URL]

Each section must have 2-3 bullets. Only include information found in the search results above.`
        }
      ],
      temperature: 0.1
    });

    const summary = completion.choices[0]?.message?.content || '';
    sendEvent(res, 'log', { message: 'Done. Summary ready.' });

    // Step 4: Save findings to watchlist
    sendEvent(res, 'log', { message: 'Saving findings to watchlist...' });
    try {
      await saveToWatchlist(companyName, { summary, queries: searchQueries, date: todayStr });
      sendEvent(res, 'log', { message: 'Watchlist saved.' });
    } catch (err) {
      sendEvent(res, 'log', { message: `Warning: could not save to watchlist (${err.message}).` });
    }

    sendEvent(res, 'final', {
      summary,
      meta: {
        wasCheckedBefore: watchlistResult.found,
        lastChecked: watchlistResult.last_checked || null,
        newFindingsCount: countSummaryBullets(summary)
      }
    });

    return res.end();
  } catch (error) {
    sendEvent(res, 'error', { message: `OpenAI call failed: ${error.message}` });
    return res.end();
  }
}