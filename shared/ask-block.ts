// An agent's questions to the person (12 Nov 2026, his «when the agent needs to ask, a panel pops up above the input
// bar, not questions in the chat»). The agent answers with only a fenced «ask» block; the app shows it as a panel with
// answers to tap, and the person's choices go back as their next message.

export type AskQuestion = { question: string; options: string[] };

/** The instruction every agent gets (server/agent-run.ts). */
export const ASK_RULE = `- Work like a senior professional taking instructions: first work out which issues decide this matter (for a landlord ending a tenancy for arrears: how much is owed and since when, whether a written demand was sent, whether the property is rent-controlled, the contract's term and notice clause), then ask for the facts that decide them and the user has not given. Do not write questions in your answer: reply with only this block and nothing before or after it:
\`\`\`ask
{"questions":[{"question":"…","options":["…","…"]}]}
\`\`\`
At most 3 questions per round, each about ONE fact, under 15 words, with 2 to 4 short likely answers (under 6 words each). For a choice give 2 to 4 short answers to tap; for a fact only the user can type (what the idea is, a name, an amount) give an empty options list: the app shows a text box. Never ask for documents: say what to attach in your answer instead. When the task turns on the law of a place and no country is known, one question must be which country applies.
- An answer may open a new issue (arrears → how much and since when; a deadline → whether it has passed): then ask one more round about it. At most 3 rounds in a conversation; after that, or when the user skips or says to use your judgement, answer on stated assumptions and list the open points. Never ask what the user already told you, and never ask a question whose answer would not change your answer. A question that is already clear gets its answer straight away.`;

/** The questions when an answer is only an «ask» block (allowing stray blank lines); otherwise null. */
export function parseAsk(content: string): AskQuestion[] | null {
  const match = /^\s*```ask\s*\n([\s\S]*?)\n?```\s*$/.exec(content);
  if (!match) return null;
  try {
    const value = JSON.parse(match[1]);
    const list = (Array.isArray(value?.questions) ? value.questions : []).slice(0, 3)
      .map((item: any) => ({ question: String(item?.question ?? '').trim().slice(0, 200), options: (Array.isArray(item?.options) ? item.options : []).map((option: unknown) => String(option ?? '').trim().slice(0, 80)).filter(Boolean).slice(0, 4) }))
      .filter((item: AskQuestion) => item.question);
    return list.length ? list : null;
  } catch { return null; }
}

/** An answer that carries an «ask» block among other words or blocks (12 Nov 2026: the questions showed as raw code
 *  under a sentence and a build offer) is reduced to the block: the question comes first, the rest waits for the answer. */
export function askOnly(content: string): string {
  if (parseAsk(content)) return content;
  const match = /```ask[ \t]*\n([\s\S]*?)\n?```/.exec(content);
  if (!match) return content;
  const block = `\`\`\`ask\n${match[1]}\n\`\`\``;
  return parseAsk(block) ? block : content;
}

/** An answer still streaming that is becoming an «ask» block: hidden until it is complete. */
export const isAskStarting = (content: string) => /^\s*`{1,3}(a(s(k)?)?)?\s*$/.test(content) || /^\s*```ask\b/.test(content);

/** The person's choices, as the message that goes back to the agent. */
export const askReply = (questions: AskQuestion[], answers: string[]) => questions.map((item, index) => `${item.question} — ${answers[index]}`).join('\n');
