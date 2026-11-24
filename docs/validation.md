# Validation — how to reproduce every check

All commands run from the project folder `~/global-agent-platform_claude`. Node 22+.

## 1. Install, type-check, test

```bash
npm install
```

```bash
npm run typecheck
```
Expected: no output (clean).

```bash
npm test
```
Expected: four suites, in order — `31 checks passed` (`tests/run.mjs`), `19 checks passed` (`tests/proof.mjs`: the proof format, quote matching, the page highlight), `14 passed` (`tests/office.mjs`: Word, Excel, PowerPoint and tracked-changes packages, every XML part parsed) and `16 passed` (`tests/inbound.mjs`: the e-mail and WhatsApp routes against stubbed Postmark, Meta and OpenAI). The first suite The suite (`tests/run.mjs`) covers:
1. the catalogue has 208 places and no place exceeds 100 search domains;
2. a member state's domains include the EU's (parent chain);
3. `isOfficialUrl` accepts catalogue hosts and their subdomains, rejects the open web;
4. reading a provider response keeps only official citations, strips `utm_` parameters, lists consulted pages, reports gaps;
5. request validation (limits, jurisdiction codes, languages);
6. the instruction names the governing jurisdiction («GOVERNING JURISDICTION: England and Wales») and the answer language («Write in German»);
7. the run handler answers 503 without a key, 403 cross-origin, 422 for an unsupported place (the branch is exercised with a stubbed catalogue because every real place has sources), and never sends an empty allow-list;
8. the provider payload carries `tools:[{type:'web_search', filters:{allowed_domains:[…]}}]`, `tool_choice:'required'`, `include:['web_search_call.action.sources']`, and the handler turns the provider's SSE stream into NDJSON `status`/`delta`/`done` lines;
9. the builder's response reading clips starters to 9 and never defaults to a place: an unknown place falls back to the workspace's or none, an empty one stays empty, a refinement keeps the current one;
10. the twenty-nine fields have unique category ids and every Legal template is a valid Legal agent with nine starters;
11. every other field's catalogue has at least 24 valid agents, three per area, nine starters each, ids unique across Legal and the fields;
12. an agent that does not research may run without a jurisdiction, and its instruction then names none (a researching one without a place is refused).
13. the Origin check compares hosts, not schemes: a page served over https behind a proxy that hands the handler an http:// URL is its own site; another site's Origin is still refused;
14. a chunked body beyond the limit is refused as `request_too_large` while it arrives (never buffered first);
15. a refined agent sent to the builder is checked field by field (starters, mode, switches), never passed to the prompt unchecked;
16. only http(s) pages without credentials or an odd port count as official, for a place and for the catalogue (`javascript:`, `ftp:`, `user:pass@`, `:8443` are refused);
17. the conversation window sent to the agent (the last forty turns) starts with a question and ends with one;
18. names hidden: people (titles, party definitions, names inside a sentence), companies (legal-form suffix), e-mails, phones, IBANs (checksum), cards (Luhn), ID numbers and addresses become placeholders; headings, case names («Donoghue v Stevenson»), courts and places stay; restore puts the names back; kept and added words are honoured;
19. the run request the AI receives carries placeholders only (reference material, documents, file names, messages), passes the request validation and is flagged `anonymised`; names shown sends it unchanged;
20. the flag adds the placeholder rule to the instruction, and only then; a non-boolean flag is refused;
21. «Tell me the task» in the browser: the month-end commentary task finds the Finance agent first, a translation task a Languages agent, a GDPR notice the privacy drafter; stop words alone find nothing;
22. the task route reads the whole catalogue (every ready agent, over 1,000) in its instruction, maps the AI's numbers and M-numbers to agent ids, drops unknown and repeated ones, answers 503 without a key and 400 for an empty task;
23. «/»: the token at the caret (start of the box or after a space, never «1/2»), commands by their words, other agents by name, and no agents or «New conversation» in the editor's test;
24. the house style reaches every agent's instruction (tone, positions, rules) and its templates the input; names in it are hidden too; its limits hold;
25. photos go with the latest question as `input_image`; an SVG or a fifth photo is refused;
26. every ready-made chain uses real agents, and a step reads its ask, the task, the step before and the documents;
27. the status route reports only what the server does (answers not stored; EU processing and hosting false until set up) and no model id.
28. the launch claims: over 1,000 ready agents, exactly fifty chains that pass `scripts/check-chains.mjs`, and `src/landing/library-index.json` equal to what the catalogue produces today (no stale number on the landing page).

The field catalogues have their own checker (ids, areas, counts, starters, lengths, the Role / Task / Output / Rules sections):

```bash
node --experimental-transform-types scripts/check-field-agents.mjs all
```
Expected: one line per field and `all checks passed` (6 November: Finance 32, HR 32, Marketing 32, Operations 32, Product 32, Healthcare 32, Education 32, Languages 32, Creative 31, Communication 31, Everyday life 35, Compliance 32, Business 32, Data 32, Support 32, Real estate 32, Research 32, Public 32, Hospitality 31, Shipping 32, Insurance 32 — 672 agents, 6,048 starters, 82 researching, 51 deep).

## 2. Run the app

```bash
npm run dev -- --port 5181 --strictPort
```
Open http://localhost:5181. Without `OPENAI_API_KEY` in `.env.local` the status chip in Settings reads «Not connected» and every AI action explains that AI is not connected.

