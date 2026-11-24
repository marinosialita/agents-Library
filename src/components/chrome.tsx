// Toasts (a small confirmation with an optional undo, bottom right) and two number formats. Every other control is
// the reference's: ToolBar in nomos-chrome.tsx, buttons and bars in nomos-controls.css.
import React, { createContext, useContext, useState, type ReactNode } from 'react';

type Toast = { id: number; text: string; action?: { label: string; run(): void } };
const ToastContext = createContext<(text: string, action?: Toast['action'], ms?: number) => void>(() => {});
export const useToast = () => useContext(ToastContext);
export function ToastHost({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = (text: string, action?: Toast['action'], ms = action ? 8000 : 2600) => {
    const id = Date.now() + Math.random();
    setToasts(list => [...list.slice(-2), { id, text, action }]);
    window.setTimeout(() => setToasts(list => list.filter(toast => toast.id !== id)), ms);
  };
  return <ToastContext.Provider value={push}>
    {children}
    <div className="toasts" aria-live="polite">{toasts.map(toast => <div key={toast.id} className="toast">
      <span>{toast.text}</span>
      {toast.action && <button type="button" className="nomos-btn is-plain" onClick={() => { toast.action!.run(); setToasts(list => list.filter(item => item.id !== toast.id)); }}>{toast.action.label}</button>}
    </div>)}</div>
  </ToastContext.Provider>;
}
export const bytes = (n: number) => n < 1024 ? `${n} B` : n < 1_048_576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1_048_576).toFixed(1)} MB`;
export const kchars = (n: number) => n < 1000 ? `${n} chars` : `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k chars`;
