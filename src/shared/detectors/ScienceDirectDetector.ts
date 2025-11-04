import { ResearchPaper } from '../types/index.ts';
import { BasePaperDetector } from './BasePaperDetector.ts';

/**
 * Detector for ScienceDirect papers
 */
export class ScienceDirectDetector extends BasePaperDetector {
  get name(): string {
    return 'sciencedirect';
  }

  get priority(): number {
    return 75;
  }

  canDetect(url?: string): boolean {
    return this.getUrl(url).includes('sciencedirect');
  }

  detect(): ResearchPaper | null {
    if (!this.canDetect()) return null;

    try {
      const title = this.extractText('.title-text') ||
                   this.extractText('h1.article-title');

      // ScienceDirect has separate given name and surname elements
      const authorElements = document.querySelectorAll('.author');
      const authors = Array.from(authorElements).map(authorEl => {
        const given = authorEl.querySelector('.given-name')?.textContent?.trim() || '';
        const surname = authorEl.querySelector('.surname')?.textContent?.trim() || '';
        return `${given} ${surname}`.trim();
      }).filter(Boolean);

      // Fallback if combined approach didn't work
      const finalAuthors = authors.length > 0
        ? authors
        : this.extractTextArray('.author .given-name, .author .surname');

      const abstract = this.extractText('#abstracts .abstract') ||
                      this.extractText('.abstract.author');

      // Extract DOI
      const doiElement = document.querySelector('a.doi');
      const doi = doiElement?.getAttribute('href')?.replace('https://doi.org/', '') || '';

      // Extract journal info
      const journal = this.extractText('.publication-title') ||
                     this.extractAttribute('meta[name="citation_journal_title"]', 'content');

      const publishDate = this.extractText('.publication-date') ||
                         this.extractAttribute('meta[name="citation_publication_date"]', 'content');

      const paper = this.createPaper(title, finalAuthors, abstract, 'sciencedirect', {
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
