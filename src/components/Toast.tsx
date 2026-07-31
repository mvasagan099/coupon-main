/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, useCallback, useRef, useMemo, type ReactNode, type ReactElement } from 'react';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

interface Toast {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
}

interface ToastContextValue {
  toast: (type: ToastType, title: string, message?: string) => void;
  success: (title: string, message?: string) => void;
  error: (title: string, message?: string) => void;
  info: (title: string, message?: string) => void;
  warning: (title: string, message?: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timerRefs = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const dismiss = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
    clearTimeout(timerRefs.current[id]);
    delete timerRefs.current[id];
  }, []);

  const toast = useCallback((type: ToastType, title: string, message?: string) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setToasts(prev => [...prev.slice(-4), { id, type, title, message }]);
    if (type !== 'error') {
      timerRefs.current[id] = setTimeout(() => dismiss(id), 4000);
    }
  }, [dismiss]);

  const value: ToastContextValue = useMemo(() => ({
    toast,
    success: (title, msg) => toast('success', title, msg),
    error: (title, msg) => toast('error', title, msg),
    info: (title, msg) => toast('info', title, msg),
    warning: (title, msg) => toast('warning', title, msg),
  }), [toast]);

  const iconMap: Record<ToastType, ReactElement> = {
    success: (
      <svg width="18" height="18" fill="none" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
    error: (
      <svg width="18" height="18" fill="none" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
      </svg>
    ),
    warning: (
      <svg width="18" height="18" fill="none" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
    info: (
      <svg width="18" height="18" fill="none" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
      </svg>
    ),
  };

  const colorMap: Record<ToastType, { bg: string; border: string; color: string; bar: string }> = {
    success: { bg: 'var(--green-muted)', border: 'var(--green-border)', color: 'var(--green)', bar: 'var(--green)' },
    error:   { bg: 'var(--red-muted)',   border: 'var(--red-border)',   color: 'var(--red)',   bar: 'var(--red)' },
    warning: { bg: 'var(--amber-muted)', border: 'var(--amber-border)', color: 'var(--amber)', bar: 'var(--amber)' },
    info:    { bg: 'rgba(139,92,246,0.08)', border: 'rgba(139,92,246,0.2)', color: 'var(--purple)', bar: 'var(--purple)' },
  };

  return (
    <ToastContext.Provider value={value}>
      {children}

      {/* Toast Viewport */}
      <div 
        aria-live="assertive"
        style={{
          position: 'fixed', bottom: '1.5rem', right: '1.5rem',
          zIndex: 9999, display: 'flex', flexDirection: 'column', gap: '0.6rem',
          pointerEvents: 'none', maxWidth: '360px', width: 'calc(100vw - 2rem)',
        }}
      >
        <style>{`
          @keyframes toastSlideIn {
            from { transform: translateX(100%); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
          }
          @keyframes toastProgress {
            from { width: 100%; }
            to { width: 0%; }
          }
        `}</style>
        {toasts.map(t => {
          const c = colorMap[t.type];
          return (
            <div
              key={t.id}
              role={t.type === 'error' ? 'alert' : 'status'}
              className="glass-card"
              style={{
                background: 'var(--bg-2)',
                border: `1px solid ${c.border}`,
                borderRadius: '14px',
                boxShadow: '0 10px 40px rgba(0,0,0,0.4)',
                overflow: 'hidden',
                pointerEvents: 'all',
                position: 'relative',
                backdropFilter: 'blur(12px)',
                WebkitBackdropFilter: 'blur(12px)',
                animation: 'toastSlideIn 0.3s ease-out',
              }}
            >
              {/* Glow accent bar */}
              <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '2px', background: c.bar, opacity: 0.8 }} />

              <div style={{ padding: '0.875rem 1.125rem', display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
                {/* Icon */}
                <div style={{
                  width: '32px', height: '32px', borderRadius: '8px', flexShrink: 0,
                  background: c.bg, border: `1px solid ${c.border}`, color: c.color,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {iconMap[t.type]}
                </div>

                {/* Text */}
                <div style={{ flex: 1, minWidth: 0, paddingTop: '0.1rem' }}>
                  <p style={{ fontWeight: 700, fontSize: '0.875rem', color: 'var(--text-1)', margin: 0, lineHeight: 1.3 }}>
                    {t.title}
                  </p>
                  {t.message && (
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-3)', margin: '0.25rem 0 0', lineHeight: 1.45, fontWeight: 500 }}>
                      {t.message}
                    </p>
                  )}
                </div>

                {/* Dismiss */}
                <button
                  aria-label="Close"
                  onClick={() => dismiss(t.id)}
                  style={{
                    width: '24px', height: '24px', borderRadius: '6px', flexShrink: 0,
                    background: 'transparent', border: 'none', cursor: 'pointer',
                    color: 'var(--text-4)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'all 0.15s', marginTop: '-2px',
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-3)'; (e.currentTarget as HTMLElement).style.color = 'var(--text-2)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'var(--text-4)'; }}
                >
                  <svg width="12" height="12" fill="none" viewBox="0 0 24 24">
                    <path d="M6 18L18 6M6 6l12 12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
                  </svg>
                </button>
              </div>

              {/* Auto-dismiss progress bar */}
              {t.type !== 'error' && (
                <div style={{
                  position: 'absolute', bottom: 0, left: 0,
                  height: '2px', background: c.bar, opacity: 0.35,
                  animation: 'toastProgress 4s linear forwards',
                }} />
              )}
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
