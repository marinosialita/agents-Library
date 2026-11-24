export type ChatReadingPosition = { area: HTMLElement; anchor: HTMLElement | null; offset: number; top: number };

/** Preserve a visible passage when opening a reader makes the conversation narrower. */
export function captureChatReadingPosition(root: HTMLElement | null, preferred?: HTMLElement | null): ChatReadingPosition | null {
  const area = root?.querySelector<HTMLElement>('.chat-area');
  if (!area || !area.clientHeight) return null;
  const bounds = area.getBoundingClientRect();
  const visible = (element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    return rect.height > 0 && rect.bottom > bounds.top && rect.top < bounds.bottom;
  };
  const anchor = preferred && area.contains(preferred) && visible(preferred) ? preferred
    : Array.from(area.querySelectorAll<HTMLElement>('.mn-chat-ai-answer p, .mn-chat-ai-answer li, .mn-chat-ai-answer tr, .mn-chat-ai-answer h1, .mn-chat-ai-answer h2, .mn-chat-ai-answer h3, .ubub')).find(visible) || null;
  return { area, anchor, offset: anchor ? anchor.getBoundingClientRect().top - bounds.top : 0, top: area.scrollTop };
}

export function restoreChatReadingPosition(position: ChatReadingPosition | null) {
  if (!position?.area.isConnected || !position.area.clientHeight) return;
  const { area, anchor, offset, top } = position;
  area.scrollTop = anchor?.isConnected && area.contains(anchor)
    ? area.scrollTop + anchor.getBoundingClientRect().top - area.getBoundingClientRect().top - offset : top;
}

/** Scroll the document column only; scrollIntoView also scrolls ancestor containers. The passage lands in the top third, never at the bottom edge. */
export function revealDocumentPassage(content: HTMLElement | null, passage: HTMLElement | null, reducedMotion: boolean) {
  if (!content) return;
  const lead = content.clientHeight ? Math.round(content.clientHeight * 0.22) : 18;
  const top = passage ? content.scrollTop + passage.getBoundingClientRect().top - content.getBoundingClientRect().top - lead : 0;
  content.scrollTo({ top: Math.max(0, top), behavior: reducedMotion ? 'auto' : 'smooth' });
}
