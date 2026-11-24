# Routines (10 November 2026)

Pass 2 of «connect my gmail and set the agent to review and give me a brief every morning». A **routine** is a brief
that runs on its own. You choose the days, the time and the time zone. At that moment it reads your apps (or the demo
inbox) and sends you the result: always in the app, and by e-mail or WhatsApp if you choose.

## The page

**Routines** in the rail (`/routines`; also in ⌘K search, and «Open Routines» under the brief on Connections).

- **Your routines.** One card per routine, showing:
  - the schedule (for example «Weekdays at 07:00») and time zone;
  - where it reads and where it sends;
  - the next and the last run;
  - an on/off switch, **Run now**, Edit and Delete.
- **New routine:**
  - name and brief;
  - read from the demo inbox or your connected apps;
  - days (with Weekdays and Every day shortcuts), time and time zone;
  - an e-mail address and a WhatsApp number to send to;
  - names hidden.
- **History.** Every run, scheduled or Run now. Open one to see its steps, the brief, what it read and where it was
  sent. A failed run says why.

## Where it runs

| Piece | File |
|---|---|
| Model, schedule maths (time zones and summer time through `Intl`), input check | `shared/routines.ts` |
| Store: JSON files in `.data/` (ignored by git), written by rename, one queue per process | `server/routines/store.ts` |
| One run: open the inbox, run the brief with the Connections guards, send, keep the run | `server/routines/run.ts` |
| Sending by Postmark and WhatsApp, only to allowed recipients | `server/routines/deliver.ts` |
| `GET/POST /api/routines` (owner code) and `GET /api/routines-tick` (`CRON_SECRET`) | `server/routines/routes.ts`, `api/routines.ts`, `api/routines-tick.ts` |
| The clock on your Mac: every minute, inside the dev server | `vite.config.ts` (`ROUTINES_LOCAL_TICK=off` stops it) |
| The page | `src/components/routines-page.tsx`, `src/data/routines.ts`, `src/styles/connections.css` |

- **A slot runs once.** The store claims it before the run, so two ticks at the same moment still give one brief.
- **A late slot is skipped.** A slot still runs up to 90 minutes late (for example, the Mac woke up late). After that
  it is skipped, so a 07:00 brief never arrives at lunchtime.
- **No catch-up after a pause.** A routine you switch off and on again does not run the slots it missed.
- **New routines start next time.** A routine made after today's time starts tomorrow.

## Who receives a brief

A brief holds your mail, so it is sent **only** to an address on `INBOUND_ALLOWED_SENDERS` or a number on
`WHATSAPP_ALLOWED_NUMBERS`. These are the same allow-lists the inbound channels use: your own. The page offers only
those, and the server refuses any other recipient, even one sent by hand.

- **E-mail** goes through Postmark (`POSTMARK_SERVER_TOKEN`), sent from `ROUTINES_FROM_ADDRESS` (or
  `INBOUND_FROM_ADDRESS`). It is marked automatic, with no open or link tracking.
- **WhatsApp** goes through Meta's Cloud API (`WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`). Meta delivers a message
  the business starts only within 24 hours of your last message to the number. Outside that window the run says so
  (error 131047). E-mail always arrives.

## What it still needs

| Item | Why | What is needed |
|---|---|---|
| The OpenAI key | Without it every run is kept as failed: «The AI is not connected». | `OPENAI_API_KEY` in `.env.local`. |
| The owner code | Routines are the owner's (they read your mail). | `CONNECTIONS_OWNER_CODE` (docs/connections.md), typed once on Connections. |
| Your apps | A routine on «My connected apps» needs Composio and at least one connected app. | docs/connections.md. |
| E-mail or WhatsApp | Optional; the app always keeps the brief. | Postmark or Meta accounts and the allow-lists (docs/smart-features.md). |
| Running on the web | On a serverless host files do not last, so the store refuses there. The host's scheduler must also call the tick. | A database (the Supabase project waiting for your yes, or Vercel Blob). Then add to `vercel.json`: `"crons": [{ "path": "/api/routines-tick", "schedule": "*/5 * * * *" }]` and set `CRON_SECRET`. On Vercel's Hobby plan crons run only once a day, so this needs Pro. |

Until then, routines run on **your Mac while the dev server is running**.

## Tests

`node --experimental-transform-types tests/routines.mjs` runs 12 checks (no network, no key):

- 07:00 in Cyprus in summer and in winter, across the 25 October clock change, and in New York;
- weekday skipping;
- the grace window, once only, not before the routine existed, never when off;
- the input check;
- the file store, and three claims at once giving one run;
- delivery only to allowed recipients, the e-mail's form, and WhatsApp's 24-hour error;
- a whole run on the demo inbox through the SDK's scripted model, with the e-mail sent;
- a run without the key, kept as failed;
- a slot run once over two ticks;
- the routes (owner code, store, save, refusing a recipient, on and off, delete, Run now);
- the tick's secret.
