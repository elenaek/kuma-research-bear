import { ResearchPaper } from '../types/index.ts';
import { BasePaperDetector } from './BasePaperDetector.ts';

/**
 * Detector for Springer papers
 */
export class SpringerDetector extends BasePaperDetector {
  get name(): string {
    return 'springer';
  }

  get priority(): number {
    return 65;
  }

  canDetect(url?: string): boolean {
    return this.getUrl(url).includes('springer');
  }

  detect(): ResearchPaper | null {
    if (!this.canDetect()) return null;

    try {
      const title = this.extractText('h1.c-article-title') ||
                   this.extractText('.ArticleTitle');

      const authors = this.extractTextArray('.c-article-author-list__item, .AuthorName');

      const abstract = this.extractText('#Abs1-content') ||
                      this.extractText('.Abstract');

      // Extract DOI from element or meta tag
      const doiElement = document.querySelector('a[data-track-action="view doi"]');
      let doi = '';
      if (doiElement) {
        doi = doiElement.getAttribute('href')?.replace('https://doi.org/', '') || '';
      }
      if (!doi) {
        doi = this.extractAttribute('meta[name="citation_doi"]', 'content');
      }

      // Extract journal
      const journal = this.extractText('.c-journal-title') ||
                     this.extractAttribute('meta[name="citation_journal_title"]', 'content');

      const publishDate = this.extractAttribute('time', 'datetime') ||
                         this.extractAttribute('meta[name="citation_publication_date"]', 'content');

      const paper = this.createPaper(title, authors, abstract, 'springer', {
        doi,
        journal,
        publishDate,
        publicationType: journal ? 'journal-article' : 'unknown',
      });

      this.logSuccess(paper);
      return paper;
    } catch (error) {
      this.logError(error);
      return null;
    }
  }
}
