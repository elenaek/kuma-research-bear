/**
 * Settings Service
 *
 * Manages global extension settings including language preferences.
 * Uses chrome.storage.sync for cross-device synchronization.
 */

import { SUPPORTED_LANGUAGES } from '../types/index.ts';

const SETTINGS_KEY = 'kuma_settings';

export interface Settings {
  outputLanguage: string; // ISO 639-1 language code
}

/**
 * Gets the browser's default language code
 * Falls back to 'en' if unable to determine
 */
function getBrowserLanguage(): string {
  const browserLang = navigator.language?.split('-')[0] || 'en';

  // Check if browser language is in our supported languages
  const isSupported = SUPPORTED_LANGUAGES.some(lang => lang.code === browserLang);

  return isSupported ? browserLang : 'en';
}

/**
 * Gets the current output language setting
 * Returns browser language or 'en' as default if not set
 */
export async function getOutputLanguage(): Promise<string> {
  try {
    const result = await chrome.storage.sync.get(SETTINGS_KEY);
    const settings = result[SETTINGS_KEY] as Settings | undefined;

    if (settings?.outputLanguage) {
      return settings.outputLanguage;
    }

    // No setting found, return browser language or default
    return getBrowserLanguage();
  } catch (error) {
    console.error('Error getting output language:', error);
    return 'en';
  }
}

/**
 * Sets the output language preference
 * @param languageCode ISO 639-1 language code
 */
export async function setOutputLanguage(languageCode: string): Promise<void> {
  try {
    // Validate language code
    const isValid = SUPPORTED_LANGUAGES.some(lang => lang.code === languageCode);
    if (!isValid) {
      console.warn(`Invalid language code: ${languageCode}. Falling back to 'en'`);
      languageCode = 'en';
    }

    // Get existing settings or create new
    const result = await chrome.storage.sync.get(SETTINGS_KEY);
    const settings: Settings = (result[SETTINGS_KEY] as Settings) || { outputLanguage: 'en' };

    // Update language
    settings.outputLanguage = languageCode;

    // Save to storage
    await chrome.storage.sync.set({ [SETTINGS_KEY]: settings });

    console.log(`Output language set to: ${languageCode}`);
  } catch (error) {
    console.error('Error setting output language:', error);
    throw error;
  }
}

/**
 * Gets all settings
 */
export async function getSettings(): Promise<Settings> {
  try {
    const result = await chrome.storage.sync.get(SETTINGS_KEY);
    const settings = result[SETTINGS_KEY] as Settings | undefined;

    return settings || {
      outputLanguage: getBrowserLanguage()
    };
  } catch (error) {
    console.error('Error getting settings:', error);
    return {
      outputLanguage: 'en'
    };
  }
}

/**
 * Listen for changes to output language setting
 * @param callback Function to call when language changes
 * @returns Cleanup function to remove listener
 */
export function onOutputLanguageChanged(callback: (newLanguage: string) => void): () => void {
  const listener = (changes: { [key: string]: chrome.storage.StorageChange }, areaName: string) => {
    if (areaName === 'sync' && changes[SETTINGS_KEY]) {
      const newSettings = changes[SETTINGS_KEY].newValue as Settings | undefined;
      if (newSettings?.outputLanguage) {
        callback(newSettings.outputLanguage);
      }
    }
  };

  chrome.storage.onChanged.addListener(listener);

  // Return cleanup function
  return () => {
    chrome.storage.onChanged.removeListener(listener);
  };
}
