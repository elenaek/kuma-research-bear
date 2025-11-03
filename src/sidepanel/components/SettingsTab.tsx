/**
 * Settings Tab Component
 *
 * Global settings tab in the sidepanel containing:
 * - Persona selection (Professional/Student)
 * - Purpose selection (Writing/Learning)
 * - Output language selection
 * - Image button visibility toggle
 */

import { useState, useEffect } from 'preact/hooks';
import { Settings } from 'lucide-preact';
import { PersonaSelector } from '../../popup/components/PersonaSelector.tsx';
import { PurposeSelector } from '../../popup/components/PurposeSelector.tsx';
import { LanguageDropdown } from '../../popup/components/LanguageDropdown.tsx';
import { VerbositySlider } from '../../popup/components/VerbositySlider.tsx';
import { getShowImageButtons, setShowImageButtons } from '../../utils/settingsService.ts';
import type { Persona, Purpose } from '../../types/personaPurpose.ts';
import { PERSONA_PURPOSE_CONFIGS } from '../../types/personaPurpose.ts';
import { getPersona, getPurpose, onPersonaChanged, onPurposeChanged } from '../../utils/settingsService.ts';
import { MessageType } from '../../types/index.ts';
import { logger } from '../../utils/logger.ts';

/**
 * Settings Tab - Global extension settings
 */
export function SettingsTab() {
  const [showImageButtons, setShowImageButtonsState] = useState<boolean>(true);
  const [currentPersona, setCurrentPersona] = useState<Persona>('student');
  const [currentPurpose, setCurrentPurpose] = useState<Purpose>('learning');

  // Load current settings on mount and listen for changes
  useEffect(() => {
    // Load initial settings
    getShowImageButtons().then(setShowImageButtonsState);
    getPersona().then(setCurrentPersona);
    getPurpose().then(setCurrentPurpose);

    // Listen for persona changes
    const cleanupPersona = onPersonaChanged((newPersona) => {
      setCurrentPersona(newPersona);
    });

    // Listen for purpose changes
    const cleanupPurpose = onPurposeChanged((newPurpose) => {
      setCurrentPurpose(newPurpose);
    });

    // Cleanup listeners on unmount
    return () => {
      cleanupPersona();
      cleanupPurpose();
    };
  }, []);

  const handleImageButtonsToggle = async () => {
    const newValue = !showImageButtons;
    setShowImageButtonsState(newValue);
    try {
      await setShowImageButtons(newValue);
      logger.debug('SETTINGS', 'Image buttons visibility set to:', newValue);

      // Broadcast change to all tabs (matches popup implementation)
      const tabs = await chrome.tabs.query({});
      for (const tab of tabs) {
        if (tab.id) {
          chrome.tabs.sendMessage(tab.id, {
            type: MessageType.IMAGE_BUTTONS_VISIBILITY_CHANGED,
            payload: { showImageButtons: newValue },
          }).catch(() => {}); // Ignore errors for tabs without content script
        }
      }
    } catch (error) {
      logger.error('SETTINGS', 'Error saving image buttons setting:', error);
      // Revert on error
      setShowImageButtonsState(!newValue);
    }
  };

  // Get current configuration details
  const config = PERSONA_PURPOSE_CONFIGS[currentPersona][currentPurpose];

  return (
    <div class="settings-tab p-6">
      {/* Header */}
      <div class="settings-header mb-6">
        <div class="flex items-center gap-2 mb-2">
          <Settings size={20} class="text-gray-700" />
          <h2 class="text-lg font-semibold text-gray-800">Settings</h2>
        </div>
        <p class="text-sm text-gray-600">
          Configure how Kuma Research Bear communicates and displays information
        </p>
      </div>

      {/* Communication Style Section */}
      <section class="settings-section mb-6">
        <h3 class="text-md font-medium text-gray-800 mb-3">Communication Style</h3>
        <p class="text-xs text-gray-600 mb-4">
          Adjust how Kuma communicates based on your experience level and goals
        </p>

        {/* Persona Selector */}
        <div class="settings-row mb-4">
          <label class="settings-label text-sm text-gray-700 mb-2 block">
            You
            <span class="text-xs text-gray-500 block mt-0.5">are a...</span>
          </label>
          <PersonaSelector />
        </div>

        {/* Purpose Selector */}
        <div class="settings-row mb-4">
          <label class="settings-label text-sm text-gray-700 mb-2 block">
            Your Objective
            <span class="text-xs text-gray-500 block mt-0.5">You want to...</span>
          </label>
          <PurposeSelector />
        </div>

        {/* Verbosity Slider */}
        <div class="settings-row mb-4">
          <VerbositySlider />
        </div>

        {/* Configuration Info Card */}
        <div class="config-info card p-3 bg-blue-50 border border-blue-200 rounded-lg mt-4">
          <h4 class="text-sm font-semibold text-blue-900 mb-2">Current Configuration</h4>
          <div class="grid grid-cols-2 gap-2 text-xs">
            <div>
              <span class="text-blue-700 font-medium">Tone:</span>
              <span class="text-blue-900 ml-1">{config.promptModifiers.tone}</span>
            </div>
            <div>
              <span class="text-blue-700 font-medium">Approach:</span>
              <span class="text-blue-900 ml-1">{config.promptModifiers.approach}</span>
            </div>
            <div class="col-span-2">
              <span class="text-blue-700 font-medium">Focus:</span>
              <span class="text-blue-900 ml-1">{config.promptModifiers.focus}</span>
            </div>
          </div>
        </div>
      </section>

      {/* Language & Display Section */}
      <section class="settings-section mb-6">
        <h3 class="text-md font-medium text-gray-800 mb-3">Language & Display</h3>

        {/* Language Dropdown */}
        <div class="settings-row mb-4">
          <label class="settings-label text-sm text-gray-700 mb-2 block">
            Output Language
            <span class="text-xs text-gray-500 block mt-0.5">Language for AI-generated content</span>
          </label>
          <LanguageDropdown />
        </div>

        {/* Image Buttons Toggle */}
        <div class="settings-row">
          <div class="card p-4 bg-white border border-gray-200 rounded-lg">
            <label class="flex items-center justify-between cursor-pointer">
              <div class="flex-1">
                <span class="text-sm font-medium text-gray-700">Image Explanation Buttons</span>
                <p class="text-xs text-gray-500 mt-0.5">Show AI explanation buttons on detected images</p>
              </div>
              <div class="relative inline-flex items-center cursor-pointer ml-4">
                <input
                  type="checkbox"
                  checked={showImageButtons}
                  onChange={handleImageButtonsToggle}
                  class="sr-only peer"
                />
                <div class="w-11 h-6 bg-gray-300 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-green-600 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-gradient-to-r peer-checked:from-green-600 peer-checked:to-green-800"></div>
              </div>
            </label>
          </div>
        </div>
      </section>

      {/* Help Text */}
      <div class="help-text text-xs text-gray-500 mt-6 p-3 bg-gray-50 rounded-lg border border-gray-200">
        <p class="mb-2">
          <strong>💡 Tip:</strong> Settings are saved automatically and apply to all AI-generated content including summaries, analyses, Q&A, and chat responses.
        </p>
        <p>
          Changes take effect immediately for new generations. Previously generated content will retain its original style.
        </p>
      </div>
    </div>
  );
}
