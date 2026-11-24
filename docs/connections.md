# Connections and the morning inbox brief (10 November 2026)

Goal: connect Gmail and have an agent review it and send a brief every morning. This is pass 1 of
four (pass 2, Routines, is in `docs/routines.md`): the apps can be connected, and the first agent that uses them, the **morning inbox brief**, runs when you press
**Run now**. Pass 2 adds the Routines page (every weekday at 07:00, sent by e-mail or WhatsApp), pass 3 more ready
briefs, pass 4 the clean-up.

## What it does

The page is **Connections** in the rail (`/connections`; also in ⌘K search). It has three cards (Gmail, Google
Calendar and Outlook), and under them the morning brief:

- **Demo inbox.** Seven invented messages and three meetings. One is a phishing message that tries to give the AI
  orders. It needs only the OpenAI key, so anyone can see what the brief does.
- **My connected apps.** The owner's real mail and calendar. This needs the owner code on this device and at least one
  connected app.

The brief: **Needs you today**, **Today's meetings**, **Deadlines and money**, **Can wait**, **Be careful** (phishing
and messages that address an AI), and up to three **draft replies** marked «not sent». Under it, a line counts what
was read, opened, flagged and hidden.

## How it works

| Piece | File |
|---|---|
| The page, the brief panel | `src/components/connections-page.tsx`, `src/styles/connections.css`, `src/components/connection-logos.tsx` |
| Browser client, sign-in window, brief stream | `src/data/connections.ts`, `public/connections-done.html` |
| `GET/POST /api/connections` (status, connect, disconnect) | `api/connections.ts` → `server/connections.ts` |
| `POST /api/connected-run` (the brief, NDJSON) | `api/connected-run.ts` → `server/connected-run.ts` |
| The agent loop and its guards | `server/connected/run.ts` (OpenAI Agents SDK) |
| Reading mail and calendar; the demo inbox | `server/connected/inbox.ts` |
| Names hidden across tool calls | `server/connected/names.ts` (uses `src/data/privacy.ts`) |
| The brief's instructions | `shared/briefs.ts` |

The agent loop is the **OpenAI Agents SDK** (`@openai/agents` 0.21.0, MIT): the model asks for a tool, the server runs
it and sends the result back, until the brief is written.

### The guards (no brief can change them)

1. **Read only.** The agent has three tools, all reading: `list_mail`, `open_message` and `list_events`. No tool can
   send, reply, forward, label or delete, so a manipulated model has nothing to misuse.
2. **Mail is evidence, never instructions.** Every tool result is marked untrusted. A message that addresses an AI
   («ignore your previous instructions…») carries the server's warning, and the brief lists it under «Be careful».
3. **Names hidden.** Every name, address and number in a tool result becomes a placeholder before the model sees it.
   The same person keeps one placeholder across messages, and the server puts the names back before you read the brief.
   As a last check, an SDK tool guardrail withholds any result that still holds an e-mail address.
4. **Bounded.** At most 12 model turns, 10 opened messages, 25 messages per list and 4 minutes per brief. Only
   messages that `list_mail` returned can be opened.
5. **Private.** SDK tracing is off, and nothing is stored with the provider (`store: false`; the reasoning between tool
   turns travels encrypted with the request).

### One owner until accounts exist

The app has no accounts yet, so connections belong to **one owner**. The server holds `CONNECTIONS_OWNER_CODE`, and
every call that touches the owner's apps must carry it (header `X-Owner-Code`, compared in constant time). The owner
types the code once per device, on the Connections page, and it is kept in that browser only. A visitor without the
code sees nothing connected and can only try the demo inbox. With accounts, each user becomes their own Composio
user (`agents-u-<account id>`).

## Setting it up (owner, once)

1. At **composio.dev**, create a project for this app, for example «Agents».
2. In **Auth Configs**, add one config each for **Gmail**, **Google Calendar** and **Outlook**, with Composio's managed
   auth (the default). Copy each `ac_…` id.
