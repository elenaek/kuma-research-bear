import { Loader, AlertCircle, Info, CheckCircle } from 'lucide-preact';
import { FunctionComponent } from 'preact';

interface OperationBannerProps {
  status: 'loading' | 'warning' | 'error' | 'success' | 'info';
  title: string;
  subtitle?: string;
  icon?: FunctionComponent<{ size?: number; class?: string }>;
  gradient?: boolean;
}

/**
 * Operation Banner Component
 * Displays status banners for ongoing operations
 */
export function OperationBanner(props: OperationBannerProps) {
  const { status, title, subtitle, icon: CustomIcon, gradient = false } = props;

  // Status-based styling
  const statusStyles = {
    loading: {
      bg: gradient ? 'bg-gradient-to-r from-blue-50 to-indigo-50' : 'bg-blue-50',
      border: 'border-blue-200',
      textColor: 'text-blue-900',
      icon: Loader,
      iconClass: 'text-blue-600 animate-spin',
    },
    warning: {
      bg: 'bg-yellow-50',
      border: 'border-yellow-300',
      textColor: 'text-yellow-900',
      icon: AlertCircle,
      iconClass: 'text-yellow-600',
    },
    error: {
      bg: 'bg-red-50',
      border: 'border-red-200',
      textColor: 'text-red-900',
      icon: AlertCircle,
      iconClass: 'text-red-600',
    },
    success: {
      bg: 'bg-green-50',
      border: 'border-green-200',
      textColor: 'text-green-900',
      icon: CheckCircle,
      iconClass: 'text-green-600',
    },
    info: {
      bg: 'bg-blue-50',
      border: 'border-blue-200',
      textColor: 'text-blue-900',
      icon: Info,
      iconClass: 'text-blue-600',
    },
  };

  const styles = statusStyles[status];
  const Icon = CustomIcon || styles.icon;

  return (
    <div class={`card mb-4 ${styles.bg} ${styles.border}`}>
      <div class="flex items-center gap-3">
        <Icon size={status === 'loading' ? 24 : 20} class={styles.iconClass} />
        <div class="flex-1">
          <p class={`text-sm font-medium ${styles.textColor}`}>{title}</p>
          {subtitle && (
            <p class={`text-xs ${styles.textColor} mt-1`}>{subtitle}</p>
          )}
        </div>
      </div>
    </div>
  );
}
