# Smart features (7 November 2026)

Six features built at the owner's request to make the subscription worth paying for. Each section says what it does,
where it lives, and what is not true yet.

## 1. Proof on every sentence

The agent marks every sentence it takes from a source and quotes the source's exact words in a proof block at the end
of the answer (`server/proof.ts`, rules added to the run instruction). The app hides the block, turns each mark into a
small numbered button, checks every quote — against the attached document or reference text in the browser, against
the official page through `/api/official-page` — and colours the mark: checked, close (the words differ slightly), not
found. A bar under the answer counts the statements with proof and lists the statements that make a claim without one.
Pressing a mark opens the source beside the conversation at the quoted words: the document passage highlighted, or the
official page with the passage highlighted by the page bridge (`api/official-web.ts`, `quote` parameter).

Code: `src/data/proof.ts` (parsing, quote matching, statements), `src/components/proof-view.tsx`,
`src/components/document-passage.tsx`. Tests: `tests/proof.mjs`.

## 2. House style

Settings for every agent of every field: tone and form, standing positions, rules the agents have learned (each answer
has «Remember» to teach one), templates and examples, and a letterhead (name, address, footer, accent colour, logo).
Every run carries it (`house` in the run request; masked with everything else when names are hidden); the server adds
it to the instruction after the agent's own, deciding tone and form only. The letterhead brands the Word, Excel and
PowerPoint files. Page: rail → House style (`src/components/house-style.tsx`).

## 3. Agent chains

Agents one after another on one task: each step reads the user's task, the documents and the previous step's result,
and does its own part. Five ready-made chains (lease → tenant letter → Greek; month-end commentary → one-slide summary;
role brief → job description → interview guide; angry customer → reply → macro; meeting notes → minutes → recap); the
user copies one or builds their own (agent finder by name or task, ask per step, reorder, up to eight steps). A run
shows each step as it works; the last twenty runs are kept. House style and hidden names apply to every step.
Page: rail → Chains (`src/components/chains.tsx`, `src/data/chains.ts`).

## 4. Finished files

Under every answer: Word (letterhead, styles, real lists, tables with a shaded header, clickable links, the official
sources at the end, page numbers), Excel when the answer has tables (one sheet per table, numbers as numbers),
PowerPoint (a 16:9 deck: title slide, one slide per section, tables as tables, the logo on every slide), and — when the
agent marked up an attached document — Word with tracked changes and comments, made from the agent's machine-readable
list of edits (the run instruction asks for it when a document is attached and the user asks for edits).
Code: `src/data/office/` (`docx.ts`, `xlsx.ts`, `pptx.ts`, `redline.ts`). Tests: `tests/office.mjs`.

## 5. Send work from anywhere

- **Photos in a conversation**: JPEG, PNG or WebP go to the AI as images with the next question (scaled to 1,600 px in
  the browser). Names in a photo cannot be hidden, so with names hidden the app asks once per conversation.
- **Share to Agents** (Android): once the app is installed from the browser, «Share» in any app offers Agents; shared
  files and text open «Tell me the task», and the chosen agent receives the files (`public/manifest.webmanifest`,
  `public/sw.js`). iPhone Safari does not support sharing into web apps.
- **E-mail and WhatsApp**: complete server routes, switched off until the owner connects the accounts
  (`server/inbound/`, `api/inbound-email.ts`, `api/whatsapp.ts`). See the environment variables below.

## 6. A privacy promise users can see

Rail → Settings → «How your data is protected» (`src/components/privacy-page.tsx`): each promise with its real state
on this server, from `/api/status`. Names hidden (on by default), documents read on the device, conversations in the
browser, OpenAI API data not used for training and answers not stored (`store: false`), research limited to official
sites. «Processed in the EU» and «runs in the EU» show «Waits» until the owner sets them up: an OpenAI project with
European data residency (its address in `OPENAI_BASE_URL`) and the deployment (`vercel.json` already asks for Frankfurt,
`fra1`).

## Waits on the owner

