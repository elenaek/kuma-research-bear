import { ResearchPaper, PaperSection } from '../types/index.ts';
import { extractPageText, isPDFPage } from './contentExtractor.ts';
import { aiService } from './aiService.ts';

// Detector for arXiv papers
export function detectArXivPaper(): ResearchPaper | null {
  const url = window.location.href;

  if (!url.includes('arxiv.org')) return null;

  try {
    const title = document.querySelector('h1.title')?.textContent?.replace('Title:', '').trim() || '';
    const authors = Array.from(document.querySelectorAll('.authors a'))
      .map(el => el.textContent?.trim() || '')
      .filter(Boolean);

    const abstractBlock = document.querySelector('.abstract');
    const abstract = abstractBlock?.textContent?.replace('Abstract:', '').trim() || '';

    // Extract arXiv ID
    const arxivIdMatch = url.match(/arxiv\.org\/(abs|pdf)\/(\d+\.\d+)/);
    const arxivId = arxivIdMatch ? arxivIdMatch[2] : '';

    return {
      title,
      authors,
      abstract,
      url,
      source: 'arxiv',
      metadata: {
        arxivId,
        pdfUrl: `https://arxiv.org/pdf/${arxivId}.pdf`,
        extractionMethod: 'site-specific',
        extractionTimestamp: Date.now(),
      },
    };
  } catch (error) {
    console.error('Error detecting arXiv paper:', error);
    return null;
  }
}

// Detector for PubMed papers
export function detectPubMedPaper(): ResearchPaper | null {
  const url = window.location.href;

  if (!url.includes('pubmed.ncbi.nlm.nih.gov') && !url.includes('ncbi.nlm.nih.gov/pmc')) return null;

  try {
    const title = document.querySelector('h1.heading-title')?.textContent?.trim() ||
                  document.querySelector('.article-title')?.textContent?.trim() || '';

    const authors = Array.from(document.querySelectorAll('.authors-list button, .contrib-group a'))
      .map(el => el.textContent?.trim() || '')
      .filter(Boolean);

    const abstract = document.querySelector('#abstract .abstract-content')?.textContent?.trim() ||
                    document.querySelector('#enc-abstract')?.textContent?.trim() || '';

    // Extract DOI
    const doiElement = document.querySelector('[data-doi]');
    const doi = doiElement?.getAttribute('data-doi') || '';

    // Extract PubMed ID from URL
    const pmidMatch = url.match(/pubmed\.ncbi\.nlm\.nih\.gov\/(\d+)/);
    const pmid = pmidMatch ? pmidMatch[1] : '';

    return {
      title,
      authors,
      abstract,
      url,
      source: 'pubmed',
      metadata: {
        doi,
        pmid,
        extractionMethod: 'site-specific',
        extractionTimestamp: Date.now(),
      },
    };
  } catch (error) {
    console.error('Error detecting PubMed paper:', error);
    return null;
  }
}

// Detector for bioRxiv/medRxiv papers
export function detectBioRxivPaper(): ResearchPaper | null {
  const url = window.location.href;

  if (!url.includes('biorxiv.org') && !url.includes('medrxiv.org')) return null;

  try {
    const title = document.querySelector('h1#page-title')?.textContent?.trim() || '';

    const authors = Array.from(document.querySelectorAll('.highwire-citation-author'))
      .map(el => el.textContent?.trim() || '')
      .filter(Boolean);

    const abstract = document.querySelector('#abstract-1 p')?.textContent?.trim() ||
                    document.querySelector('.abstract')?.textContent?.trim() || '';

    // Extract DOI
    const doiMatch = url.match(/10\.\d+\/[^\s]+/);
    const doi = doiMatch ? doiMatch[0] : '';

    return {
      title,
      authors,
      abstract,
      url,
      source: 'biorxiv',
      metadata: {
        doi,
        extractionMethod: 'site-specific',
        extractionTimestamp: Date.now(),
      },
    };
  } catch (error) {
    console.error('Error detecting bioRxiv paper:', error);
    return null;
  }
}

// Generic detector for papers with schema.org markup
export function detectSchemaOrgPaper(): ResearchPaper | null {
  try {
    const jsonLdScripts = document.querySelectorAll('script[type="application/ld+json"]');

    for (const script of jsonLdScripts) {
      const data = JSON.parse(script.textContent || '{}');

      if (data['@type'] === 'ScholarlyArticle' || data['@type'] === 'Article') {
        const authors = Array.isArray(data.author)
          ? data.author.map((a: any) => a.name || '')
          : [data.author?.name || ''];

        return {
          title: data.headline || data.name || '',
          authors: authors.filter(Boolean),
          abstract: data.description || '',
          url: window.location.href,
          source: 'other',
          metadata: {
            doi: data.doi || undefined,
            publishDate: data.datePublished || undefined,
            journal: data.publisher?.name || undefined,
            extractionMethod: 'schema.org',
            extractionTimestamp: Date.now(),
          },
        };
      }
    }

    return null;
  } catch (error) {
    console.error('Error detecting schema.org paper:', error);
    return null;
  }
}

