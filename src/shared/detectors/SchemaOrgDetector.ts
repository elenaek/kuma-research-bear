import { ResearchPaper } from '../types/index.ts';
import { BasePaperDetector } from './BasePaperDetector.ts';

/**
 * Generic detector for papers with schema.org markup
 * Uses JSON-LD structured data
 */
export class SchemaOrgDetector extends BasePaperDetector {
  get name(): string {
    return 'schema.org';
  }

  get priority(): number {
    return 100; // High priority - structured data is very reliable
  }

  canDetect(url?: string): boolean {
    // Always check for schema.org markup
    return !!document.querySelector('script[type="application/ld+json"]');
  }

  detect(): ResearchPaper | null {
    if (!this.canDetect()) return null;

    try {
      const jsonLdScripts = document.querySelectorAll('script[type="application/ld+json"]');

      for (const script of jsonLdScripts) {
        try {
          const data = JSON.parse(script.textContent || '{}');

          // Check if this is a scholarly article
          if (data['@type'] === 'ScholarlyArticle' || data['@type'] === 'Article') {
            // Extract authors (can be array or single object)
            const authors = Array.isArray(data.author)
              ? data.author.map((a: any) => a.name || '').filter(Boolean)
              : data.author?.name
              ? [data.author.name]
              : [];

            const title = data.headline || data.name || '';
            const abstract = data.description || '';

            if (!title) continue; // Skip if no title

            const paper = this.createPaper(title, authors, abstract, 'other', {
              doi: data.doi || undefined,
              publishDate: data.datePublished || undefined,
              journal: data.publisher?.name || undefined,
              extractionMethod: 'schema.org',
            });

            this.logSuccess(paper);
            return paper;
          }
        } catch (parseError) {
          // Skip this script if JSON parsing fails
          continue;
        }
      }

      return null;
    } catch (error) {
      this.logError(error);
      return null;
    }
  }
}
