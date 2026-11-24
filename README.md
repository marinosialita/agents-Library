# Global agent platform (working name: Agents)

A platform of specialised agents across fields, professions and everyday tasks. Twenty-nine fields and 1,033 ready-made agents (seven fields joined on 10 November 2026: IT & cybersecurity, Banking & investment, Retail & e-commerce, Manufacturing & engineering, Sustainability & ESG, Startups & fundraising, Project management; see `docs/launch.md`), each field with its own areas
and ready-made agents: **Legal** (109, the reference library) and, since 6 November 2026, Finance & accounting, People & HR,
Marketing & sales, Operations, Product & engineering, Healthcare, Education, Languages, Creative, Communication, Everyday life,
Compliance & risk, Business & strategy, Data & analytics, Customer support, Real estate & construction, Science & research,
Public sector & nonprofits, Hospitality & tourism, Shipping, logistics & trade and Insurance & claims (nine starters every
agent). Custom agents built from a description or by
customising a ready one, conversations with streaming answers, documents, favourites, history, Word/Copy exports,
and **jurisdiction-aware research limited to each place's official websites** (208 places, 1,594 catalogued sources)
with a right-hand source reader. Since 7 November: **«Tell me the task»** (describe the job, get the agents of every field that do it), **«/» in the chat box** (commands, and any other agent answering inside the conversation), **names hidden** from the AI by default (placeholders in the browser, real names back in the answer) and **«All fields»** in the Field picker. Also since 7 November (`docs/smart-features.md`): **proof on every sentence** (each claim linked to the exact quoted words, checked against the document or official page), a **house style** every agent follows, **agent chains**, **branded Word, Excel and PowerPoint** files and **Word with tracked changes**, **photos and «Share to Agents»** on a phone, **e-mail and WhatsApp channels** (off until the owner connects them) and a **privacy page** that states only what is true. For the launch (`docs/launch.md`): **50 chain agents** on a card grid, **⌘K search**, and a **landing page** at `/welcome` with a 3D globe of every agent and live demos of the builder. Since 10 November: **Connections** (Gmail, Google Calendar, Outlook) and the first connected agent, the **morning inbox brief**, read-only, with names hidden, and **Routines** that run it on a schedule and send it by e-mail or WhatsApp (`docs/connections.md`, `docs/routines.md`; open-source licences in `THIRD_PARTY_NOTICES.md`).

The interaction model: library → agent home → conversation → citation → conversation + reader; builder/editor with a
test pane, in a white + lavender design.

## Run

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
