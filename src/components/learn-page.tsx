// «Watch and Learn» (11 Nov 2026, after the Lindy study): show how you do a task — record your screen, or upload a
// recording or a written process — and the AI writes down the procedure. You correct it, then «Build it for me» makes
// the agent, which you test and save as usual. Only still frames leave this browser (one every 3 seconds, at most 24),
// never the video or sound, and only when you press «Write the procedure».
import React, { useEffect, useRef, useState } from 'react';
import { ArrowRight, Eye, FileText, Film, Loader2, MonitorUp, Plus, Square, Trash2, TriangleAlert, Wand2, X } from 'lucide-react';
import { processAsTask, type LearnedProcess } from '../../shared/learn.ts';
import { readFiles, ToolBar } from './nomos-chrome.tsx';

const EVERY_MS = 3_000, MAX_FRAMES = 24, KEEP_WHILE_RECORDING = 200, MAX_SECONDS = 600;
const FAILURES: Record<string, string> = { agent_unavailable: 'The AI is not connected on this server yet (no OpenAI key), so nothing was sent.', request_too_large: 'Too much to send at once. Record a shorter demonstration.', invalid_input: 'Add a recording, a video or a written process first.', unavailable: 'The AI did not answer. Try again in a moment.' };

/** One frame of a video element as a small JPEG (at most 1280 px wide), the size the AI needs to read a screen. */
function grab(video: HTMLVideoElement): string | null {
  if (!video.videoWidth) return null;
  const scale = Math.min(1, 1280 / video.videoWidth);
  const canvas = document.createElement('canvas'); canvas.width = Math.round(video.videoWidth * scale); canvas.height = Math.round(video.videoHeight * scale);
  canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height);
  let url = canvas.toDataURL('image/jpeg', 0.62);
  if (url.length > 200_000) url = canvas.toDataURL('image/jpeg', 0.45);
  canvas.width = 0; canvas.height = 0;
  return url.length <= 215_000 ? url : null;
}
/** At most `count` frames, evenly spread over all of them. */
const spread = (frames: string[], count: number) => frames.length <= count ? frames : Array.from({ length: count }, (_, index) => frames[Math.round(index * (frames.length - 1) / (count - 1))]);

async function framesOfVideo(file: File): Promise<string[]> {
  const video = document.createElement('video'); video.muted = true; video.preload = 'auto'; video.src = URL.createObjectURL(file);
  try {
    await new Promise<void>((resolve, reject) => { video.onloadeddata = () => resolve(); video.onerror = () => reject(new Error('video')); });
    const duration = Math.min(video.duration || 0, 3_600); if (!duration) return [];
    const count = Math.min(MAX_FRAMES, Math.max(4, Math.floor(duration / 5))); const out: string[] = [];
    for (let index = 0; index < count; index++) {
      video.currentTime = (duration * (index + 0.5)) / count;
      await new Promise<void>(resolve => { video.onseeked = () => resolve(); });
      const frame = grab(video); if (frame) out.push(frame);
    }
    return out;
  } finally { URL.revokeObjectURL(video.src); }
}

