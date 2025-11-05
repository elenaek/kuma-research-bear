import { ResearchPaper } from '../types/index.ts';
import { normalizeUrl } from '../utils/urlUtils.ts';
import { logger } from '../utils/logger.ts';

/**
 * Abstract base class for all paper detectors
 * Implements the Strategy pattern for site-specific paper detection
 */
export abstract class BasePaperDetector {
  /**
   * Unique identifier for this detector
   */
  abstract get name(): string;

  /**
   * Priority for this detector (higher = try first)
   * Default: 50
   */
  get priority(): number {
    return 50;
  }

  /**
   * Check if this detector can handle the current URL
   * @param url - The URL to check (defaults to current page)
   */
  abstract canDetect(url?: string): boolean;

  /**
   * Attempt to detect and extract paper metadata from the current page
   * @returns ResearchPaper if detected, null otherwise
   */
  abstract detect(): ResearchPaper | null;

  /**
   * Helper: Get current URL or provided URL
   */
  protected getUrl(url?: string): string {
    return url || window.location.href;
  }

  /**
   * Helper: Safe text extraction from element
   */
  protected extractText(selector: string, fallback: string = ''): string {
    return document.querySelector(selector)?.textContent?.trim() || fallback;
  }

  /**
   * Helper: Extract array of text from elements
   */
  protected extractTextArray(selector: string): string[] {
    return Array.from(document.querySelectorAll(selector))
      .map(el => el.textContent?.trim() || '')
      .filter(Boolean);
  }

  /**
   * Helper: Extract attribute from element
   */
  protected extractAttribute(selector: string, attribute: string, fallback: string = ''): string {
    return document.querySelector(selector)?.getAttribute(attribute) || fallback;
  }

  /**
   * Helper: Create paper object with common fields
   */
  protected createPaper(
    title: string,
    authors: string[],
    abstract: string,
    source: string,
    metadata: Record<string, any> = {}
  ): ResearchPaper {
    return {
      title,
      authors,
      abstract,
      url: normalizeUrl(this.getUrl()),
      source,
      metadata: {
        ...metadata,
        extractionMethod: 'site-specific',
        extractionTimestamp: Date.now(),
      },
    };
  }

  /**
   * Helper: Log detection error
   */
  protected logError(error: unknown): void {
    logger.error('DETECTOR', `Error in ${this.name} detector:`, error);
  }

  /**
   * Helper: Log detection success
   */
  protected logSuccess(paper: ResearchPaper): void {
    logger.debug('DETECTOR', `${this.name} detected paper:`, paper.title);
  }
}
