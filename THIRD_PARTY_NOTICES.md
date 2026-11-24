# Third-party notices

Open-source code this app ships with beyond the usual React and Vite toolchain, and the licence each one comes under.
Every package keeps its own licence file in `node_modules/<package>/LICENSE`.

| Package | Version | Licence | Copyright | Used for |
|---|---|---|---|---|
| `@openai/agents` (and `@openai/agents-core`, `@openai/agents-openai`) | 0.21.0 | MIT | © 2025 OpenAI | The connected agents' loop: tools, guardrails, streaming (`server/connected/run.ts`) |
| `zod` | 4.6.7 | MIT | © 2025 Colin McDonnell | The tools' parameter schemas |
| `better-auth` (and its `@better-auth/*` parts) | 1.7.14 | MIT | © 2024 – present Bereket Engida | Accounts: sign up, sign in, sessions (`server/auth/auth.ts`) |
| `@xyflow/react` (and `@xyflow/system`) | 12.12.0 | MIT | © 2019–2025 webkid GmbH | The chain map (`src/components/chain-canvas.tsx`) |
| `@react-email/components` (and its `@react-email/*` parts) | 1.0.12 | MIT | © 2024 Plus Five Five, Inc | The brief e-mail's layout (`server/routines/brief-email.ts`) |

Tools used, not shipped in the app: `promptfoo` 0.125.1 (MIT, © 2025 promptfoo), run on demand by `npm run eval` (`evals/`).
Ideas only, no code taken: Docassemble (guided documents), SheetJS (Excel reading: our own reader, `src/data/xlsx-text.ts`).

Code ported from MyNomosAI (connections, sign-in window, logos) is the owner's own.

## MIT licence

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the Software without restriction, including without limitation the
rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit
persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the
Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## Simple Icons 13.21.0 — CC0-1.0

The connector marks on Connections (src/components/connection-logos.tsx) are the path data of Simple Icons
(https://simpleicons.org, https://github.com/simple-icons/simple-icons), dedicated to the public domain under CC0 1.0.
The brands themselves remain their owners' trademarks; they are shown only to name the service a person connects.
