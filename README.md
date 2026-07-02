# Competitor Watch Agent

Competitor Watch Agent is a small AI research app for tracking what changed about a company recently. Type a company name, start a watch, and the app streams the agent's work as it checks memory, searches the web, saves findings, and returns a structured summary.

## What It Does

The agent looks for recent product updates, pricing changes, and notable news from the last 30 days. The final result is split into exactly three sections:

- Product Updates
- Pricing Changes
- Notable News

If the company has been researched before, the agent checks the Supabase watchlist first and focuses on what may have changed since the last run.

## How The Agent Works

This is not just a single prompt sent to ChatGPT. The backend runs a real tool-calling loop:

1. The app sends `Research this company: [companyName]` to OpenAI with three available tools.
2. The model decides which tool to call next.
3. The backend executes that tool and sends the result back to the model.
4. The model can call another tool, up to a hard cap of 5 total tool calls.
5. When the model has enough information, it stops calling tools and writes the final summary.

The code does not hardcode the search sequence. The model decides when to call:

- `check_watchlist`
- `search_web`
- `save_to_watchlist`

## Tech Stack

- Frontend: React, Vite, Tailwind CSS
- Backend: Vercel serverless function in `api/watch.js`
- AI: OpenAI `gpt-4o-mini` with function calling
- Search: Tavily API
- Memory: Supabase Postgres

## Supabase Table

Create a table named `watchlist`:

```sql
create table watchlist (
  company_name text primary key,
  findings jsonb,
  last_checked timestamptz default now()
);
```

Company names are normalized before storage with lowercase + trim.

## Environment Variables

Create a `.env` file from `.env.example` and fill in:

```bash
OPENAI_API_KEY=your_openai_api_key
TAVILY_API_KEY=your_tavily_api_key
SUPABASE_URL=your_supabase_project_url
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
```

Never expose these keys in frontend code. They are only read from `process.env` by the serverless function.

## Run Locally

Install dependencies:

```bash
npm install
```

Start the Vite app:

```bash
npm run dev
```

For local testing of the Vercel function, use Vercel's local dev server:

```bash
vercel dev
```

Then open the local URL Vercel prints in the terminal.

## Files

- `src/App.jsx` - single-page React UI with live SSE log and final summary card
- `src/main.jsx` - Vite React entry point
- `src/index.css` - Tailwind imports and base styles
- `api/watch.js` - serverless SSE endpoint and manual OpenAI tool loop
- `.env.example` - required environment variable names
- `vercel.json` - serverless function duration config
