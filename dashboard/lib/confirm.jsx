'use client';
import { createContext, useCallback, useContext, useRef, useState } from 'react';
import Modal from '../components/Modal';

// In-page replacement for the browser's confirm() box (Jira 24f): same one-line call, but styled,
// keyboard friendly and with a clearly marked destructive button.
//   const confirm = useConfirm();
//   if (!(await confirm({ title: 'Delete service?', message: '...', confirmLabel: 'Delete', danger: true }))) return;
const ConfirmContext = createContext(null);

export function ConfirmProvider({ children }) {
  const [opts, setOpts] = useState(null);
  const resolver = useRef(null);

  const confirm = useCallback((options) => new Promise((resolve) => {
    resolver.current = resolve;
    setOpts(typeof options === 'string' ? { message: options } : options);
  }), []);

  const settle = (answer) => {
    resolver.current?.(answer);
    resolver.current = null;
    setOpts(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {opts && (
        <Modal title={opts.title ?? 'Are you sure?'} onClose={() => settle(false)} width={420}>
          <p style={{ whiteSpace: 'pre-line', margin: '4px 0 18px' }}>{opts.message}</p>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button type="button" onClick={() => settle(false)}>{opts.cancelLabel ?? 'Cancel'}</button>
            <button type="button" className={opts.danger ? 'danger' : 'primary'} onClick={() => settle(true)}>{opts.confirmLabel ?? 'Confirm'}</button>
          </div>
        </Modal>
      )}
    </ConfirmContext.Provider>
  );
}

// Falls back to the native box outside the provider so a page without it still works.
export function useConfirm() {
  return useContext(ConfirmContext) ?? ((o) => Promise.resolve(window.confirm(typeof o === 'string' ? o : o.message)));
}