3. In **Settings → API Keys**, create a key with full access (a scoped key cannot make sign-in links).
4. Choose an owner code of 16 or more characters, like a password.
5. Add these to `.env.local` (and later to Vercel):

   ```
   OPENAI_API_KEY=sk-…
   COMPOSIO_API_KEY=ak_…
   COMPOSIO_AUTH_CONFIGS={"gmail":"ac_…","googlecalendar":"ac_…","outlook":"ac_…"}
   CONNECTIONS_OWNER_CODE=your-own-long-code
   ```

6. Restart the dev server. Open **Connections**, type the owner code, then press **Connect Gmail**.

Without these values the page says connections are not switched on, and nothing breaks.

## Tests

`node --experimental-transform-types tests/connected.mjs` runs 16 checks, with no network and no key. They cover:

- the owner code;
- every Composio call (user, link, disconnect, read-only tool slugs, time window);
- Gmail- and Outlook-shaped items;
- stable placeholders;
- the injection flag;
- the read-only toolset;
- the route's refusals;
- a whole brief through the SDK's scripted test model. In that brief the model sees no name or address, the phishing
  message carries the warning, an id that was never listed is refused, and the owner reads the real names.

## Not verified live, with the reason

| Item | Status |
|---|---|
| A real brief | No OpenAI key in this project. The loop is proved with the SDK's scripted model only. |
| Gmail tools | Composio's slugs (`GMAIL_FETCH_EMAILS`); `GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID` has not been run live. |
| Google Calendar | `GOOGLECALENDAR_EVENTS_LIST` arguments follow Composio's documentation (read 10 November); not run live. |
| Outlook | `OUTLOOK_LIST_MESSAGES` and `OUTLOOK_GET_CALENDAR_VIEW` as Composio documents them; `OUTLOOK_GET_MESSAGE` not run live. |
| Many users | Google requires a security review (CASA) before more than 100 users may grant Gmail read access through your own Google app. Composio's shared, already-approved app avoids this while you test. |

## More apps (11 November 2026)

Eighteen more apps (21 in all), each read-only, with tool names checked on `docs.composio.dev/toolkits/<slug>.md` (11 Nov 2026):

| App | Composio toolkit | What the brief reads |
|---|---|---|
| Google Drive | `GOOGLEDRIVE` | Files changed in the window |
| Microsoft Teams | `MICROSOFT_TEAMS` | Messages in your 5 latest chats; your Planner tasks |
| OneDrive | `ONE_DRIVE` | Your recent files |
| Slack | `SLACK` | Messages you can see, newest first |
| Zoom | `ZOOM` | Upcoming meetings |
| Notion | `NOTION` | Pages edited recently |
| Dropbox | `DROPBOX` | Files changed in the window |
| GitHub | `GITHUB` | Notifications; open issues assigned to you |
| Jira | `JIRA` | Your issues updated in the window |
| Trello | `TRELLO` | Unread notifications |
| HubSpot | `HUBSPOT` | Recently changed calls, meetings, notes and tasks |
| Box | `BOX` | Files you opened recently |
| Calendly | `CALENDLY` | Meetings booked with you (reads your user first: Calendly does not accept «me») |
| GitLab | `GITLAB` | Open issues assigned to you |
| Confluence | `CONFLUENCE` | Pages changed in the window (CQL) |
| Figma | `FIGMA` | Files changed in the window, in the first 6 projects of your team. Needs your **team link**, pasted once on the Figma card (only the team number is kept, per person, in `.data/connection-settings.json`) |
| Linear | `LINEAR` | Issues assigned to you (reads your user first) |
| Asana | `ASANA` | Tasks assigned to you in your first workspace (reads your user and workspace first) |

To switch one on, add an auth config for it in Composio (managed auth) and its id to `COMPOSIO_AUTH_CONFIGS`, keyed by
the app's id: `googledrive`, `microsoftteams`, `onedrive`, `slack`, `zoom`, `notion`, `dropbox`, `github`, `jira`,
`trello`, `hubspot`, `box`, `calendly`, `gitlab`, `confluence`, `figma`, `linear`, `asana`. The agent reads them with one tool, `list_updates`, under the same guards as mail.

**Left out, with the reason.** Telegram (Composio reads only a bot's pending updates, and reading them consumes
them), WhatsApp (Composio has no tool that reads incoming messages; the app already sends briefs to WhatsApp),
Discord (reading needs a bot in your server and channel ids).
