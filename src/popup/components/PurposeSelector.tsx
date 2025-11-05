import { useState, useEffect, useRef } from 'preact/hooks';
import { ChevronDown, ChevronUp, Check, PenTool, BookOpen } from 'lucide-preact';
import type { Purpose } from '../../shared/types/personaPurpose';
import { getPurpose, setPurpose } from '../../shared/utils/settingsService.ts';
import { logger } from '../../shared/utils/logger.ts';

interface PurposeOption {
  value: Purpose;
  label: string;
  icon: any;
  description: string;
}

const PURPOSE_OPTIONS: PurposeOption[] = [
  {
    value: 'writing',
    label: 'Write a paper',
    icon: PenTool,
    description: 'Citation-ready, structured'
  },
  {
    value: 'learning',
    label: 'Learn',
    icon: BookOpen,
    description: 'Understanding-focused, exploratory'
  }
];

/**
 * Purpose Selector Component
 * Allows users to select their purpose (Writing or Learning)
 * Settings are persisted globally and affect the AI's focus and approach
 */
export function PurposeSelector() {
  const [selectedPurpose, setSelectedPurpose] = useState<Purpose>('learning');
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Load current purpose setting on mount
  useEffect(() => {
    getPurpose().then(purpose => {
      setSelectedPurpose(purpose);
    });
  }, []);

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

  const handlePurposeSelect = async (purpose: PurposeOption) => {
    setSelectedPurpose(purpose.value);
    setIsOpen(false);

    // Save to settings
    try {
      await setPurpose(purpose.value);
      logger.debug('SETTINGS', 'Purpose changed to:', purpose.value);
    } catch (error) {
      logger.error('SETTINGS', 'Error saving purpose setting:', error);
    }
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

  // Get current purpose display info
  const currentPurpose = PURPOSE_OPTIONS.find(p => p.value === selectedPurpose);
  const displayLabel = currentPurpose?.label || 'Learning';
  const IconComponent = currentPurpose?.icon || BookOpen;

  return (
    <div class="relative purpose-selector-container" ref={dropdownRef}>
      {/* Purpose Dropdown Button */}
      <button
        class="dropdown-button purpose-dropdown-button"
        onClick={handleButtonClick}
        onKeyDown={handleKeyDown}
        aria-haspopup="true"
        aria-expanded={isOpen}
        aria-label="Select purpose"
        title={`Purpose: ${displayLabel}`}
        type="button"
      >
        <IconComponent size={12} class="flex-shrink-0" />
        <span class="purpose-dropdown-label">{displayLabel}</span>
        {isOpen ? (
          <ChevronUp size={10} class="flex-shrink-0" />
        ) : (
          <ChevronDown size={10} class="flex-shrink-0" />
        )}
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div class="dropdown-menu purpose-dropdown-menu" style={{ minWidth: '240px'}}>
          {PURPOSE_OPTIONS.map((purpose) => {
            const PurposeIcon = purpose.icon;
            return (
              <div
                key={purpose.value}
                class={`dropdown-item ${
                  purpose.value === selectedPurpose ? 'dropdown-item-active' : ''
                }`}
                onClick={() => handlePurposeSelect(purpose)}
                role="menuitem"
                title={purpose.description}
              >
                {/* Icon */}
                <PurposeIcon size={16} class="flex-shrink-0" />

                {/* Purpose name and description */}
                <div class="flex-1 flex flex-col">
                  <span class="purpose-name">{purpose.label}</span>
                  <span class="purpose-description text-xs opacity-70">{purpose.description}</span>
                </div>

                {/* Active indicator */}
                {purpose.value === selectedPurpose && (
                  <Check size={16} class="dropdown-item-check flex-shrink-0" />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
