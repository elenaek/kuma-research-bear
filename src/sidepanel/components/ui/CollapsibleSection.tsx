import { useState, useEffect, useRef } from 'preact/hooks';
import { ChevronDown, ChevronUp } from 'lucide-preact';
import { ComponentChildren } from 'preact';

interface CollapsibleSectionProps {
  title: string;
  icon?: any; // Lucide icon component
  iconColor?: string;
  defaultOpen?: boolean;
  children: ComponentChildren;
  titleClassName?: string;
  autoScrollOnExpand?: boolean;
}

/**
 * Reusable Collapsible Section Component
 * Provides expand/collapse functionality for content sections
 */
export function CollapsibleSection(props: CollapsibleSectionProps) {
  const {
    title,
    icon: Icon,
    iconColor = 'text-blue-600',
    defaultOpen = false,
    children,
    titleClassName = 'text-base font-semibold text-gray-900',
    autoScrollOnExpand = true
  } = props;

  const [isExpanded, setIsExpanded] = useState(defaultOpen);
  const containerRef = useRef<HTMLDivElement>(null);
  const prevExpandedRef = useRef(defaultOpen);

  // Auto-scroll when section expands
  useEffect(() => {
    const wasExpanded = prevExpandedRef.current;
    const isNowExpanded = isExpanded;

    // Only scroll when transitioning from collapsed to expanded
    if (!wasExpanded && isNowExpanded && autoScrollOnExpand && containerRef.current) {
      // Small delay to allow expand animation to start
      setTimeout(() => {
        containerRef.current?.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
          inline: 'nearest'
        });
      }, 100);
    }

    // Update previous state
    prevExpandedRef.current = isExpanded;
  }, [isExpanded, autoScrollOnExpand]);

  return (
    <div ref={containerRef} class="card">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        class="w-full text-left focus:outline-none hover:cursor-pointer"
        aria-expanded={isExpanded}
      >
        <div class="flex items-center justify-between gap-2">
          <div class="flex items-center gap-2 flex-grow">
            {Icon && <Icon size={16} class={`${iconColor} flex-shrink-0 sm:w-4.5 sm:h-4.5`} />}
            <h3 class={titleClassName}>{title}</h3>
          </div>
          <div class="flex-shrink-0">
            {isExpanded ? (
              <ChevronUp size={16} class="text-gray-500" />
            ) : (
              <ChevronDown size={16} class="text-gray-500" />
            )}
          </div>
        </div>
      </button>

      {isExpanded && (
        <div class="animate-fadeIn mt-4 mr-2 ml-2">
          {children}
        </div>
      )}
    </div>
  );
}
