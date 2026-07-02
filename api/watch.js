import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';

export const config = {
  runtime: 'nodejs',
  maxDuration: 60,
};

const SYSTEM_PROMPT = `Today's date is ${new Date().toISOString().split('T')[0]}. Your goal is to find recent product updates, pricing changes, and notable news about a company from the last 30 days. Always include the current year in your search queries.

You have access to two tools:
1. check_watchlist — always call this FIRST to see if this company has been researched before and what was previously found. Use prior findings to avoid redundant searches and focus only on what may have changed.
2. search_web — call this to search the web for current information. Make targeted, specific queries. You may call this up to 3 times with different queries if needed.
3. save_to_watchlist — call this LAST, after you have written your summary, to save the new findings for future reference.

Once you have gathered enough information, stop calling tools and write a structured summary with exactly these three sections: Product Updates, Pricing Changes, Notable News. Each section should have 2-3 bullet points with source URLs where available.`;

const tools = [
  {
    type: 'function',
    function: {
      name: 'check_watchlist',
      description: 'Check if this company has been researched before and retrieve previous findings',
      parameters: {
        type: 'object',
        properties: {
          company_name: { type: 'string' }
        },
        required: ['company_name'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_web',
      description: 'Search the web for recent news and updates about a company',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' }
        },
        required: ['query'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'save_to_watchlist',
      description: 'Save the current findings to the watchlist database for future reference',
      parameters: {
        type: 'object',
        properties: {
          company_name: { type: 'string' },
          findings: { type: 'object' }
        },
        required: ['company_name', 'findings'],
        additionalProperties: false
      }
    }
  }
];

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

function describeToolCall(name, args) {
  if (name === 'check_watchlist') {
    return `Checking watchlist for previous findings on "${args.company_name}"...`;
  }
  if (name === 'search_web') {
    return `Calling search_web("${args.query}")`;
  }
  if (name === 'save_to_watchlist') {
    return 'Saving findings to watchlist...';
  }
  return `Calling ${name}...`;
}

function summarizeToolResult(name, result) {
  if (name === 'check_watchlist') {
    if (result.found) {
      const days = Math.max(
        0,
        Math.round((Date.now() - new Date(result.last_checked).getTime()) / 86_400_000)
      );
      return `Found previous check from ${days} days ago. Focusing search on what changed since then.`;
    }
    return 'No previous watchlist entry found. Starting a fresh research pass.';
  }
  if (name === 'search_web') {
    return `Got ${Array.isArray(result) ? result.length : 0} results, evaluating relevance...`;
  }
  if (name === 'save_to_watchlist') {
    return result.saved ? 'Watchlist saved.' : 'Watchlist save was skipped.';
  }
  return 'Tool result received.';
}

function countSummaryBullets(summary) {
  return summary.split('\n').filter((line) => /^[-*]\s+/.test(line.trim())).length;
}

async function executeTool(name, args, res, runState) {
  try {
    if (name === 'check_watchlist') {
      const result = await checkWatchlist(args.company_name);
      runState.watchlist = result;
      return result;
    }
    if (name === 'search_web') {
      return await searchWeb(args.query);
    }
    if (name === 'save_to_watchlist') {
      return await saveToWatchlist(args.company_name, args.findings);
    }

    return { error: `Unknown tool: ${name}` };
  } catch (error) {
    const warning =
      name === 'search_web'
        ? `Warning: web search failed (${error.message}). Continuing with available context.`
        : `Warning: ${name} failed (${error.message}). Continuing without blocking the research.`;
    sendEvent(res, 'log', { message: warning });
    return { error: warning };
  }
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
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `Research this company: ${companyName}` }
  ];
  const runState = { watchlist: null };
  let toolCallCount = 0;
  let forceSummary = false;

  sendEvent(res, 'log', { message: `Starting competitor watch for "${companyName}"...` });

  try {
    while (true) {
      sendEvent(res, 'log', { message: 'Agent is deciding the next step...' });

      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages,
        tools: forceSummary ? undefined : tools,
        tool_choice: forceSummary ? undefined : 'auto',
        temperature: 0.2
      });

      const choice = completion.choices[0];
      const assistantMessage = choice.message;
      messages.push(assistantMessage);

      if (choice.finish_reason === 'tool_calls' && assistantMessage.tool_calls?.length) {
        for (const toolCall of assistantMessage.tool_calls) {
          const name = toolCall.function.name;
          const args = JSON.parse(toolCall.function.arguments || '{}');

          if (toolCallCount >= 5) {
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: JSON.stringify({
                error: 'Maximum tool call limit reached. This tool was not executed.'
              })
            });
            continue;
          }

          toolCallCount += 1;

          sendEvent(res, 'log', { message: describeToolCall(name, args) });
          const result = await executeTool(name, args, res, runState);
          sendEvent(res, 'log', { message: summarizeToolResult(name, result) });

          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify(result)
          });
        }

        if (toolCallCount >= 5) {
          messages.push({
            role: 'user',
            content:
              'You have reached the maximum number of tool calls. Please write your summary now based on what you have gathered.'
          });
          forceSummary = true;
          sendEvent(res, 'log', {
            message: 'Reached the maximum number of tool calls. Asking agent to summarize now...'
          });
        }

        continue;
      }

      if (choice.finish_reason === 'stop') {
        const summary = assistantMessage.content || '';
        sendEvent(res, 'log', { message: 'Done. Summary ready.' });
        sendEvent(res, 'final', {
          summary,
          meta: {
            wasCheckedBefore: Boolean(runState.watchlist?.found),
            lastChecked: runState.watchlist?.last_checked || null,
            newFindingsCount: countSummaryBullets(summary)
          }
        });
        return res.end();
      }

      sendEvent(res, 'error', { message: 'The agent stopped unexpectedly before producing a summary.' });
      return res.end();
    }
  } catch (error) {
    sendEvent(res, 'error', { message: `OpenAI call failed: ${error.message}` });
    return res.end();
  }
}