/**
 * Validate that a detected paper has minimum required information
 */
function isValidPaper(paper: ResearchPaper | null): boolean {
  if (!paper) return false;

  return (
    paper.title.length > 10 &&
    paper.authors.length > 0 &&
    paper.abstract.length > 50
  );
}

/**
 * Main detector function - uses AI-powered extraction
 * Falls back to site-specific detectors if AI fails
 */
export async function detectPaper(): Promise<ResearchPaper | null> {
  console.log('Starting paper detection...');

  // Strategy 1: Try schema.org structured data (fast and reliable)
  const schemaPaper = detectSchemaOrgPaper();
  if (isValidPaper(schemaPaper)) {
    console.log('Paper detected via schema.org:', schemaPaper!.title);
    return schemaPaper;
  }

  // Strategy 2: Try site-specific detectors (fast, but fragile)
  const siteDetectors = [
    detectArXivPaper,
    detectPubMedPaper,
    detectBioRxivPaper,
  ];

  for (const detector of siteDetectors) {
    const paper = detector();
    if (isValidPaper(paper)) {
      console.log('Paper detected via site-specific detector:', paper!.title);
      return paper;
    }
  }

  // Strategy 3: AI-powered extraction (works everywhere, but slower)
  try {
    console.log('Attempting AI-powered extraction...');

    // Check if we're on a PDF page
    if (isPDFPage()) {
      console.log('PDF detected, but PDF extraction not yet implemented');
      // TODO: Implement PDF extraction in Phase 6
      return null;
    }

    // Extract page text
    const extracted = extractPageText();

    if (extracted.text.length < 100) {
      console.log('Not enough content for AI extraction');
      return null;
    }

    // Use AI to extract metadata
    const aiPaper = await aiService.extractPaperMetadata(extracted.text);

    if (isValidPaper(aiPaper)) {
      console.log('Paper detected via AI extraction:', aiPaper!.title);
      return aiPaper;
    }

    console.log('AI extraction failed validation');
    return null;
  } catch (error) {
    console.error('Error in AI extraction:', error);
    return null;
  }
}

/**
 * AI-first paper detection (for manual button clicks)
 * Prioritizes AI extraction, then falls back to other methods
 * Best used when triggered by user gesture (has access to AI)
 */
export async function detectPaperWithAI(): Promise<ResearchPaper | null> {
  console.log('Starting AI-first paper detection...');

  // Strategy 1: Try AI extraction first (priority for manual detection)
  try {
    // Check if we're on a PDF page
    if (isPDFPage()) {
      console.log('PDF detected, but PDF extraction not yet implemented');
      // TODO: Implement PDF extraction in Phase 6
      return null;
    }

    // Extract page text
    const extracted = extractPageText();

    if (extracted.text.length >= 100) {
      console.log('Attempting AI extraction (priority)...');

      // Use AI to extract metadata
      const aiPaper = await aiService.extractPaperMetadata(extracted.text);

      if (isValidPaper(aiPaper)) {
        console.log('✓ Paper detected via AI:', aiPaper!.title);
        return aiPaper;
      }

      console.log('AI extraction did not return valid paper, trying fallbacks...');
    } else {
      console.log('Not enough content for AI extraction, trying fallbacks...');
    }
  } catch (error) {
    console.error('Error during AI extraction:', error);
    console.log('Falling back to traditional detection methods...');
  }

  // Strategy 2: Fall back to schema.org structured data
  const schemaPaper = detectSchemaOrgPaper();
  if (isValidPaper(schemaPaper)) {
    console.log('Paper detected via schema.org:', schemaPaper!.title);
    return schemaPaper;
  }

  // Strategy 3: Fall back to site-specific detectors
  const siteDetectors = [
    detectArXivPaper,
    detectPubMedPaper,
    detectBioRxivPaper,
  ];

  for (const detector of siteDetectors) {
    const paper = detector();
    if (isValidPaper(paper)) {
      console.log('Paper detected via site-specific detector:', paper!.title);
      return paper;
    }
  }

  console.log('❌ No research paper detected on this page');
  return null;
}

/**
 * Synchronous version for backward compatibility
 * Only tries non-AI detectors
 */
export function detectPaperSync(): ResearchPaper | null {
  const detectors = [
    detectArXivPaper,
    detectPubMedPaper,
    detectBioRxivPaper,
    detectSchemaOrgPaper,
  ];

  for (const detector of detectors) {
    const paper = detector();
    if (paper) {
      console.log('Paper detected (sync):', paper.title);
      return paper;
    }
  }

  return null;
}
