interface ConfirmationDialogProps {
  show: boolean;
  title?: string;
  message: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel: () => void;
  variant?: 'danger' | 'warning' | 'info';
  loading?: boolean;
}

/**
 * Reusable Confirmation Dialog Component
 * Displays a confirmation dialog with customizable messaging and styling
 */
export function ConfirmationDialog(props: ConfirmationDialogProps) {
  const {
    show,
    title,
    message,
    description,
    confirmText = 'Confirm',
    cancelText = 'Cancel',
    onConfirm,
    onCancel,
    variant = 'danger',
    loading = false,
  } = props;

  if (!show) {
    return null;
  }

  // Variant-based styling
  const variantStyles = {
    danger: {
      bg: 'bg-red-50',
      border: 'border-red-200',
      titleColor: 'text-red-900',
      messageColor: 'text-red-800',
      buttonColor: 'text-red-600 hover:bg-red-100',
    },
    warning: {
      bg: 'bg-yellow-50',
      border: 'border-yellow-200',
      titleColor: 'text-yellow-900',
      messageColor: 'text-yellow-800',
      buttonColor: 'text-yellow-600 hover:bg-yellow-100',
    },
    info: {
      bg: 'bg-blue-50',
      border: 'border-blue-200',
      titleColor: 'text-blue-900',
      messageColor: 'text-blue-800',
      buttonColor: 'text-blue-600 hover:bg-blue-100',
    },
  };

  const styles = variantStyles[variant];

  return (
    <div class={`mt-3 p-3 ${styles.bg} border ${styles.border} rounded-lg`}>
      {title && (
        <p class={`text-sm font-semibold ${styles.titleColor} mb-2`}>
          {title}
        </p>
      )}
      <p class={`text-sm ${styles.messageColor} ${description ? 'mb-2' : 'mb-3'}`}>
        {message}
      </p>
      {description && (
        <p class={`text-xs ${styles.messageColor} mb-3`}>
          {description}
        </p>
      )}
      <div class="flex gap-2">
        <button
          onClick={onConfirm}
          disabled={loading}
          class={`btn btn-secondary ${styles.buttonColor} px-4 py-2 text-sm hover:cursor-pointer`}
        >
          {loading ? 'Processing...' : confirmText}
        </button>
        <button
          onClick={onCancel}
          disabled={loading}
          class="btn btn-secondary px-4 py-2 text-sm"
        >
          {cancelText}
        </button>
      </div>
    </div>
  );
}
