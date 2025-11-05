import { useState, useEffect, useRef } from 'preact/hooks';
import { ChevronDown, ChevronUp, Check, User, GraduationCap } from 'lucide-preact';
import type { Persona } from '../../shared/types/personaPurpose';
import { getPersona, setPersona } from '../../shared/utils/settingsService.ts';
import { logger } from '../../shared/utils/logger.ts';

interface PersonaOption {
  value: Persona;
  label: string;
  icon: any;
  description: string;
}

const PERSONA_OPTIONS: PersonaOption[] = [
  {
    value: 'professional',
    label: 'Professional',
    icon: User,
    description: 'Formal, technical, precise'
  },
  {
    value: 'student',
    label: 'Student',
    icon: GraduationCap,
    description: 'Accessible, supportive, guided'
  }
];

/**
 * Persona Selector Component
 * Allows users to select their persona (Professional or Student)
 * Settings are persisted globally and affect the AI's tone and approach
 */
export function PersonaSelector() {
  const [selectedPersona, setSelectedPersona] = useState<Persona>('student');
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Load current persona setting on mount
  useEffect(() => {
    getPersona().then(persona => {
      setSelectedPersona(persona);
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

  const handlePersonaSelect = async (persona: PersonaOption) => {
    setSelectedPersona(persona.value);
    setIsOpen(false);

    // Save to settings
    try {
      await setPersona(persona.value);
      logger.debug('SETTINGS', 'Persona changed to:', persona.value);
    } catch (error) {
      logger.error('SETTINGS', 'Error saving persona setting:', error);
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

  // Get current persona display info
  const currentPersona = PERSONA_OPTIONS.find(p => p.value === selectedPersona);
  const displayLabel = currentPersona?.label || 'Professional';
  const IconComponent = currentPersona?.icon || User;

  return (
    <div class="relative persona-selector-container" ref={dropdownRef}>
      {/* Persona Dropdown Button */}
      <button
        class="dropdown-button persona-dropdown-button"
        onClick={handleButtonClick}
        onKeyDown={handleKeyDown}
        aria-haspopup="true"
        aria-expanded={isOpen}
        aria-label="Select persona"
        title={`Persona: ${displayLabel}`}
        type="button"
      >
        <IconComponent size={12} class="flex-shrink-0" />
        <span class="persona-dropdown-label">{displayLabel}</span>
        {isOpen ? (
          <ChevronUp size={10} class="flex-shrink-0" />
        ) : (
          <ChevronDown size={10} class="flex-shrink-0" />
        )}
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div class="dropdown-menu persona-dropdown-menu" style={{ minWidth: '240px'}}>
          {PERSONA_OPTIONS.map((persona) => {
            const PersonaIcon = persona.icon;
            return (
              <div
                key={persona.value}
                class={`dropdown-item ${
                  persona.value === selectedPersona ? 'dropdown-item-active' : ''
                }`}
                onClick={() => handlePersonaSelect(persona)}
                role="menuitem"
                title={persona.description}
              >
                {/* Icon */}
                <PersonaIcon size={16} class="flex-shrink-0" />

                {/* Persona name and description */}
                <div class="flex-1 flex flex-col">
                  <span class="persona-name">{persona.label}</span>
                  <span class="persona-description text-xs opacity-70">{persona.description}</span>
                </div>

                {/* Active indicator */}
                {persona.value === selectedPersona && (
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
