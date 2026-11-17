import { useEffect, useRef, type ReactNode } from 'react';

export function Modal({
  children, labelledBy, describedBy, onDismiss, className = ''
}: {
  children: ReactNode;
  labelledBy: string;
  describedBy?: string;
  onDismiss: () => void;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const opener = document.activeElement;
    dialog.showModal();
    return () => {
      dialog.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);
  return <dialog ref={ref} aria-labelledby={labelledBy} aria-describedby={describedBy}
    className={'vg-modal ' + className}
    onCancel={event => { event.preventDefault(); onDismiss(); }}
    onClick={event => { if (event.target === event.currentTarget) onDismiss(); }}>
    {children}
  </dialog>;
}
