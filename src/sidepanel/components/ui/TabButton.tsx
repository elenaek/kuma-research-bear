import { Loader } from 'lucide-preact';
import { ComponentChildren } from 'preact';

interface TabButtonProps {
  active: boolean;
  onClick: () => void;
  loading?: boolean;
  disabled?: boolean;
  title?: string;
  children: ComponentChildren;
}

/**
 * Reusable Tab Button Component
 * Individual tab button with active state and optional loading indicator
 */
export function TabButton(props: TabButtonProps) {
  const { active, onClick, loading = false, disabled = false, title, children } = props;

  return (
    <button
      onClick={onClick}
      class={`px-4 py-2 font-medium transition-colors border-b-2 flex items-center gap-2 ${
        active
          ? 'border-blue-600 text-blue-600'
          : 'border-transparent text-gray-600 hover:text-gray-800'
      } ${disabled ? 'opacity-50' : ''}`}
      title={title}
      disabled={disabled}
    >
      <span>{children}</span>
      {loading && <Loader size={14} class="animate-spin" />}
    </button>
  );
}
