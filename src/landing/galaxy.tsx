// The hero's globe (10 Nov 2026): one dot per real agent, gathered into a cluster per field on a slowly turning
// sphere. Drawn on a 2D canvas with its own small 3D projection (no library). Hover a dot for the agent's name, click
// to open it; drag to turn the globe. When nobody points at it, a spotlight walks from agent to agent. Without motion
// (reduced-motion) it is drawn once and still answers the pointer.
import React, { useEffect, useRef, useState } from 'react';
import { LIBRARY } from './claims.ts';

type Dot = { x: number; y: number; z: number; agent: number; near: number };
type Seen = { sx: number; sy: number; z: number; scale: number };

/** A small seeded generator: the globe looks the same on every visit. */
function seeded(seed: number) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const lighten = (hex: string, amount: number) => { const n = parseInt(hex.slice(1), 16); const mix = (c: number) => Math.round(c + (255 - c) * amount); return `${mix(n >> 16)}, ${mix((n >> 8) & 255)}, ${mix(n & 255)}`; };

function layout(): { dots: Dot[]; centres: { x: number; y: number; z: number }[] } {
  const random = seeded(20261110);
  const gauss = () => { let u = 0; while (!u) u = random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random()); };
  const fields = LIBRARY.fields.length;
  // Field centres spread evenly over the sphere (a Fibonacci lattice).
  const centres = LIBRARY.fields.map((_, index) => { const y = 1 - 2 * (index + 0.5) / fields; const r = Math.sqrt(1 - y * y); const a = index * Math.PI * (3 - Math.sqrt(5)); return { x: Math.cos(a) * r, y, z: Math.sin(a) * r }; });
  const dots: Dot[] = LIBRARY.agents.map(([, field], agent) => {
    const c = centres[field]; const spread = 0.13 + 0.012 * Math.sqrt(LIBRARY.fields[field].count);
    let x = c.x + gauss() * spread, y = c.y + gauss() * spread, z = c.z + gauss() * spread;
    const length = Math.hypot(x, y, z) || 1; const shell = 0.94 + random() * 0.12;
    x = x / length * shell; y = y / length * shell; z = z / length * shell;
    return { x, y, z, agent, near: -1 };
  });
  // Each dot is tied to its nearest neighbour of the same field: the threads inside a cluster.
  const byField = new Map<number, number[]>();
  dots.forEach((dot, index) => { const field = LIBRARY.agents[dot.agent][1]; byField.set(field, [...(byField.get(field) ?? []), index]); });
  for (const members of byField.values()) for (const i of members) {
    let best = -1, distance = Infinity;
    for (const j of members) { if (i === j) continue; const d = (dots[i].x - dots[j].x) ** 2 + (dots[i].y - dots[j].y) ** 2 + (dots[i].z - dots[j].z) ** 2; if (d < distance) { distance = d; best = j; } }
    dots[i].near = best;
  }
  return { dots, centres };
}

