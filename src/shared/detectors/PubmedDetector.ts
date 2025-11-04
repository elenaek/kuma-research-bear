import { ResearchPaper } from '../types/index.ts';
import { BasePaperDetector } from './BasePaperDetector.ts';

/**
 * Detector for PubMed/PMC papers
 */
export class PubmedDetector extends BasePaperDetector {
  get name(): string {
    return 'pubmed';
  }

  get priority(): number {
    return 95;
  }

  canDetect(url?: string): boolean {
    const urlStr = this.getUrl(url);
    return urlStr.includes('pubmed.ncbi.nlm.nih.gov') ||
           urlStr.includes('ncbi.nlm.nih.gov/pmc');
  }

  detect(): ResearchPaper | null {
    if (!this.canDetect()) return null;

    try {
      const title = this.extractText('h1.heading-title') ||
                    this.extractText('.article-title');

      const authors = this.extractTextArray('.authors-list button, .contrib-group a');

      const abstract = this.extractText('#abstract .abstract-content') ||
                      this.extractText('#enc-abstract');

      // Extract DOI
      const doi = this.extractAttribute('[data-doi]', 'data-doi');

      // Extract PubMed ID from URL
      const pmidMatch = this.getUrl().match(/pubmed\.ncbi\.nlm\.nih\.gov\/(\d+)/);
      const pmid = pmidMatch ? pmidMatch[1] : '';

      const paper = this.createPaper(title, authors, abstract, 'pubmed', {
        doi,
        pmid,
      });

      this.logSuccess(paper);
      return paper;
    } catch (error) {
      this.logError(error);
      return null;
    }
  }
}
