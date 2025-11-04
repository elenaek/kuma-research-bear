import { ResearchPaper } from '../types/index.ts';
import { BasePaperDetector } from './BasePaperDetector.ts';

/**
 * Detector for arXiv.org papers
 */
export class ArxivDetector extends BasePaperDetector {
  get name(): string {
    return 'arxiv';
  }

  get priority(): number {
    return 100; // High priority - very structured site
  }

  canDetect(url?: string): boolean {
    return this.getUrl(url).includes('arxiv.org');
  }

  detect(): ResearchPaper | null {
    if (!this.canDetect()) return null;

    try {
      const title = this.extractText('h1.title')
        .replace('Title:', '').trim();

      const authors = this.extractTextArray('.authors a');

      const abstract = this.extractText('.abstract')
        .replace('Abstract:', '').trim();

      // Extract arXiv ID
      const arxivIdMatch = this.getUrl().match(/arxiv\.org\/(abs|pdf)\/(\d+\.\d+)/);
      const arxivId = arxivIdMatch ? arxivIdMatch[2] : '';

      const paper = this.createPaper(title, authors, abstract, 'arxiv', {
        arxivId,
        pdfUrl: `https://arxiv.org/pdf/${arxivId}.pdf`,
      });

      this.logSuccess(paper);
      return paper;
    } catch (error) {
      this.logError(error);
      return null;
    }
  }
}
