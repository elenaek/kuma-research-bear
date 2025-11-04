import { AIAvailability } from '../../../shared/types/index.ts';
import { logger } from '../../../shared/utils/logger.ts';

/**
 * LanguageService - Manages language detection
 *
 * Responsibilities:
 * - Detect language from text using Chrome's Language Detector API
 * - Check Language Detector API availability
 * - Provide fallback to English when detection fails
 */
export class LanguageService {
  /**
   * Check if Chrome Language Detector API is available
   *
   * @returns Object with availability status and enum value
   */
  async checkAvailability(): Promise<{ available: boolean; availability: AIAvailability }> {
    try {
      // Check if LanguageDetector global is available
      if (typeof LanguageDetector === 'undefined') {
        logger.debug('LANGUAGE_SERVICE', '[LanguageDetector] API not available (typeof LanguageDetector === undefined)');
        return {
          available: false,
          availability: 'no',
        };
      }

      const availability: AIAvailability = await LanguageDetector.availability();
      logger.debug('LANGUAGE_SERVICE', '[LanguageDetector] API availability:', availability);

      return {
        available: availability === 'available',
        availability,
      };
    } catch (error) {
      logger.error('LANGUAGE_SERVICE', '[LanguageDetector] Error checking availability:', error);
      return {
        available: false,
        availability: 'no',
      };
    }
  }

  /**
   * Detect the language of a text using Chrome's Language Detector API
   *
   * @param text - Text to detect language from (title, abstract, etc.)
   * @returns ISO 639-1 language code (e.g., 'en', 'es', 'fr') or null if text is empty
   */
  async detectLanguage(text: string): Promise<string | null> {
    try {
      if (!text || text.trim().length === 0) {
        logger.warn('LANGUAGE_SERVICE', '[LanguageDetector] Empty text provided');
        return null;
      }

      // Check availability first
      const { available } = await this.checkAvailability();
      if (!available) {
        logger.warn('LANGUAGE_SERVICE', '[LanguageDetector] API not available, falling back to "en"');
        return 'en'; // Default to English if detector unavailable
      }

      logger.debug('LANGUAGE_SERVICE', '[LanguageDetector] Detecting language for text (length:', text.length, ')');

      // Create detector and detect language
      const detector = await LanguageDetector.create();
      const results = await detector.detect(text);

      // Cleanup detector
      detector.destroy();

      // Get the most confident result
      if (results && results.length > 0) {
        const topResult = results[0];
        logger.debug('LANGUAGE_SERVICE', '[LanguageDetector] Detected language:', topResult.detectedLanguage,
                    'with confidence:', topResult.confidence);
        return topResult.detectedLanguage;
      }

      logger.warn('LANGUAGE_SERVICE', '[LanguageDetector] No language detected, falling back to "en"');
      return 'en';
    } catch (error) {
      logger.error('LANGUAGE_SERVICE', '[LanguageDetector] Error detecting language:', error);
      return 'en'; // Default to English on error
    }
  }

  /**
   * Detect language with confidence threshold
   * Only returns the language if confidence is above threshold
   *
   * @param text - Text to detect language from
   * @param minConfidence - Minimum confidence threshold (0-1, default: 0.5)
   * @returns Language code if confidence is sufficient, otherwise 'en'
   */
  async detectLanguageWithConfidence(
    text: string,
    minConfidence: number = 0.5
  ): Promise<string> {
    try {
      if (!text || text.trim().length === 0) {
        return 'en';
      }

      const { available } = await this.checkAvailability();
      if (!available) {
        return 'en';
      }

      const detector = await LanguageDetector.create();
      const results = await detector.detect(text);
      detector.destroy();

      if (results && results.length > 0) {
        const topResult = results[0];
        if (topResult.confidence >= minConfidence) {
          logger.debug('LANGUAGE_SERVICE', `[LanguageDetector] High confidence detection: ${topResult.detectedLanguage} (${topResult.confidence})`);
          return topResult.detectedLanguage;
        } else {
          logger.debug('LANGUAGE_SERVICE', `[LanguageDetector] Low confidence (${topResult.confidence}), falling back to "en"`);
        }
      }

      return 'en';
    } catch (error) {
      logger.error('LANGUAGE_SERVICE', '[LanguageDetector] Error in confidence detection:', error);
      return 'en';
    }
  }

  /**
   * Batch detect languages for multiple texts
   * Useful for detecting language across multiple fields
   *
   * @param texts - Array of texts to detect
   * @returns Array of language codes in the same order
   */
  async detectLanguagesBatch(texts: string[]): Promise<string[]> {
    const results: string[] = [];

    for (const text of texts) {
      const lang = await this.detectLanguage(text);
      results.push(lang || 'en');
    }

    return results;
  }

  /**
   * Get the most common language from multiple detections
   * Useful for determining overall document language
   *
   * @param texts - Array of text samples
   * @returns Most common detected language
   */
  async detectMostCommonLanguage(texts: string[]): Promise<string> {
    const languages = await this.detectLanguagesBatch(texts);

    // Count occurrences
    const counts: { [key: string]: number } = {};
    for (const lang of languages) {
      counts[lang] = (counts[lang] || 0) + 1;
    }

    // Find most common
    let mostCommon = 'en';
    let maxCount = 0;
    for (const [lang, count] of Object.entries(counts)) {
      if (count > maxCount) {
        maxCount = count;
        mostCommon = lang;
      }
    }

    return mostCommon;
  }
}
