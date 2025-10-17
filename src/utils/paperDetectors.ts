import { ResearchPaper, PaperSection } from '../types/index.ts';
import { extractPageText, isPDFPage } from './contentExtractor.ts';
import { aiService } from './aiService.ts';
import { getPDFUrl, extractPDFText, extractPDFPages, isScannedPDF } from './pdfExtractor.ts';

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

/**
 * Detector for PDF research papers
 * Extracts metadata from PDF and uses AI for title/abstract extraction
 */
export async function detectPDFPaper(): Promise<ResearchPaper | null> {
  console.log('[PDF Detector] Starting PDF paper detection...');

  try {
    // Get the PDF URL
    const pdfUrl = getPDFUrl();
    if (!pdfUrl) {
      console.log('[PDF Detector] Could not determine PDF URL');
      return null;
    }

    console.log('[PDF Detector] PDF URL found:', pdfUrl);

    // Check if it's a scanned PDF (no extractable text)
    const isScanned = await isScannedPDF(pdfUrl);
    if (isScanned) {
      console.warn('[PDF Detector] This appears to be a scanned PDF with no extractable text');
      return null;
    }

    // Extract the first few pages to get title/abstract
    console.log('[PDF Detector] Extracting first 3 pages for metadata detection...');
    const firstPagesText = await extractPDFPages(pdfUrl, 1, 3);

    // Try to detect arXiv ID from URL or content
    let arxivId: string | undefined;
    const arxivMatch = pdfUrl.match(/arxiv\.org\/pdf\/(\d+\.\d+)/);
    if (arxivMatch) {
      arxivId = arxivMatch[1];
    } else {
      // Try to find arXiv ID in the PDF text
      const arxivTextMatch = firstPagesText.match(/arXiv:(\d+\.\d+)/i);
      if (arxivTextMatch) {
        arxivId = arxivTextMatch[1];
      }
    }

    // Try to detect DOI from content
    const doiMatch = firstPagesText.match(/doi:\s*(10\.\d+\/[^\s]+)/i) ||
                     firstPagesText.match(/(10\.\d+\/[^\s]+)/);
    const doi = doiMatch ? doiMatch[1] : undefined;

    // Use AI to extract structured metadata from the first pages
    console.log('[PDF Detector] Using AI to extract paper metadata from PDF...');
    const aiPaper = await aiService.extractPaperMetadata(firstPagesText);

    if (aiPaper) {
      // Enhance with PDF-specific metadata
      return {
        ...aiPaper,
        url: window.location.href, // Use the current page URL
        source: arxivId ? 'arxiv' : 'pdf',
        metadata: {
          ...aiPaper.metadata,
          arxivId,
          doi,
          pdfUrl,
          extractionMethod: 'pdf-ai',
          extractionTimestamp: Date.now(),
        },
      };
    }

    // Fallback: Try to parse title from first page manually
    const lines = firstPagesText.split('\n').map(l => l.trim()).filter(Boolean);
    const potentialTitle = lines.find(line => line.length > 20 && line.length < 200);

    if (potentialTitle) {
      console.log('[PDF Detector] Extracted title via heuristics:', potentialTitle);

      return {
        title: potentialTitle,
        authors: [],
        abstract: '',
        url: window.location.href,
        source: 'pdf',
        metadata: {
          arxivId,
          doi,
          pdfUrl,
          extractionMethod: 'pdf-heuristic',
          extractionTimestamp: Date.now(),
        },
      };
    }

    console.log('[PDF Detector] Could not extract paper metadata from PDF');
    return null;
  } catch (error) {
    console.error('[PDF Detector] Error detecting PDF paper:', error);
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
 * Main detector function - fast detection without AI
 * Used for automatic detection on page load/mutations
 * Only uses schema.org and site-specific detectors
 */
export async function detectPaper(): Promise<ResearchPaper | null> {
  console.log('Starting automatic paper detection (no AI)...');

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

  // No paper detected with non-AI methods
  console.log('No paper detected automatically. Use "Detect Paper" button to try AI extraction.');
  return null;
}

/**
 * AI-first paper detection (for manual button clicks)
 * Prioritizes AI extraction, then falls back to other methods
 * Best used when triggered by user gesture (has access to AI)
 */
export async function detectPaperWithAI(): Promise<ResearchPaper | null> {
  console.log('Starting AI-first paper detection...');

  // Strategy 1: Check if this is a PDF page and handle accordingly
  try {
    // Check if we're on a PDF page
    if (isPDFPage()) {
      console.log('PDF page detected, using PDF extraction...');
      const pdfPaper = await detectPDFPaper();
      if (isValidPaper(pdfPaper)) {
        console.log('✓ Paper detected from PDF:', pdfPaper!.title);
        return pdfPaper;
      }
      console.log('Could not extract valid paper from PDF');
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