| Item | What is needed |
|---|---|
| Any live answer, proof check against a real answer, the AI's chain steps | `OPENAI_API_KEY` in `.env.local` |
| EU processing | A new OpenAI project with European data residency; its address in `OPENAI_BASE_URL` |
| EU hosting | Deployment (not authorised yet); `vercel.json` is set to `fra1` |
| E-mail channel | See the e-mail variables below; a domain for inbound mail; deployment |
| WhatsApp channel | See the WhatsApp variables below; a Meta app and number; deployment |
| Share to Agents on a phone | Deployment over https (a phone cannot install from this computer's localhost) |

## E-mail and WhatsApp: settings and webhooks

Both channels answer only addresses and numbers on the server's list (an empty list means nobody), hide names before
the AI (unless `INBOUND_SHOW_NAMES=1`), refuse photos while names are hidden (unless `INBOUND_ALLOW_IMAGES=1`), ask
«which place?» before a researching agent runs, and reply with the answer, its official sources and the Word file.
Only the ready-made agents (1,033 since 10 November) can be used (the user's own agents live in the browser).

| Variable | Purpose |
|---|---|
| `INBOUND_EMAIL_USER`, `INBOUND_EMAIL_PASSWORD` | Basic credentials in the Postmark webhook URL (no colon in the user name) |
| `INBOUND_ALLOWED_SENDERS` | Comma-separated e-mail addresses allowed to send work; empty = nobody |
| `POSTMARK_SERVER_TOKEN` | Postmark server token for sending the replies |
| `INBOUND_FROM_ADDRESS` | The From address of the replies (a verified Postmark sender) |
| `POSTMARK_MESSAGE_STREAM` | Optional; default `outbound` |
| `WHATSAPP_VERIFY_TOKEN` | Token for Meta's webhook verification |
| `WHATSAPP_APP_SECRET` | App secret for the `X-Hub-Signature-256` check |
| `WHATSAPP_TOKEN` | Graph API token (media and messages) |
| `WHATSAPP_PHONE_NUMBER_ID` | The business number's id |
| `WHATSAPP_ALLOWED_NUMBERS` | Comma-separated numbers allowed to send work; empty = nobody |
| `WHATSAPP_GRAPH_VERSION` | Optional; default `v24.0` |
| `INBOUND_SHOW_NAMES`, `INBOUND_ALLOW_IMAGES` | Optional switches (`1`), described above |
| `INBOUND_LANGUAGE`, `INBOUND_MAX_PER_HOUR` | Optional: answer language (default `en`), messages per sender per hour (default 20) |

- **Postmark** (Server → Settings → Inbound webhook): `https://<INBOUND_EMAIL_USER>:<INBOUND_EMAIL_PASSWORD>@<domain>/api/inbound-email`.
  The address's local part can name the agent, e.g. `finance-month-end-commentary@in.<domain>`; otherwise the agent is
  picked from the task (`/agent name` on the first line also works). Needs an inbound domain with an MX record to
  `inbound.postmarkapp.com` (or Postmark's own `…@inbound.postmarkapp.com` address) and a verified sender domain.
- **Meta** (App → WhatsApp → Configuration): callback `https://<domain>/api/whatsapp`, verify token
  `WHATSAPP_VERIFY_TOKEN`, subscribe to `messages`. Needs a business account, a number, a permanent token and Meta's
  review before anyone outside the test numbers can use it.
- **Reliability**: the webhook is answered at once and the work runs after it (Vercel's `waitUntil`, up to 800 s);
  de-duplication, rate limits and a 30-minute «waiting for the place» memory live in one server instance. For
  production a queue (Vercel Queues, QStash, SQS) and a small KV store are needed. Vercel limits a request to 4.5 MB,
  so very large e-mail attachments are refused there.
- **Sender trust**: the e-mail allow-list trusts the From address, and mail whose SPF check failed is refused. A forged
  From that passes SPF (a domain without SPF, or a «softfail») is not caught; before opening the channel to clients,
  require DMARC alignment or give each user a secret address.
