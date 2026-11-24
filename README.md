# Agents — an open-source library of specialised AI agents

**1,033 ready-made agents across 29 fields** (legal, finance, HR, marketing, healthcare, IT, everyday life and more),
a builder for your own agents, agent chains, routines that run on a schedule, and research that only cites each
country's **official websites**.

**Live demo:** _coming soon_ · **Licence:** MIT

> The live demo runs without an AI key, so you can explore every screen for free. AI actions show
> «AI is not connected». Run it yourself with your own OpenAI key to get real answers (see [Run it yourself](#run-it-yourself)).

## How it works

1. **Pick a field and an agent.** The library groups agents by field (Legal, Finance & accounting, People & HR, …) and
   by area inside each field. Not sure which one? Type the job into **«Tell me the task»** and you get the agents of every
   field that can do it.
2. **Open the agent and ask.** Each agent has its own home page with 9–10 starter questions. Answers stream in, every
   sentence carries its **proof** (the exact quoted words from your document or the official page), and sources open in a
   reader on the right.
3. **Choose where the law or rules come from.** For research, pick one of 208 places. The agent searches only that
   place's catalogued official sources (1,594 of them) and never falls back to the open web.
4. **Build your own.** Describe an agent in a sentence, or customise a ready one, and test it side by side in the builder.
   Link agents into **chains** (50 ready-made) so one agent's answer feeds the next.
5. **Let it work for you.** Connect Gmail, Google Calendar or Outlook and set a **routine** (for example a morning inbox
   brief every weekday at 07:00, sent by e-mail, WhatsApp or Telegram). Finished work comes out as branded **Word, Excel
   or PowerPoint** files, including Word with tracked changes.

**Privacy by default:** names are hidden from the AI (placeholders in the browser, real names back in your answer),
documents are read on your device, and the privacy page states only what is true.

## What's inside

- **Library** — 29 fields, 1,033 agents, ⌘K search, favourites and history.
- **Conversations** — streaming answers, «/» commands, any other agent answering inside the chat, Word/Copy exports.
- **Builder & editor** — new agents from a description, with a test pane.
- **Chains** — 50 ready-made multi-agent workflows on a visual map.
- **Connections & routines** — Gmail, Calendar, Outlook, Sheets, Docs, Slack and more through Composio; schedules and
  «when a page changes» triggers.
- **Every row** — run an agent over each row of an Excel/CSV file or a Google Sheet.
- **Landing page** at `/welcome` with a 3D globe of every agent and a live builder demo.

## Run it yourself

```bash
npm install
cp .env.example .env.local   # add OPENAI_API_KEY (server-side only)
npm run dev                  # http://localhost:5181
```

Without a key the app runs fully; every AI action reports «AI is not connected» instead of pretending.

- `npm run typecheck` — TypeScript over client, shared and server code.
- `npm run sources` — regenerates `shared/official-sources-catalogue.ts` from `data/official-sources/*.json`.
- `npm test` — the server-side tests (jurisdiction allow-list, response reading, request validation, origin and body limits, the conversation window).

## Layout

- `src/` — the React app (plain CSS with tokens in `src/styles/tokens.css`).
- `shared/` — types and the official-sources catalogue, shared by client and server.
- `server/` — the agent run / build / explain logic and model configuration.
- `api/` — Vercel-style routes (`export default { fetch }`); the Vite dev server serves them locally.
- `docs/` — connections, routines, smart features, source capability, launch and validation notes.

## Research guarantees

- Live search uses the provider's `web_search` tool with `filters.allowed_domains` from the catalogue (≤100 hosts) and `tool_choice: 'required'`.
- A place without catalogued sources is **unsupported**: the server refuses the run with `jurisdiction_unsupported`; nothing falls back to another country or to the open web.
- Every cited URL is validated against the allow-list before it is shown; pages read but not cited are listed separately.
- Model IDs stay on the server (`AGENT_MODEL`, `AGENT_MODEL_BALANCED`), defaulting to `gpt-6-astra` (quality) and `gpt-6.1-sol` (balanced).

## Licence

MIT — see [LICENSE](LICENSE). Third-party licences are listed in `THIRD_PARTY_NOTICES.md`.
