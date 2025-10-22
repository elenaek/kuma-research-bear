import { useState, useEffect, useRef } from 'preact/hooks';
import { ChevronDown, ChevronUp, Check, Globe } from 'lucide-preact';
import { SUPPORTED_LANGUAGES, LanguageOption } from '../../types/index.ts';
import { getOutputLanguage, setOutputLanguage } from '../../utils/settingsService.ts';

/**
 * Language Dropdown Component
 * Allows users to select their preferred output language for generated content
 * Settings are persisted globally and apply to all future generations
 */
export function LanguageDropdown() {
  const [selectedLanguage, setSelectedLanguage] = useState<string>('en');
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Load current language setting on mount
  useEffect(() => {
    getOutputLanguage().then(lang => {
      setSelectedLanguage(lang);
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

  const handleLanguageSelect = async (lang: LanguageOption) => {
    setSelectedLanguage(lang.code);
    setIsOpen(false);

    // Save to settings
    try {
      await setOutputLanguage(lang.code);
      console.log('[LanguageDropdown] Output language changed to:', lang.code);
    } catch (error) {
      console.error('[LanguageDropdown] Error saving language setting:', error);
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

  // Get current language display name
  const currentLanguage = SUPPORTED_LANGUAGES.find(l => l.code === selectedLanguage);
  const displayName = currentLanguage?.nativeName || 'English';

  return (
    <div class="relative language-dropdown-container" ref={dropdownRef}>
      {/* Language Dropdown Button */}
      <button
        class="dropdown-button language-dropdown-button"
        onClick={handleButtonClick}
        onKeyDown={handleKeyDown}
        aria-haspopup="true"
        aria-expanded={isOpen}
        aria-label="Select output language"
        title={`Output language: ${displayName}`}
        type="button"
      >
        <Globe size={12} class="flex-shrink-0" />
        <span class="language-dropdown-label">{displayName}</span>
        {isOpen ? (
          <ChevronUp size={10} class="flex-shrink-0" />
        ) : (
          <ChevronDown size={10} class="flex-shrink-0" />
        )}
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div class="dropdown-menu language-dropdown-menu" style={{ minWidth: '300px'}}>
          {SUPPORTED_LANGUAGES.map((lang) => (
            <div
              key={lang.code}
              class={`dropdown-item ${
                lang.code === selectedLanguage ? 'dropdown-item-active' : ''
              }`}
              onClick={() => handleLanguageSelect(lang)}
              role="menuitem"
              title={lang.name}
            >
              {/* Active indicator */}
              {lang.code === selectedLanguage && (
                <Check size={16} class="dropdown-item-check flex-shrink-0" />
              )}

              {/* Language name (native) */}
              <span class="flex-1 language-name">{lang.nativeName}</span>

              {/* English name hint for non-English languages */}
              {lang.code !== 'en' && lang.nativeName !== lang.name && (
                <span class="language-name-hint">{lang.name}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
