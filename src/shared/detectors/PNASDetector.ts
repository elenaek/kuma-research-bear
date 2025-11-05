import { ResearchPaper } from '../types/index.ts';
import { BasePaperDetector } from './BasePaperDetector.ts';

/**
 * Detector for PNAS (Proceedings of the National Academy of Sciences) papers
 */
export class PNASDetector extends BasePaperDetector {
  get name(): string {
    return 'pnas';
  }

  get priority(): number {
    return 70;
  }

  canDetect(url?: string): boolean {
    return this.getUrl(url).includes('pnas.org');
  }

  detect(): ResearchPaper | null {
    if (!this.canDetect()) return null;

    try {
      const title = this.extractText('h1.highwire-cite-title') ||
                   this.extractText('.article-title');

      const authors = this.extractTextArray('.contributor-list .name, .highwire-cite-author');

      const abstract = this.extractText('.abstract') ||
                      this.extractText('#abstract-1');

      // Extract DOI from meta tag
      const doi = this.extractAttribute('meta[name="citation_doi"]', 'content');

      const publishDate = this.extractAttribute('meta[name="citation_publication_date"]', 'content') ||
                         this.extractText('.pnas-date');

      const paper = this.createPaper(title, authors, abstract, 'pnas', {
        doi,
        journal: 'Proceedings of the National Academy of Sciences',
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
