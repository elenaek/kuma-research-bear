import { FunctionComponent } from 'preact';

interface EmptyStateProps {
  icon?: FunctionComponent<{ size?: number; class?: string }>;
  iconSize?: number;
  iconClass?: string;
  title: string;
  subtitle?: string;
  className?: string;
}

/**
 * Reusable Empty State Component
 * Displays an empty state with optional icon, title, and subtitle
 */
export function EmptyState(props: EmptyStateProps) {
  const {
    icon: Icon,
    iconSize = 48,
    iconClass = 'text-gray-300',
    title,
    subtitle,
    className = '',
  } = props;

  return (
    <div class={`text-center py-8 ${className}`}>
      {Icon && (
        <Icon size={iconSize} class={`${iconClass} mx-auto mb-4`} />
      )}
      <p class="text-sm text-gray-600">{title}</p>
      {subtitle && (
        <p class="text-xs text-gray-500 mt-1">{subtitle}</p>
      )}
    </div>
  );
}
