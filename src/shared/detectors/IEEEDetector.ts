import { ResearchPaper } from '../types/index.ts';
import { BasePaperDetector } from './BasePaperDetector.ts';

/**
 * Detector for IEEE Xplore papers
 */
export class IEEEDetector extends BasePaperDetector {
  get name(): string {
    return 'ieee';
  }

  get priority(): number {
    return 85;
  }

  canDetect(url?: string): boolean {
    return this.getUrl(url).includes('ieee');
  }

  detect(): ResearchPaper | null {
    if (!this.canDetect()) return null;

    try {
      const title = this.extractText('.document-title') ||
                   this.extractText('h1.title');

      const authors = this.extractTextArray('.authors-info .author span, .author-name');

      const abstract = this.extractText('.abstract-text') ||
                      this.extractText('.article-abstract');

      // Extract DOI from meta tag
      const doi = this.extractAttribute('meta[name="citation_doi"]', 'content');

      // Extract publication info
      const journal = this.extractText('.stats-document-abstract-publishedIn a') ||
                     this.extractAttribute('meta[name="citation_journal_title"]', 'content');

      const publishDate = this.extractAttribute('meta[name="citation_publication_date"]', 'content') ||
                         this.extractText('.doc-abstract-pubdate');

      // Extract PDF URL
      let pdfUrl = this.extractAttribute('a[href*="stamp/stamp.jsp"]', 'href');
      if (pdfUrl && !pdfUrl.startsWith('http')) {
        pdfUrl = `https://ieeexplore.ieee.org${pdfUrl}`;
      }

      const paper = this.createPaper(title, authors, abstract, 'ieee', {
        doi,
        journal,
        publishDate,
        pdfUrl: pdfUrl || undefined,
        publicationType: 'conference-paper',
      });

      this.logSuccess(paper);
      return paper;
    } catch (error) {
      this.logError(error);
      return null;
    }
  }
}
