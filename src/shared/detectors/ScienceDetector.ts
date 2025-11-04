import { ResearchPaper } from '../types/index.ts';
import { BasePaperDetector } from './BasePaperDetector.ts';

/**
 * Detector for Science.org papers
 */
export class ScienceDetector extends BasePaperDetector {
  get name(): string {
    return 'science';
  }

  get priority(): number {
    return 70;
  }

  canDetect(url?: string): boolean {
    const urlStr = this.getUrl(url);
    return urlStr.includes('science.org') || urlStr.includes('sciencemag.org');
  }

  detect(): ResearchPaper | null {
    if (!this.canDetect()) return null;

    try {
      const title = this.extractText('h1.article-title') ||
                   this.extractText('.highwire-cite-title');

      const authors = this.extractTextArray('.contributor-list .name, .highwire-cite-author');

      const abstract = this.extractText('.abstract') ||
                      this.extractText('.section.abstract p');

      // Extract DOI from meta tag
      const doi = this.extractAttribute('meta[name="citation_doi"]', 'content');

      const journal = this.extractAttribute('meta[name="citation_journal_title"]', 'content') || 'Science';

      const publishDate = this.extractAttribute('meta[name="citation_publication_date"]', 'content') ||
                         this.extractText('.meta-date');

      const paper = this.createPaper(title, authors, abstract, 'science', {
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
