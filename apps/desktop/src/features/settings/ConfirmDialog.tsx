import { useEffect, useRef, type ReactNode, type RefObject } from 'react';

export function ConfirmDialog({ title, children, confirmLabel, onConfirm, onCancel, returnFocus }: {
  title: string; children: ReactNode; confirmLabel: string; onConfirm: () => void; onCancel: () => void;
  returnFocus?: RefObject<HTMLElement | null>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    const element = dialog.current!;
    element.showModal();
    cancel.current?.focus();
    return () => { element.close(); if (returnFocus?.current) returnFocus.current.focus(); else if (previous instanceof HTMLElement) previous.focus(); };
  }, [returnFocus]);
  return <dialog ref={dialog} className="confirmation-dialog" aria-labelledby="confirmation-title" onCancel={(event) => { event.preventDefault(); onCancel(); }}>
    <h2 id="confirmation-title">{title}</h2>{children}
    <div className="actions"><button ref={cancel} type="button" onClick={onCancel}>留在当前页面</button><button type="button" className="danger-button" onClick={onConfirm}>{confirmLabel}</button></div>
  </dialog>;
}
