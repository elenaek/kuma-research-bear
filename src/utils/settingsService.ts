/**
 * Settings Service
 *
 * Manages global extension settings including language, persona, and purpose preferences.
 * Uses chrome.storage.sync for cross-device synchronization.
 */

import { SUPPORTED_LANGUAGES } from '../types/index.ts';
import type { Persona, Purpose, PersonaPurposeConfig } from '../types/personaPurpose.ts';
import { PERSONA_PURPOSE_CONFIGS } from '../types/personaPurpose.ts';
import { logger } from './logger.ts';

const SETTINGS_KEY = 'kuma_settings';

export interface Settings {
  outputLanguage: string; // ISO 639-1 language code
  showImageButtons?: boolean; // Show/hide image explanation buttons
  persona?: Persona; // User persona (default: 'professional')
  purpose?: Purpose; // User purpose (default: 'learning')
  verbosity?: number; // Response verbosity level 1-5 (default: 3, balanced)
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
    return "en";
  } catch (error) {
    logger.error('SETTINGS', 'Error getting output language:', error);
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
      logger.warn('SETTINGS', `Invalid language code: ${languageCode}. Falling back to 'en'`);
      languageCode = 'en';
    }

    // Get existing settings or create new
    const result = await chrome.storage.sync.get(SETTINGS_KEY);
    const settings: Settings = (result[SETTINGS_KEY] as Settings) || { outputLanguage: 'en' };

    // Update language
    settings.outputLanguage = languageCode;

    // Save to storage
    await chrome.storage.sync.set({ [SETTINGS_KEY]: settings });

    logger.debug('SETTINGS', `Output language set to: ${languageCode}`);
  } catch (error) {
    logger.error('SETTINGS', 'Error setting output language:', error);
    throw error;
  }
}

/**
 * Gets the show image buttons setting
 * Returns true as default if not set
 */
export async function getShowImageButtons(): Promise<boolean> {
  try {
    const result = await chrome.storage.sync.get(SETTINGS_KEY);
    const settings = result[SETTINGS_KEY] as Settings | undefined;

    // Default to true if not set
    return settings?.showImageButtons ?? true;
  } catch (error) {
    logger.error('SETTINGS', 'Error getting show image buttons setting:', error);
    return true;
  }
}

/**
 * Sets the show image buttons preference
 * @param show Whether to show image explanation buttons
 */
export async function setShowImageButtons(show: boolean): Promise<void> {
  try {
    // Get existing settings or create new
    const result = await chrome.storage.sync.get(SETTINGS_KEY);
    const settings: Settings = (result[SETTINGS_KEY] as Settings) || {
      outputLanguage: getBrowserLanguage()
    };

    // Update setting
    settings.showImageButtons = show;

    // Save to storage
    await chrome.storage.sync.set({ [SETTINGS_KEY]: settings });

    logger.debug('SETTINGS', `Show image buttons set to: ${show}`);
  } catch (error) {
    logger.error('SETTINGS', 'Error setting show image buttons:', error);
    throw error;
  }
}

/**
 * Gets the current persona setting
 * Returns 'professional' as default if not set
 */
export async function getPersona(): Promise<Persona> {
  try {
    const result = await chrome.storage.sync.get(SETTINGS_KEY);
    const settings = result[SETTINGS_KEY] as Settings | undefined;

    // Default to 'professional' if not set
    return settings?.persona ?? 'professional';
  } catch (error) {
    logger.error('SETTINGS', 'Error getting persona:', error);
    return 'professional';
  }
}

/**
 * Sets the persona preference
 * @param persona User persona ('professional' or 'student')
 */
export async function setPersona(persona: Persona): Promise<void> {
  try {
    // Get existing settings or create new
    const result = await chrome.storage.sync.get(SETTINGS_KEY);
    const settings: Settings = (result[SETTINGS_KEY] as Settings) || {
      outputLanguage: getBrowserLanguage(),
      persona: 'professional',
      purpose: 'learning'
    };

    // Update persona
    settings.persona = persona;

    // Save to storage
    await chrome.storage.sync.set({ [SETTINGS_KEY]: settings });

    logger.debug('SETTINGS', `Persona set to: ${persona}`);
  } catch (error) {
    logger.error('SETTINGS', 'Error setting persona:', error);
    throw error;
  }
}

/**
 * Gets the current purpose setting
 * Returns 'learning' as default if not set
 */
export async function getPurpose(): Promise<Purpose> {
  try {
    const result = await chrome.storage.sync.get(SETTINGS_KEY);
    const settings = result[SETTINGS_KEY] as Settings | undefined;

    // Default to 'learning' if not set
    return settings?.purpose ?? 'learning';
  } catch (error) {
    logger.error('SETTINGS', 'Error getting purpose:', error);
    return 'learning';
  }
}

/**
 * Sets the purpose preference
 * @param purpose User purpose ('writing' or 'learning')
 */
export async function setPurpose(purpose: Purpose): Promise<void> {
  try {
    // Get existing settings or create new
    const result = await chrome.storage.sync.get(SETTINGS_KEY);
    const settings: Settings = (result[SETTINGS_KEY] as Settings) || {
      outputLanguage: getBrowserLanguage(),
      persona: 'professional',
      purpose: 'learning'
    };

    // Update purpose
    settings.purpose = purpose;

    // Save to storage
    await chrome.storage.sync.set({ [SETTINGS_KEY]: settings });

    logger.debug('SETTINGS', `Purpose set to: ${purpose}`);
  } catch (error) {
    logger.error('SETTINGS', 'Error setting purpose:', error);
    throw error;
  }
}

/**
 * Gets the current verbosity setting
 * Returns 3 (balanced) as default if not set
 */
