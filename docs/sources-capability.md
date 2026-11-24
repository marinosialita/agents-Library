# Source and jurisdiction capability — what the research can and cannot do

Date: 6 November 2026.

## The catalogue

| Measure | Value (computed from `shared/official-sources-catalogue.ts`) |
|---|---|
| Places (countries, states, regions, the EU) | 208 |
| Places with at least one official source | 208 (every place is searchable) |
| Official sources | 1,594 |
| Source kinds | legislation, gazette, courts, parliament, regulator, government, other |
| Search domains per place | own sources → parent's sources (a German Land gets Germany's) → the EU's for a member state; capped at 100 hosts, the provider's limit |

Examples of the allow-list a place gets:

| Place | Own sources | Search hosts sent |
|---|---|---|
| Cyprus (`cy`) | 14 | 47 (with the EU's) |
| England and Wales (`ew`) | 35 | 32 |
| Germany (`de`) | 58 | 93 (with the EU's) |
| Greece (`gr`) | 29 | 64 (with the EU's) |
| European Union (`eu`) | 36 | 35 |
| United States, federal (`us`) | 45 | 45 |

The catalogue is data (`data/official-sources/*.json`) built by `npm run sources`; adding a source is a JSON edit and a rebuild. The same files are used by the reference application; nothing was copied from a private store.

## How a run researches

1. The agent names a jurisdiction (its own, or the workspace's). Nothing is chosen on the user's behalf: with no jurisdiction the composer shows «Choose jurisdiction» and does not send.
2. The server (`server/agent-run.ts`) resolves the place. Unknown code → 422 `jurisdiction_unknown`. A place without sources → 422 `jurisdiction_unsupported` with the place's name, **before** any provider call. An empty allow-list is never sent (test-covered), so a search is never widened to the open web.
3. One Responses API call, streaming, with:
   - `tools: [{ type: 'web_search', filters: { allowed_domains: [...] } }]` — the place's hosts;
   - `tool_choice: 'required'` — the model must search when the agent has official search on;
   - `include: ['web_search_call.action.sources']` — the pages the search opened, for the «also read» list;
   - the instruction names the governing jurisdiction, lists the place's sources (up to 60 by name and URL), asks for searches in the local language as well as English, and forbids answering law from memory.
4. The provider's events drive the status line: `searching`, then `searched` with the query it ran. Nothing is simulated.
5. The answer is read back (`server/official-research.ts`): every `url_citation` and every Markdown link is checked with `isOfficialUrl(place, url)`; a link outside the place's sources is reduced to its words; `utm_` parameters are stripped; pages opened but not cited are listed as consulted; gaps are reported («No official source was searched», «no page that the answer cites», «cut short»).
6. The client shows cited sources as lavender pills and a fold («3 cited · 1 more read · 2 searches»), and opens any cited page in the reader (catalogue hosts only, server-proxied, sanitised, no credentials).

Official search off (per agent): the instruction says «You have no web access in this run» and asks the model to say what would need checking.

## Models

| Choice | Default id | Override |
|---|---|---|
| Quality (default) | `gpt-6-astra` | `AGENT_MODEL` |
| Balanced (builder, explain, user's choice) | `gpt-6.1-sol` | `AGENT_MODEL_BALANCED` |
| Reasoning effort | `medium` | `AGENT_REASONING_EFFORT` |
| Official search switch | on | `OFFICIAL_WEB_SEARCH=off` |

Ids live only on the server (`server/models.ts`); the client receives the id in the run's first status line for display.

## Unsupported and partially supported

- **Any place outside the 208**: not selectable; the picker lists only catalogue places.
- **Sub-national places with few own sources** (for example a German Land with 2 sources): they search their own sources plus the parent's and the EU's, so coverage is the parent's. The picker shows the own count so the user can judge.
- **Cyprus and England & Wales**: here they are ordinary places researched on their official websites.
- **Paywalled or login-only official databases**: a host in the catalogue only helps when the provider's search can read it. Pages behind a login return nothing and the answer must say so (the instruction demands it).
- **The provider's allow-list semantics** (subdomain matching, the 100-host cap) are taken from the provider's documentation and the reference application's working integration; not re-verified live here (no key).
- **No case-law corpus, no vector index**: research is live web search of official hosts only. Deep mode gives more search budget and output, not a different method.

## What the user sees when it cannot research

| Situation | UI |
|---|---|
| No jurisdiction on the agent or workspace | «Choose jurisdiction» chip; sending blocked |
| Place without sources (none today) | the picker disables it; the server answers 422 and the chat shows «Official sources are not available for {place}» |
| No API key | «AI is not connected» in the composer, Settings and the builder |
| Search ran but cited nothing official | the gap «treat it as unverified» under the answer |
| Search did not run | the gap «No official source was searched for this answer» |
