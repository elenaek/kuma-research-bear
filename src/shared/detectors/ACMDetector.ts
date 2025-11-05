import { ResearchPaper } from '../types/index.ts';
import { BasePaperDetector } from './BasePaperDetector.ts';

/**
 * Detector for ACM Digital Library papers
 */
export class ACMDetector extends BasePaperDetector {
  get name(): string {
    return 'acm';
  }

  get priority(): number {
    return 80;
  }

  canDetect(url?: string): boolean {
    return this.getUrl(url).includes('acm.org');
  }

  detect(): ResearchPaper | null {
    if (!this.canDetect()) return null;

    try {
      const title = this.extractText('.citation__title') ||
                   this.extractText('h1.title');

      const authors = this.extractTextArray('.author-name, .loa__author-name span');

      const abstract = this.extractText('.abstractSection p') ||
                      this.extractText('.article__abstract');

      // Extract DOI from link or URL
      const doiElement = document.querySelector('a[href*="doi.org"]');
      let doi = '';
      if (doiElement) {
        const doiMatch = doiElement.getAttribute('href')?.match(/10\.\d+\/[^\s]+/);
        doi = doiMatch ? doiMatch[0] : '';
      }
      if (!doi) {
        const urlMatch = this.getUrl().match(/10\.\d+\/[^\s]+/);
        doi = urlMatch ? urlMatch[0] : '';
      }

      // Extract venue/conference
      const venue = this.extractText('.epub-section__title') ||
                   this.extractAttribute('meta[name="citation_conference_title"]', 'content');

      const publishDate = this.extractAttribute('meta[name="citation_publication_date"]', 'content') ||
                         this.extractText('.CitationCoverDate');

      const paper = this.createPaper(title, authors, abstract, 'acm', {
        doi,
        venue,
        publishDate,
        publicationType: venue ? 'conference-paper' : 'journal-article',
      });

      this.logSuccess(paper);
      return paper;
    } catch (error) {
      this.logError(error);
      return null;
    }
  }
}
