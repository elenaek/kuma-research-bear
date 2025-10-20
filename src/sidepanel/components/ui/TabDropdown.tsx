import { useState, useEffect, useRef } from 'preact/hooks';
import { ChevronDown, ChevronUp, Check, Loader } from 'lucide-preact';

export interface TabOption {
  id: string;
  label: string;
  active: boolean;
  disabled?: boolean;
  loading?: boolean;
  onClick: () => void;
  title?: string;
}

interface TabDropdownProps {
  tabs: TabOption[];
  activeTabLabel: string;
}

/**
 * Tab Dropdown Component
 * Displays tabs as a dropdown menu for narrow screens
 * Shows current tab in button, lists all tabs in dropdown
 */
export function TabDropdown(props: TabDropdownProps) {
  const { tabs, activeTabLabel } = props;
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Handle click outside to close dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleEscape);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen]);

  const handleTabClick = (tab: TabOption) => {
    if (tab.disabled) return;
    tab.onClick();
    setIsOpen(false);
  };

  const handleButtonClick = () => {
    setIsOpen(!isOpen);
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setIsOpen(!isOpen);
    }
  };

  return (
    <div class="relative w-full" ref={dropdownRef}>
      {/* Dropdown Button */}
      <button
        class="dropdown-button"
        onClick={handleButtonClick}
        onKeyDown={handleKeyDown}
        aria-haspopup="true"
        aria-expanded={isOpen}
        type="button"
      >
        <span class="flex-1 text-center truncate">{activeTabLabel}</span>
        {isOpen ? (
          <ChevronUp size={16} class="flex-shrink-0" />
        ) : (
          <ChevronDown size={16} class="flex-shrink-0" />
        )}
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div class="dropdown-menu">
          {tabs.map((tab) => (
            <div
              key={tab.id}
              class={`dropdown-item ${
                tab.active ? 'dropdown-item-active' : ''
              } ${tab.disabled ? 'dropdown-item-disabled' : ''}`}
              onClick={() => handleTabClick(tab)}
              title={tab.title}
              role="menuitem"
              aria-disabled={tab.disabled}
            >
              {/* Active indicator */}
              {tab.active && <Check size={16} class="dropdown-item-check flex-shrink-0" />}

              {/* Tab label */}
              <span class="flex-1 text-center">{tab.label}</span>

              {/* Loading indicator */}
              {tab.loading && (
                <Loader size={14} class="dropdown-item-loader animate-spin flex-shrink-0 spinner-fade-in" />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
