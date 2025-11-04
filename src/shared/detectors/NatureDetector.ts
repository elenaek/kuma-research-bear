import { ResearchPaper } from '../types/index.ts';
import { BasePaperDetector } from './BasePaperDetector.ts';

/**
 * Detector for Nature papers
 */
export class NatureDetector extends BasePaperDetector {
  get name(): string {
    return 'nature';
  }

  get priority(): number {
    return 70;
  }

  canDetect(url?: string): boolean {
    return this.getUrl(url).includes('nature.com');
  }

  detect(): ResearchPaper | null {
    if (!this.canDetect()) return null;

    try {
      const title = this.extractText('h1.c-article-title') ||
                   this.extractText('.article-title');

      const authors = this.extractTextArray('.c-article-author-list__item, .author-name');

      const abstract = this.extractText('#Abs1-content') ||
                      this.extractText('.c-article-section__content');

      // Extract DOI
      const doiElement = document.querySelector('a[data-track-action="view doi"]');
      const doi = doiElement?.getAttribute('href')?.replace('https://doi.org/', '') || '';

      // Extract journal name
      const journal = this.extractText('.c-article-identifiers__item') || 'Nature';

      // Extract publish date
      const publishDate = this.extractAttribute('time', 'datetime') ||
                         this.extractText('.c-article-identifiers__item time');

      const paper = this.createPaper(title, authors, abstract, 'nature', {
        doi,
        journal,
        publishDate,
        publicationType: 'journal-article',
      });

      this.logSuccess(paper);
      return paper;
    } catch (error) {
      this.logError(error);
      return null;
    }
  }
}
