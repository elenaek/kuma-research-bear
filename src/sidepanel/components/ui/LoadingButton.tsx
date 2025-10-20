import { Loader } from 'lucide-preact';
import { ComponentChildren } from 'preact';

interface LoadingButtonProps {
  loading: boolean;
  loadingText?: string;
  onClick: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'secondary';
  className?: string;
  title?: string;
  children: ComponentChildren;
}

/**
 * Reusable Loading Button Component
 * Button with loading state indicator
 */
export function LoadingButton(props: LoadingButtonProps) {
  const {
    loading,
    loadingText,
    onClick,
    disabled = false,
    variant = 'primary',
    className = '',
    title,
    children,
  } = props;

  const baseClass = variant === 'primary' ? 'btn btn-primary' : 'btn btn-secondary';

  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      class={`${baseClass} ${className} hover:cursor-pointer flex items-center gap-2`}
      title={title}
    >
      {loading ? (
        <div class="flex items-center gap-2 spinner-fade-in">
          <Loader size={16} class="animate-spin" />
          {loadingText && <span>{loadingText}</span>}
        </div>
      ) : (
        <div class="flex items-center gap-2">
          {children}
        </div>
      )}
    </button>
  );
}
