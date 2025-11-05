import { ResearchPaper } from '../types/index.ts';
import { BasePaperDetector } from './BasePaperDetector.ts';

/**
 * Detector for bioRxiv/medRxiv papers
 */
export class BiorxivDetector extends BasePaperDetector {
  get name(): string {
    return 'biorxiv';
  }

  get priority(): number {
    return 90;
  }

  canDetect(url?: string): boolean {
    const urlStr = this.getUrl(url);
    return urlStr.includes('biorxiv.org') || urlStr.includes('medrxiv.org');
  }

  detect(): ResearchPaper | null {
    if (!this.canDetect()) return null;

    try {
      const title = this.extractText('h1#page-title');

      const authors = this.extractTextArray('.highwire-citation-author');

      const abstract = this.extractText('#abstract-1 p') ||
                      this.extractText('.abstract');

      // Extract DOI from URL
      const doiMatch = this.getUrl().match(/10\.\d+\/[^\s]+/);
      const doi = doiMatch ? doiMatch[0] : '';

      const paper = this.createPaper(title, authors, abstract, 'biorxiv', {
        doi,
      });

      this.logSuccess(paper);
      return paper;
    } catch (error) {
      this.logError(error);
      return null;
    }
  }
}
