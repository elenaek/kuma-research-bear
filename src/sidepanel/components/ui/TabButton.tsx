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
      class={`px-3 sm:px-4 py-2 font-medium border-b-2 flex items-center gap-1 sm:gap-2 relative overflow-hidden whitespace-nowrap text-sm sm:text-base ${
        active
          ? 'border-blue-600 text-blue-600'
          : 'border-transparent text-gray-600 hover:text-gray-800 hover:bg-gray-50'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
      style={{
        transition: 'all var(--duration-normal) var(--ease-out)'
      }}
      title={title}
      disabled={disabled}
    >
      <span class="relative z-10">{children}</span>
      {loading && <Loader size={12} class="animate-spin sm:w-3.5 sm:h-3.5" />}

      {/* Animated underline */}
      {active && (
        <div
          class="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600 animate-slide-in-right"
          style={{ borderBottom: 'none' }}
        />
      )}
    </button>
  );
}
