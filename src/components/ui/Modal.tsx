'use client';

import { useEffect, type ReactNode } from 'react';

interface ModalProps {
  title?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  maxWidth?: number;
}

/** Shared modal chrome: scrim, centering, Escape + click-outside, close button.
 *  No blur — a plain ink scrim, in keeping with the design system. */
export function Modal({ title, onClose, children, maxWidth = 440 }: ModalProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.66)' }}
      onClick={onClose}
    >
      <div
        className="surface-card w-full rise"
        style={{ maxWidth, boxShadow: 'var(--shadow-pop)' }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {title !== undefined && (
          <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-line">
            <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
            <button
              onClick={onClose}
              className="grid place-items-center w-8 h-8 -mr-1 rounded-[8px] text-ink-3 hover:bg-sunken hover:text-ink transition-colors"
              aria-label="Close"
            >
              <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