export function LearnPage({ onBuild }: { onBuild(task: string): void }) {
  const [frames, setFrames] = useState<string[]>([]);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [notes, setNotes] = useState('');
  const [documents, setDocuments] = useState<{ name: string; text: string }[]>([]);
  const [busy, setBusy] = useState<'' | 'reading' | 'writing'>('');
  const [error, setError] = useState('');
  const [process, setProcess] = useState<LearnedProcess | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<number | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const pickVideo = useRef<HTMLInputElement>(null);
  const pickDoc = useRef<HTMLInputElement>(null);
  const stop = () => { if (timer.current) window.clearInterval(timer.current); timer.current = null; stream.current?.getTracks().forEach(track => track.stop()); stream.current = null; setRecording(false); };
  useEffect(() => stop, []);

  const record = async () => {
    setError('');
    try {
      const shared = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 5 }, audio: false });
      stream.current = shared; setFrames([]); setSeconds(0); setRecording(true);
      shared.getVideoTracks()[0]?.addEventListener('ended', stop);
      const element = video.current!; element.srcObject = shared; await element.play();
      const started = Date.now();
      timer.current = window.setInterval(() => {
        const frame = grab(element); if (frame) setFrames(current => [...current, frame].slice(-KEEP_WHILE_RECORDING));
        const elapsed = Math.round((Date.now() - started) / 1000); setSeconds(elapsed); if (elapsed >= MAX_SECONDS) stop();
      }, EVERY_MS);
    } catch { setError('Screen sharing was not started. Your browser asks which screen or window to share; nothing is shared until you choose.'); stop(); }
  };
  const fromVideo = async (file: File) => { setBusy('reading'); setError(''); try { const read = await framesOfVideo(file); if (!read.length) throw new Error('none'); setFrames(read); } catch { setError('That video could not be read here. Use MP4, MOV or WebM.'); } finally { setBusy(''); } };
  const fromDocs = async (files: File[]) => { setBusy('reading'); try { const read = await readFiles(files); setDocuments(current => [...current, ...read.map(doc => ({ name: doc.name, text: doc.text.slice(0, 20_000) }))].slice(0, 3)); } finally { setBusy(''); } };
  const write = async () => {
    setBusy('writing'); setError('');
    try {
      const response = await fetch('/api/learn', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ frames: spread(frames, MAX_FRAMES), notes: notes.trim(), documents }) });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.process) throw new Error(typeof data?.error === 'string' ? data.error : 'unavailable');
      setProcess(data.process);
    } catch (failure) { setError(FAILURES[(failure as Error).message] ?? FAILURES.unavailable); } finally { setBusy(''); }
  };
  const setStep = (index: number, patch: Partial<LearnedProcess['steps'][number]>) => setProcess(current => current && ({ ...current, steps: current.steps.map((item, at) => at === index ? { ...item, ...patch } : item) }));
  const ready = (frames.length > 0 || documents.length > 0) && !recording && !busy;

  return <div className="nomos-tool-scroll mn-learn">
    <ToolBar icon={Eye} title="Watch and Learn" />
    <div className="mn-learn-page">
      <header className="mn-conn-hero"><h1>Show it once. Get an agent that does it your way.</h1>
        <p>Record your screen while you do a task, or upload a recording or a written process. The AI writes down your steps; you correct them; then it builds the agent.</p></header>
      {!process ? <>
        <section className="mn-learn-grid">
          <div className="mn-learn-card">
            <h2><MonitorUp size={17} aria-hidden="true" />Record your screen</h2>
            <p>Do the task as usual and say in the notes why you make each choice. One still frame is kept every 3 seconds; no video or sound leaves this browser.</p>
            <video ref={video} className="mn-learn-live" muted playsInline hidden={!recording} />
            {recording ? <button type="button" className="nomos-btn mn-learn-stop" onClick={stop}><Square size={13} aria-hidden="true" />Stop · {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')} · {frames.length} frames</button>
              : <button type="button" className="nomos-btn is-primary" onClick={() => void record()} disabled={!!busy}><MonitorUp size={14} aria-hidden="true" />Start recording</button>}
          </div>
          <div className="mn-learn-card">
            <h2><Film size={17} aria-hidden="true" />Or upload</h2>
            <p>A screen recording (MP4, MOV, WebM, up to an hour), or a written process (PDF, Word, text) — up to three.</p>
            <span className="mn-learn-buttons">
              <button type="button" className="nomos-btn" onClick={() => pickVideo.current?.click()} disabled={!!busy || recording}><Film size={14} aria-hidden="true" />A recording</button>
              <button type="button" className="nomos-btn" onClick={() => pickDoc.current?.click()} disabled={!!busy || recording || documents.length >= 3}><FileText size={14} aria-hidden="true" />A written process</button></span>
            <input ref={pickVideo} type="file" hidden accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm,.m4v" onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) void fromVideo(file); }} />
            <input ref={pickDoc} type="file" hidden multiple accept=".pdf,.docx,.txt,.md" onChange={event => { const files = [...(event.currentTarget.files ?? [])]; event.currentTarget.value = ''; if (files.length) void fromDocs(files); }} />
            {documents.length > 0 && <ul className="mn-learn-docs">{documents.map((doc, index) => <li key={index}><FileText size={13} aria-hidden="true" />{doc.name}<button type="button" onClick={() => setDocuments(current => current.filter((_, at) => at !== index))} aria-label={`Remove ${doc.name}`}><X size={12} aria-hidden="true" /></button></li>)}</ul>}
          </div>
        </section>
        {frames.length > 0 && !recording && <section className="mn-learn-frames" aria-label="Frames that will be sent">
          <p><b>{Math.min(frames.length, MAX_FRAMES)} frames</b> will be sent{frames.length > MAX_FRAMES ? ` (spread over all ${frames.length})` : ''}. Check that no client data shows.<button type="button" onClick={() => setFrames([])}><Trash2 size={12} aria-hidden="true" />Discard</button></p>
          <div>{spread(frames, MAX_FRAMES).map((frame, index) => <img key={index} src={frame} alt={`Frame ${index + 1}`} />)}</div>
        </section>}
        <label className="mn-learn-notes"><span>Notes</span><textarea rows={3} maxLength={4000} value={notes} onChange={event => setNotes(event.target.value)}
          placeholder="e.g. This is how I prepare our weekly client report: latest numbers from the tracking sheet, flag missing data, save it in the client's folder every Friday." /></label>
        <p className="mn-learn-warn"><TriangleAlert size={14} aria-hidden="true" />The frames go to the AI when you press the button below. Record on sample or public data, not a client's file.</p>
        {error && <p className="mn-conn-banner is-warn" role="alert">{error}</p>}
        <button type="button" className="nomos-btn is-primary mn-learn-go" disabled={!ready} onClick={() => void write()}>
          {busy ? <Loader2 size={15} className="mn-conn-spin" aria-hidden="true" /> : <Wand2 size={15} aria-hidden="true" />}{busy === 'writing' ? 'Writing the procedure…' : busy === 'reading' ? 'Reading…' : 'Write the procedure'}</button>
      </> : <section className="mn-learn-result">
        <label className="mn-learn-title"><span>Name</span><input value={process.title} maxLength={120} onChange={event => setProcess({ ...process, title: event.target.value })} /></label>
        <p className="mn-learn-summary">{process.summary}</p>
        {process.tools.length > 0 && <p className="mn-learn-tools">{process.tools.map(item => <span key={item}>{item}</span>)}</p>}
        <h2>Steps</h2>
        <ol className="mn-learn-steps">{process.steps.map((item, index) => <li key={index}>
          <textarea rows={2} value={item.step} onChange={event => setStep(index, { step: event.target.value })} aria-label={`Step ${index + 1}`} />
          <input value={item.why} onChange={event => setStep(index, { why: event.target.value })} placeholder="Why" aria-label={`Why step ${index + 1}`} />
          <button type="button" onClick={() => setProcess({ ...process, steps: process.steps.filter((_, at) => at !== index) })} aria-label={`Remove step ${index + 1}`}><Trash2 size={13} aria-hidden="true" /></button></li>)}</ol>
        <button type="button" className="mn-agents-task-build" onClick={() => setProcess({ ...process, steps: [...process.steps, { step: '', why: '' }] })}><Plus size={13} aria-hidden="true" />Add a step</button>
        {[['Inputs', process.inputs], ['Decisions', process.decisions], ['Exceptions', process.exceptions]].map(([label, items]) => (items as string[]).length ? <div key={label as string} className="mn-learn-list"><h3>{label as string}</h3><ul>{(items as string[]).map(item => <li key={item}>{item}</li>)}</ul></div> : null)}
        {process.result && <div className="mn-learn-list"><h3>Result</h3><p>{process.result}</p></div>}
        {process.questions.length > 0 && <div className="mn-learn-list is-questions"><h3>Still unclear — answer in the steps or the builder</h3><ul>{process.questions.map(item => <li key={item}>{item}</li>)}</ul></div>}
        <span className="mn-learn-buttons">
          <button type="button" className="nomos-btn" onClick={() => setProcess(null)}>Start again</button>
          <button type="button" className="nomos-btn is-primary" onClick={() => onBuild(processAsTask({ ...process, steps: process.steps.filter(item => item.step.trim()) }))}><Wand2 size={14} aria-hidden="true" />Build the agent<ArrowRight size={14} aria-hidden="true" /></button></span>
      </section>}
    </div>
  </div>;
}