```bash
curl -s http://localhost:5181/api/status
```
Expected: `{"configured":false,"models":{"quality":"default","balanced":"default"},"search":true}` (configured becomes true with a key; a model choice reads `configured` when `AGENT_MODEL` / `AGENT_MODEL_BALANCED` is set — the ids themselves never leave the server).

## 3. Official-source proxies (no key needed)

```bash
curl -s 'http://localhost:5181/api/official-page?url=https://www.legislation.gov.uk/ukpga/1980/58/section/5' | head -c 300
```
Expected: JSON `{"url":…,"title":"Limitation Act 1980",…,"html":"…"}`.

```bash
curl -s -o /dev/null -w '%{http_code} %{size_download}\n' 'http://localhost:5181/api/official-web?url=https://www.legislation.gov.uk/ukpga/1980/58/section/5'
```
Expected: `200` and a few tens of kilobytes (sanitised page with the bridge script).

```bash
curl -s 'http://localhost:5181/api/official-page?url=https://eur-lex.europa.eu/eli/reg/2016/679/oj' | head -c 200
```
Expected: JSON with the regulation's title (fetched through CELLAR).

```bash
curl -s -o /dev/null -w '%{http_code}\n' 'http://localhost:5181/api/official-page?url=https://example.com/'
```
Expected: `403` — a host outside the catalogue is refused.

### «Tell me the task» route

```bash
curl -s -X POST http://localhost:5181/api/agent-route -H 'Content-Type: application/json' -d '{"task":"Write the month-end variance commentary","language":"en"}'
```
Expected without a key: `{"error":"not_configured"}` (503); the library then keeps its matches by wording and says AI is not connected. With a key: `{"picks":[{"id":"ready-finance-month-end-commentary","reason":"…"}],"noneFits":false}`.

## 4. Jurisdiction guard (no key needed for the 503; with a key, the 422s)

```bash
curl -s -X POST http://localhost:5181/api/agent-run -H 'Content-Type: application/json' -d '{"agent":{"id":"x","name":"x","description":"","instructions":"x","needs":"","category":"general","jurisdiction":"zz","officialSearch":true,"mode":"fast","starters":[],"knowledge":[],"origin":"mine"},"messages":[{"role":"user","content":"hi"}],"documents":[],"language":"en"}'
```
Expected without a key: `{"error":"agent_unavailable"}` (503). With a key: `{"error":"invalid_input"}` (400), because `zz` is not a catalogue place; a catalogued place without sources would return 422 `jurisdiction_unsupported` with the place's name, before any provider call.

## 5. Screens checked in the browser (6 November 2026, Claude desktop browser pane, 800×484 and 375×812)

| Screen | Evidence | Checked |
|---|---|---|
| A Library | `docs/evidence/A-library.jpg` | the reference's panel (All agents 109, Favourites, My agents, Ready-made, 16 practice areas; since 6 November the bar's Field picker opens the other twenty-one fields, each with its areas and 31–35 agents, checked in the pane: Finance (32 cards, 7 areas, «Areas» heading), Compliance (32 cards, 8 areas), Insurance, Shipping (phone), an agent home with the field's eyebrow and nine starters, the KYC file review refusing to run without a jurisdiction with icons), three columns at 800 px, search, sort, New agent; the layout matches `Approved_Mockup.svg` with the lavender palette |
| B Agent home | `docs/evidence/B-agent-home.jpg` | eyebrow, emphasised title, composer with Documents / How it works / «Choose jurisdiction» select chip / Deep research, five starters, History and Documents panels |
| C Conversation | `docs/evidence/C-chat-answer.jpg` | seeded answer in the editorial typography, lavender citations, «Official sources · 🏴 England and Wales · 3 pages» fold, Copy / Word, chips England and Wales + Deep research |
| D Reader | `docs/evidence/D-chat-with-reader.jpg` | opens beside the chat from a citation (`.mn-agent-split.has-reader`, iframe to `/api/official-web`); the pane blocks the frame, so it stays blank there until the 40 s text fallback; Escape closes it |
| E Builder / Editor | `docs/evidence/E-builder.jpg`, `E-editor.jpg` | describe screen with Examples and four ideas; editor opened by Customise on a ready agent: Change with AI, fields, jurisdiction select with the «Choose» option and hint, Fast / Deep, instructions counter, Test aside with the agent's starters |
| Settings, Conversations | `settings.jpg`, `conversations.jpg` | research jurisdiction (none chosen), language, Quality / Balanced, My fields, AI «Not connected», official-sources note; conversation list with delete |
| Rail | (desktop hover) | collapsed by default; hover peeks the 208 px menu over the page with New agent, Library, Favourites, Conversations, Knowledge, «Your conversations · Today», Settings, Profile; leave closes it |
| Phone (375×812) | `mobile-library.jpg`, `mobile-drawer.jpg`, `mobile-chat.jpg` | phone bar with mark + title; one-column library; drawer with the destinations and the grouped conversations, Escape closes; chat with the sources fold and the composer |

`/new/edit` opened by its URL shows a blank editor (as «Start blank» gives). Not checked live (no key): streaming, status line, live source pills, builder design, Explain, Steps. See `docs/limitations.md`.