export async function getVerbosity(): Promise<number> {
  try {
    const result = await chrome.storage.sync.get(SETTINGS_KEY);
    const settings = result[SETTINGS_KEY] as Settings | undefined;

    // Default to 3 (balanced) if not set
    return settings?.verbosity ?? 3;
  } catch (error) {
    logger.error('SETTINGS', 'Error getting verbosity:', error);
    return 3;
  }
}

/**
 * Sets the verbosity preference
 * @param verbosity Verbosity level (1-5, where 1 is concise and 5 is detailed)
 */
export async function setVerbosity(verbosity: number): Promise<void> {
  try {
    // Validate verbosity range
    const clampedVerbosity = Math.min(5, Math.max(1, Math.round(verbosity)));

    // Get existing settings or create new
    const result = await chrome.storage.sync.get(SETTINGS_KEY);
    const settings: Settings = (result[SETTINGS_KEY] as Settings) || {
      outputLanguage: getBrowserLanguage(),
      persona: 'professional',
      purpose: 'learning',
      verbosity: 3
    };

    // Update verbosity
    settings.verbosity = clampedVerbosity;

    // Save to storage
    await chrome.storage.sync.set({ [SETTINGS_KEY]: settings });

    logger.debug('SETTINGS', `Verbosity set to: ${clampedVerbosity}`);
  } catch (error) {
    logger.error('SETTINGS', 'Error setting verbosity:', error);
    throw error;
  }
}

/**
 * Gets the persona/purpose configuration for current settings
 * Returns temperature, topK, and prompt modifiers
 */
export async function getPersonaPurposeConfig(): Promise<PersonaPurposeConfig> {
  try {
    const persona = await getPersona();
    const purpose = await getPurpose();

    return PERSONA_PURPOSE_CONFIGS[persona][purpose];
  } catch (error) {
    logger.error('SETTINGS', 'Error getting persona/purpose config:', error);
    // Return default config (professional + learning)
    return PERSONA_PURPOSE_CONFIGS.professional.learning;
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
      outputLanguage: getBrowserLanguage(),
      showImageButtons: true,
      persona: 'professional',
      purpose: 'learning',
      verbosity: 3
    };
  } catch (error) {
    logger.error('SETTINGS', 'Error getting settings:', error);
    return {
      outputLanguage: 'en',
      showImageButtons: true,
      persona: 'professional',
      purpose: 'learning',
      verbosity: 3
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

/**
 * Listen for changes to persona setting
 * @param callback Function to call when persona changes
 * @returns Cleanup function to remove listener
 */
export function onPersonaChanged(callback: (newPersona: Persona) => void): () => void {
  const listener = (changes: { [key: string]: chrome.storage.StorageChange }, areaName: string) => {
    if (areaName === 'sync' && changes[SETTINGS_KEY]) {
      const newSettings = changes[SETTINGS_KEY].newValue as Settings | undefined;
      if (newSettings?.persona) {
        callback(newSettings.persona);
      }
    }
  };

  chrome.storage.onChanged.addListener(listener);

  // Return cleanup function
  return () => {
    chrome.storage.onChanged.removeListener(listener);
  };
}

/**
 * Listen for changes to purpose setting
 * @param callback Function to call when purpose changes
 * @returns Cleanup function to remove listener
 */
export function onPurposeChanged(callback: (newPurpose: Purpose) => void): () => void {
  const listener = (changes: { [key: string]: chrome.storage.StorageChange }, areaName: string) => {
    if (areaName === 'sync' && changes[SETTINGS_KEY]) {
      const newSettings = changes[SETTINGS_KEY].newValue as Settings | undefined;
      if (newSettings?.purpose) {
        callback(newSettings.purpose);
      }
    }
  };

  chrome.storage.onChanged.addListener(listener);

  // Return cleanup function
  return () => {
    chrome.storage.onChanged.removeListener(listener);
  };
}

/**
 * Listen for changes to persona or purpose settings
 * @param callback Function to call when persona/purpose changes
 * @returns Cleanup function to remove listener
 */
export function onPersonaPurposeChanged(
  callback: (persona: Persona, purpose: Purpose, config: PersonaPurposeConfig) => void
): () => void {
  const listener = (changes: { [key: string]: chrome.storage.StorageChange }, areaName: string) => {
    if (areaName === 'sync' && changes[SETTINGS_KEY]) {
      const newSettings = changes[SETTINGS_KEY].newValue as Settings | undefined;
      if (newSettings?.persona || newSettings?.purpose) {
        const persona = newSettings.persona ?? 'professional';
        const purpose = newSettings.purpose ?? 'learning';
        const config = PERSONA_PURPOSE_CONFIGS[persona][purpose];
        callback(persona, purpose, config);
      }
    }
  };

  chrome.storage.onChanged.addListener(listener);

  // Return cleanup function
  return () => {
    chrome.storage.onChanged.removeListener(listener);
  };
}

/**
 * Listen for changes to verbosity setting
 * @param callback Function to call when verbosity changes
 * @returns Cleanup function to remove listener
 */
export function onVerbosityChanged(callback: (newVerbosity: number) => void): () => void {
  const listener = (changes: { [key: string]: chrome.storage.StorageChange }, areaName: string) => {
    if (areaName === 'sync' && changes[SETTINGS_KEY]) {
      const newSettings = changes[SETTINGS_KEY].newValue as Settings | undefined;
      if (newSettings?.verbosity !== undefined) {
        callback(newSettings.verbosity);
      }
    }
  };

  chrome.storage.onChanged.addListener(listener);

  // Return cleanup function
  return () => {
    chrome.storage.onChanged.removeListener(listener);
  };
}
