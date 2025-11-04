import { h } from 'preact';

interface ConfirmationModalProps {
  title: string;
  message: string;
  confirmText: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Generic confirmation modal component
 * Used for clear messages and close tab confirmations
 */
export const ConfirmationModal = ({
  title,
  message,
  confirmText,
  cancelText = 'Cancel',
  onConfirm,
  onCancel,
}: ConfirmationModalProps) => {
  return (
    <div class="modal-overlay" onClick={onCancel}>
      <div class="modal-dialog" onClick={(e) => e.stopPropagation()}>
        <div class="modal-header">{title}</div>
        <div class="modal-body">{message}</div>
        <div class="modal-footer">
          <button class="modal-btn modal-btn-cancel" onClick={onCancel}>
            {cancelText}
          </button>
          <button class="modal-btn modal-btn-confirm" onClick={onConfirm}>
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};
