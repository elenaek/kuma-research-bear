import { ResearchPaper } from '../types/index.ts';
import { BasePaperDetector } from './BasePaperDetector.ts';

/**
 * Detector for SSRN (Social Science Research Network) papers
 */
export class SSRNDetector extends BasePaperDetector {
  get name(): string {
    return 'ssrn';
  }

  get priority(): number {
    return 60;
  }

  canDetect(url?: string): boolean {
    return this.getUrl(url).includes('ssrn.com');
  }

  detect(): ResearchPaper | null {
    if (!this.canDetect()) return null;

    try {
      const title = this.extractText('h1');

      const authors = this.extractTextArray('.author-link, .authors a');

      const abstract = this.extractText('.abstract-text') ||
                      this.extractText('#abstract');

      // Extract SSRN ID from URL
      const ssrnIdMatch = this.getUrl().match(/abstract[=\/](\d+)/);
      const ssrnId = ssrnIdMatch ? ssrnIdMatch[1] : '';

      const publishDate = this.extractText('.publication-date');

      const paper = this.createPaper(title, authors, abstract, 'ssrn', {
        ssrnId,
        publishDate,
        publicationType: 'preprint',
      });

      this.logSuccess(paper);
      return paper;
    } catch (error) {
      this.logError(error);
      return null;
    }
  }
}
