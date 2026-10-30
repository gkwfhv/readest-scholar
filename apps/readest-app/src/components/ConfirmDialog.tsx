'use client';

import React from 'react';
import { useTranslation } from '@/hooks/useTranslation';

interface ConfirmDialogProps {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  busy?: boolean;
  error?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  title,
  message,
  confirmLabel,
  cancelLabel,
  busy = false,
  error,
  onConfirm,
  onCancel,
}) => {
  const _ = useTranslation();

  return (
    <div className='fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4'>
      <div
        role='dialog'
        aria-modal='true'
        aria-label={title}
        className='modal-box bg-base-100 w-full max-w-md rounded-2xl p-5'
      >
        <h2 className='text-lg font-semibold'>{title}</h2>
        {message && <p className='text-base-content/70 mt-2 text-sm'>{message}</p>}
        {error && (
          <p role='alert' className='text-error mt-3 text-sm'>
            {error}
          </p>
        )}
        <div className='mt-5 flex justify-end gap-2'>
          <button
            type='button'
            className='btn btn-ghost eink-bordered'
            disabled={busy}
            onClick={onCancel}
          >
            {cancelLabel ?? _('Cancel')}
          </button>
          <button type='button' className='btn btn-contrast' disabled={busy} onClick={onConfirm}>
            {confirmLabel ?? _('Confirm')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmDialog;
