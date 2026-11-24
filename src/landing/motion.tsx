// The landing page's small motion helpers (10 Nov 2026): a looping playhead for the scripted demos, a reveal on
// scroll that never hides content without JavaScript, a number that counts up, a card that tilts under the pointer
// and a scroll progress for the 3D window. All of them stand still under prefers-reduced-motion.
import React, { useEffect, useRef, useState } from 'react';

export const still = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Milliseconds along a looping timeline. Runs only while its element is on screen and not paused; without motion it
 *  rests at `rest` (the finished frame). */
export function usePlayhead(duration: number, rest: number): { t: number; ref: React.RefObject<HTMLDivElement>; seek(ms: number): void; pause(on: boolean): void } {
  const ref = useRef<HTMLDivElement>(null);
  const [t, setT] = useState(rest);
  const state = useRef({ t: rest, paused: false, visible: false, moving: !still() });
  useEffect(() => {
    const s = state.current; if (!s.moving) return;
    s.t = 0; setT(0);
    let frame = 0, last = performance.now(), shown = 0;
    const tick = (now: number) => {
      const elapsed = Math.min(80, now - last); last = now;
      if (s.visible && !s.paused && !document.hidden) { s.t = (s.t + elapsed) % duration; if (Math.abs(s.t - shown) > 30 || s.t < shown) { shown = s.t; setT(s.t); } }
      frame = requestAnimationFrame(tick);
    };
    const watch = new IntersectionObserver(([entry]) => { s.visible = entry.isIntersecting; }, { threshold: 0.25 });
    if (ref.current) watch.observe(ref.current);
    frame = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(frame); watch.disconnect(); };
  }, [duration]);
  return { t, ref, seek: ms => { state.current.t = ms; setT(ms); }, pause: on => { state.current.paused = on; } };
}

/** 0 → 1 between two moments of a timeline. */
export const span = (t: number, from: number, to: number) => Math.max(0, Math.min(1, (t - from) / (to - from)));

/** Children rise into place when they scroll into view. The hidden start exists only once the script runs and the
 *  observer is there; three seconds later everything is shown whatever happened. */
export function Reveal({ children, delay = 0, as: Tag = 'div', className = '' }: { children: React.ReactNode; delay?: number; as?: 'div' | 'section' | 'li' | 'article'; className?: string }) {
  const ref = useRef<HTMLElement>(null);
  const [state, setState] = useState<'rest' | 'wait' | 'in'>('rest');
  useEffect(() => {
    const element = ref.current; if (!element || still() || !('IntersectionObserver' in window)) return;
    if (element.getBoundingClientRect().top < window.innerHeight * 0.92) return;
    setState('wait');
    const watch = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) { setState('in'); watch.disconnect(); } }, { rootMargin: '0px 0px -8% 0px' });
    watch.observe(element);
    const safety = window.setTimeout(() => setState('in'), 3000 + delay);
    return () => { watch.disconnect(); window.clearTimeout(safety); };
  }, []);
  return React.createElement(Tag, { ref, className: `${className}${state === 'wait' ? ' lp-wait' : state === 'in' ? ' lp-in' : ''}`.trim(), style: delay ? { transitionDelay: `${delay}ms` } : undefined }, children);
}

/** A number that counts up once, when it is first seen. Its final value is in the markup from the start. */
export function CountUp({ value, format }: { value: number; format(value: number): string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(value);
  useEffect(() => {
    const element = ref.current; if (!element || still()) return;
    let frame = 0;
    const watch = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return; watch.disconnect();
      const start = performance.now();
      const tick = (now: number) => { const p = Math.min(1, (now - start) / 1400); setShown(Math.round(value * (1 - Math.pow(1 - p, 4)))); if (p < 1) frame = requestAnimationFrame(tick); };
      setShown(0); frame = requestAnimationFrame(tick);
    }, { threshold: 0.6 });
    watch.observe(element);
    return () => { watch.disconnect(); cancelAnimationFrame(frame); };
  }, [value]);
  return <span ref={ref} aria-label={format(value)}>{format(shown)}</span>;
}

/** A surface that leans toward the pointer (a few degrees) and lights where the pointer is. */
export function Tilt({ children, className = '', max = 7 }: { children: React.ReactNode; className?: string; max?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const move = (event: React.PointerEvent) => {
    const element = ref.current; if (!element || event.pointerType === 'touch' || still()) return;
    const box = element.getBoundingClientRect(); const x = (event.clientX - box.left) / box.width, y = (event.clientY - box.top) / box.height;
    element.style.setProperty('--rx', `${(0.5 - y) * max}deg`); element.style.setProperty('--ry', `${(x - 0.5) * max}deg`);
    element.style.setProperty('--mx', `${x * 100}%`); element.style.setProperty('--my', `${y * 100}%`);
  };
  const leave = () => { const element = ref.current; if (!element) return; element.style.setProperty('--rx', '0deg'); element.style.setProperty('--ry', '0deg'); };
  return <div ref={ref} className={`lp-tilt ${className}`.trim()} onPointerMove={move} onPointerLeave={leave}>{children}</div>;
}

/** How far an element has travelled into the viewport: 0 as its top enters at the bottom, 1 when it is centred. */
export function useEnter(): { ref: React.RefObject<HTMLDivElement> } {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = ref.current; if (!element) return;
    if (still()) { element.style.setProperty('--enter', '1'); return; }
    let frame = 0;
    const measure = () => {
      frame = 0; const box = element.getBoundingClientRect(); const view = window.innerHeight;
      const p = Math.max(0, Math.min(1, (view - box.top) / (view * 0.5 + box.height * 0.5)));
      element.style.setProperty('--enter', p.toFixed(3));
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(measure); };
    measure(); window.addEventListener('scroll', onScroll, { passive: true }); window.addEventListener('resize', onScroll);
    return () => { window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll); cancelAnimationFrame(frame); };
  }, []);
  return { ref };
}
