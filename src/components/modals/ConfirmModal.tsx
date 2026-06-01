'use client';

import { Modal } from '@/components/ui/Modal';

export function ConfirmModal({
  title,
  message,
  confirmText,
  onConfirm,
  onCancel,
  tone = 'danger',
}: {
  title: string;
  message: string;
  confirmText: string;
  onConfirm: () => void;
  onCancel: () => void;
  tone?: 'danger' | 'default';
}) {
  return (
    <Modal title={title} onClose={onCancel}>
      <div className="px-6 pb-6 pt-5">
        <p className="text-[14px] leading-relaxed text-ink-2">{message}</p>
        <div className="flex gap-3 mt-6">
          <button onClick={onCancel} className="btn-secondary flex-1 py-2.5 text-[13.5px] font-semibold">
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 py-2.5 rounded-field text-[13.5px] font-semibold text-white transition-colors"
            style={{ background: tone === 'danger' ? 'var(--color-danger)' : 'var(--color-ink)' }}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </Modal>
  );
}