export function Galaxy({ onOpen }: { onOpen(agentId: string): void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [label, setLabel] = useState<{ x: number; y: number; name: string; field: string; hover: boolean; left: boolean } | null>(null);
  const open = useRef(onOpen); open.current = onOpen;
  useEffect(() => {
    const element = canvas.current; const context = element?.getContext('2d'); if (!element || !context) return;
    const { dots, centres } = layout();
    const inks = LIBRARY.colors.map(color => lighten(color, 0.42));
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let width = 0, height = 0, ratio = 1, radius = 0, cx = 0, cy = 0;
    let turn = 0.6, tilt = -0.28, tiltTo = -0.28, speed = still ? 0 : 0.00022, speedTo = speed;
    let pointer: { x: number; y: number } | null = null, drag: { x: number; y: number } | null = null;
    let hovered = -1, spot = -1, spotAt = 0, frame = 0, last = performance.now(), visible = true, moved = false;
    const seen: Seen[] = dots.map(() => ({ sx: 0, sy: 0, z: 0, scale: 0 }));
    const size = () => {
      const box = element.getBoundingClientRect(); ratio = Math.min(2, window.devicePixelRatio || 1);
      width = box.width; height = box.height; element.width = Math.round(width * ratio); element.height = Math.round(height * ratio);
      radius = Math.min(width, height) * 0.43; cx = width / 2; cy = height / 2;
    };
    const project = (x: number, y: number, z: number, out: Seen) => {
      const cosT = Math.cos(turn), sinT = Math.sin(turn), cosX = Math.cos(tilt), sinX = Math.sin(tilt);
      const x1 = x * cosT + z * sinT, z1 = z * cosT - x * sinT;
      const y2 = y * cosX - z1 * sinX, z2 = z1 * cosX + y * sinX;
      const scale = 2.6 / (2.6 - z2 * 0.9);
      out.sx = cx + x1 * radius * scale; out.sy = cy - y2 * radius * scale; out.z = z2; out.scale = scale;
    };
    const showLabel = (index: number, hover: boolean) => {
      if (index < 0) { setLabel(null); return; }
      const [name, field] = LIBRARY.agents[dots[index].agent];
      // Near the right edge the label opens to the left of its dot, and it never leaves the bottom of the canvas.
      setLabel({ x: seen[index].sx, y: Math.min(seen[index].sy, height - 70), name, field: LIBRARY.fields[field].name, hover, left: seen[index].sx > width - 270 });
    };
    const centre: Seen = { sx: 0, sy: 0, z: 0, scale: 0 };
    const draw = (now: number) => {
      const elapsed = Math.min(64, now - last); last = now;
      speed += (speedTo - speed) * 0.06; tilt += (tiltTo - tilt) * 0.05;
      if (!drag) turn += speed * elapsed;
      context.setTransform(ratio, 0, 0, ratio, 0, 0); context.clearRect(0, 0, width, height);
      // A soft halo behind the globe.
      const halo = context.createRadialGradient(cx, cy, radius * 0.2, cx, cy, radius * 1.35);
      halo.addColorStop(0, 'rgba(124, 92, 240, 0.20)'); halo.addColorStop(0.6, 'rgba(124, 92, 240, 0.06)'); halo.addColorStop(1, 'rgba(124, 92, 240, 0)');
      context.fillStyle = halo; context.fillRect(0, 0, width, height);
      for (let i = 0; i < dots.length; i++) project(dots[i].x, dots[i].y, dots[i].z, seen[i]);
      // Threads first, then the far half, then the near half: the nearer always lies on top.
      context.lineWidth = 0.6;
      for (let i = 0; i < dots.length; i++) {
        const j = dots[i].near; if (j < i || seen[i].z < -0.1) continue;
        context.strokeStyle = `rgba(${inks[LIBRARY.agents[dots[i].agent][2]]}, ${0.05 + Math.max(0, seen[i].z) * 0.12})`;
        context.beginPath(); context.moveTo(seen[i].sx, seen[i].sy); context.lineTo(seen[j].sx, seen[j].sy); context.stroke();
      }
      for (const front of [false, true]) for (let i = 0; i < dots.length; i++) {
        const p = seen[i]; if ((p.z >= 0) !== front) continue;
        const depth = (p.z + 1) / 2; const ink = inks[LIBRARY.agents[dots[i].agent][2]]; const lit = i === hovered || i === spot;
        const r = (0.7 + depth * 1.5) * p.scale * (lit ? 2.2 : 1);
        if (front) { context.fillStyle = `rgba(${ink}, ${lit ? 0.3 : 0.07 * depth})`; context.beginPath(); context.arc(p.sx, p.sy, r * (lit ? 3 : 2.3), 0, 6.2832); context.fill(); }
        context.fillStyle = lit ? 'rgba(255, 255, 255, 0.98)' : `rgba(${ink}, ${0.16 + depth * 0.8})`;
        context.beginPath(); context.arc(p.sx, p.sy, r, 0, 6.2832); context.fill();
      }
      // The field names float over the clusters that face the viewer.
      context.textAlign = 'center'; context.textBaseline = 'middle'; context.font = `600 ${width < 520 ? 10 : 11.5}px Inter, system-ui, sans-serif`;
      for (let f = 0; f < centres.length; f++) {
        project(centres[f].x * 1.16, centres[f].y * 1.16, centres[f].z * 1.16, centre);
        if (centre.z < 0.3) continue;
        context.fillStyle = `rgba(236, 232, 255, ${Math.min(0.9, (centre.z - 0.3) * 1.5)})`;
        // A name near the canvas edge is pulled inside rather than cut.
        const half = context.measureText(LIBRARY.fields[f].name).width / 2 + 6;
        context.fillText(LIBRARY.fields[f].name, Math.max(half, Math.min(width - half, centre.sx)), centre.sy);
      }
      // The pointer picks the nearest dot facing the viewer; otherwise the spotlight moves on every few seconds.
      if (pointer && !drag) {
        let best = -1, distance = 15 * 15;
        for (let i = 0; i < dots.length; i++) { if (seen[i].z < 0.05) continue; const d = (seen[i].sx - pointer.x) ** 2 + (seen[i].sy - pointer.y) ** 2; if (d < distance) { distance = d; best = i; } }
        if (best !== hovered) { hovered = best; element.style.cursor = best >= 0 ? 'pointer' : 'grab'; showLabel(best, true); }
        else if (best >= 0) showLabel(best, true);
        speedTo = best >= 0 ? 0 : still ? 0 : 0.00008;
      } else if (!drag) {
        if (hovered >= 0) { hovered = -1; setLabel(null); }
        speedTo = still ? 0 : 0.00022;
        if (now - spotAt > 2600) {
          spotAt = now; const facing: number[] = [];
          for (let i = 0; i < dots.length; i++) if (seen[i].z > 0.55 && Math.abs(seen[i].sx - cx) < radius * 0.7) facing.push(i);
          spot = facing.length ? facing[Math.floor(Math.random() * facing.length)] : -1;
        }
        if (spot >= 0) { if (seen[spot].z < 0.2) { spot = -1; setLabel(null); } else showLabel(spot, false); }
      }
      if (!still && visible) frame = requestAnimationFrame(draw);
    };
    const at = (event: PointerEvent) => { const box = element.getBoundingClientRect(); return { x: event.clientX - box.left, y: event.clientY - box.top }; };
    const move = (event: PointerEvent) => {
      const p = at(event); pointer = p;
      if (drag) { turn += (p.x - drag.x) * 0.006; tiltTo = Math.max(-0.9, Math.min(0.9, tiltTo + (p.y - drag.y) * 0.004)); if (Math.abs(p.x - drag.x) + Math.abs(p.y - drag.y) > 2) moved = true; drag = p; }
      else tiltTo = -0.28 + (p.y / Math.max(1, height) - 0.5) * 0.3;
      if (still) draw(performance.now());
    };
    const down = (event: PointerEvent) => { drag = at(event); moved = false; element.setPointerCapture(event.pointerId); element.style.cursor = 'grabbing'; };
    const up = (event: PointerEvent) => {
      const wasDrag = moved; drag = null; element.style.cursor = 'grab';
      if (!wasDrag && hovered >= 0 && event.pointerType !== 'touch') open.current(LIBRARY.agents[dots[hovered].agent][3]);
    };
    const leave = () => { pointer = null; drag = null; tiltTo = -0.28; if (still) { hovered = -1; setLabel(null); draw(performance.now()); } };
    const resize = new ResizeObserver(() => { size(); if (still) draw(performance.now()); });
    const watch = new IntersectionObserver(([entry]) => { const next = entry.isIntersecting && !document.hidden; if (next && !visible && !still) { last = performance.now(); frame = requestAnimationFrame(draw); } visible = next; });
    const hidden = () => { if (document.hidden) visible = false; else if (!still) { visible = true; last = performance.now(); cancelAnimationFrame(frame); frame = requestAnimationFrame(draw); } };
    size(); resize.observe(element); watch.observe(element); document.addEventListener('visibilitychange', hidden);
    element.addEventListener('pointermove', move); element.addEventListener('pointerdown', down); element.addEventListener('pointerup', up); element.addEventListener('pointerleave', leave);
    element.style.cursor = 'grab';
    frame = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(frame); resize.disconnect(); watch.disconnect(); document.removeEventListener('visibilitychange', hidden);
      element.removeEventListener('pointermove', move); element.removeEventListener('pointerdown', down); element.removeEventListener('pointerup', up); element.removeEventListener('pointerleave', leave); };
  }, []);
  return <div className="lp-galaxy">
    <canvas ref={canvas} role="img" aria-label={`A turning globe of ${LIBRARY.counts.agents} dots, one for every agent, gathered by field`} />
    {label && <span className={`lp-galaxy-label${label.hover ? ' is-hover' : ''}${label.left ? ' is-left' : ''}`} style={{ transform: `translate(${Math.round(label.x)}px, ${Math.round(label.y)}px)` }} aria-hidden="true">
      <b>{label.name}</b><small>{label.field}{label.hover ? ' · click to open' : ''}</small></span>}
  </div>;
}
