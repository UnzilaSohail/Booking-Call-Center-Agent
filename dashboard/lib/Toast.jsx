'use client';
import { createContext, useCallback, useContext, useState } from 'react';
import { CheckCircle2, TriangleAlert, XCircle } from 'lucide-react';

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const push = useCallback((message, type) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, message, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }, []);

  const api = {
    success: (message) => push(message, 'success'),
    warning: (message) => push(message, 'warning'),
    error: (message) => push(message, 'error'),
  };

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.type}`}>
            {t.type === 'success' ? <CheckCircle2 size={16} /> : t.type === 'warning' ? <TriangleAlert size={16} /> : <XCircle size={16} />}
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

// Falls back to a no-op API outside the provider instead of throwing — some pages
// (e.g. plain login forms) don't need toasts and shouldn't be forced to wrap in one.
const noop = { success: () => {}, warning: () => {}, error: () => {} };
export function useToast() {
  return useContext(ToastContext) ?? noop;
}
