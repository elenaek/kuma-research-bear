import { ResearchPaper } from '../types/index.ts';
import { BasePaperDetector } from './BasePaperDetector.ts';

/**
 * Detector for Semantic Scholar papers
 */
export class SemanticScholarDetector extends BasePaperDetector {
  get name(): string {
    return 'semanticscholar';
  }

  get priority(): number {
    return 65;
  }

  canDetect(url?: string): boolean {
    return this.getUrl(url).includes('semanticscholar');
  }

  detect(): ResearchPaper | null {
    if (!this.canDetect()) return null;

    try {
      const title = this.extractText('h1[data-test-id="paper-detail-title"]') ||
                   this.extractText('.paper-detail-page__title');

      const authors = this.extractTextArray('.author-list__link, .author-name');

      const abstract = this.extractText('.paper-detail-page__abstract') ||
                      this.extractText('[data-test-id="text-truncator-text"]');

      // Extract DOI if available
      const doiElement = document.querySelector('a[href*="doi.org"]');
      const doiMatch = doiElement?.getAttribute('href')?.match(/10\.\d+\/[^\s]+/);
      const doi = doiMatch ? doiMatch[0] : '';

      // Extract venue
      const venue = this.extractText('.paper-meta-item__venue');

      // Extract publication year
      const publishDate = this.extractText('.paper-meta-item__year');

      const paper = this.createPaper(title, authors, abstract, 'semanticscholar', {
        doi,
        venue,
        publishDate,
      });

      this.logSuccess(paper);
      return paper;
    } catch (error) {
      this.logError(error);
      return null;
    }
  }
}
