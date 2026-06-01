'use client';

import { QRCodeSVG } from 'qrcode.react';
import { Modal } from '@/components/ui/Modal';

export function QRCodeModal({ address, onClose }: { address: string; onClose: () => void }) {
  return (
    <Modal title="Native XMR deposit address" onClose={onClose}>
      <div className="px-6 pb-6 pt-5">
        <div className="rounded-card bg-white border border-line p-5 flex justify-center">
          <QRCodeSVG value={address} size={240} level="M" marginSize={2} bgColor="#ffffff" fgColor="#18181b" />
        </div>
        <p className="text-[11px] text-ink-3 mt-5 mb-2 uppercase tracking-[0.06em] font-semibold">Address</p>
        <code className="block text-xs bg-inset border border-line p-3 rounded-field break-all font-mono text-ink-2 select-all">
          {address}
        </code>
      </div>
    </Modal>
  );
}
