# Launch build (10 November 2026)

What was added for the launch, at the owner's request, and what the launch still waits on.

## The library: 1,033 agents in 29 fields

Seven fields joined the twenty-two, each with eight areas and 36 ready-made agents written to
`docs/field-agents-spec.md` (its last section holds their honest limits) and checked by
`scripts/check-field-agents.mjs`: **IT & cybersecurity** (`it`, defensive work only), **Banking & investment**
(`finserv`, for finance professionals; never personalised investment advice), **Retail & e-commerce** (`retail`),
**Manufacturing & engineering** (`manufacturing`; the safety officer or responsible engineer decides),
**Sustainability & ESG** (`sustainability`; no claim without the user's evidence), **Startups & fundraising**
(`startups`; never investment, legal or tax advice) and **Project management** (`projects`).

Counts, from the catalogue: 109 Legal + 924 in the other 28 fields = **1,033 agents**, 221 areas, 9,297 starters;
177 agents research official sources; the catalogue source is about 2.9 MB.

## Chain Agents: 50 ready-made chains

`src/data/chains-ready.ts` holds the fifty chains (name «A → B → C», two sentences, and per step the agent and its
ask), checked by `scripts/check-chains.mjs`: every agent exists, every field opens at least one chain and at most
four, an agent opens one chain at most and serves in three at most, at least thirty chains have three steps. The page
(`src/components/chains.tsx`) is a library of its own: a wide search, Ready-made / My chains with counts, a field
filter, the chains as cards (Copy & edit, View chain), and a chain's own page with its steps and the run.

## The landing page: `/welcome`

A separate entry (`welcome.html`, `src/landing/`) with its own small bundle (about 75 KB compressed); it never loads
the app's catalogue.

- **Hero**: a 3D globe drawn on a canvas (no library), one dot per real agent, gathered in a cluster per field. Drag
  turns it, hovering a dot names the agent, a click opens that agent in the app.
- **Live scenes**: scripted loops, each marked «Demo» or «Example» — the builder in a tilted window (describe → four
  build stages → the agent beside its test, with proof marks), the task finder, a chain at work, proof on a sentence,
  names hidden. They use real agent and chain names from the library; the example answers and documents are written
  for the page and are not recordings of the AI.
- **Numbers**: every count on the page is read from `src/landing/library-index.json`, generated from the catalogue
  by `scripts/build-landing-index.mjs` (run by `npm run build`); a test fails when the file is stale.
- **Claims**: all in `src/landing/claims.ts`. The page says «Building the biggest agent library in the world» as the
  mission, beside the real counts. It does not say the library IS the biggest: public GPT stores and form-bot
  template galleries are larger by count, and a measured superlative that is untrue is unlawful advertising in most
  markets. No testimonials, customer logos, user counts or prices are shown, because none exist yet.
- **Motion**: everything is visible at rest; under `prefers-reduced-motion` the globe is drawn once and the scenes
  rest on their finished frame.
- **First visit**: a first visit to `/` (no app data in the browser) is sent to `/welcome`; «Open the library»
  (`/?open`), any deep link and every returning visitor go straight to the app. `vercel.json` rewrites `/welcome`.

## In the app

- **Search everything**: ⌘K / Ctrl+K (and «Search» in the rail) finds an agent of any field by name or task, a chain
  or a page.
- **Brand**: the phone browser bar is the pearl canvas; exported files without a letterhead use the lavender accent.

## Before going live

| Item | State |
|---|---|
| A real answer from any agent, a chain run, the task finder's AI picks, proof marks on a real answer | Not seen: no `OPENAI_API_KEY`. Test live before launch. |
| Accounts, sign-in, payments | Not built. Everything is kept in the visitor's browser. |
| Deployment | Not authorised. `vercel.json` is ready (Frankfurt, `/welcome` rewrite). |
| EU processing | Waits for an OpenAI project with European data residency (`OPENAI_BASE_URL`). |
| First load of the app | About 1 MB compressed (the whole catalogue ships with the app). The landing page is separate and light. |
| New agents' content | Written by AI writers to the spec and machine-checked for shape; not reviewed line by line by a professional of each field. Standards are named, not quoted, and agents are told to read the current text. |
