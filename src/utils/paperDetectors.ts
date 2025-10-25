import { ResearchPaper, PaperSection } from '../types/index.ts';
import { extractPageText, isPDFPage } from './contentExtractor.ts';
import { aiService } from './aiService.ts';
import { getPDFUrl, extractPDFText, extractPDFPages, isScannedPDF } from './pdfExtractor.ts';
import { normalizeUrl } from './urlUtils.ts';

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
      url: normalizeUrl(url),
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
      url: normalizeUrl(url),
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
      url: normalizeUrl(url),
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
    console.log('[PDF Detector] Extracting first 2 pages for metadata detection...');
    const firstPagesText = await extractPDFPages(pdfUrl, 1, 2);

    // Clean PDF text for AI processing
    // Remove excessive whitespace, special characters, and truncate
    const cleanedText = firstPagesText
      .replace(/\s+/g, ' ')           // Normalize whitespace
      .replace(/[\x00-\x1F\x7F]/g, '') // Remove control characters
      .replace(/[^\x20-\x7E\s]/g, '')  // Keep only printable ASCII
      .trim()
      .slice(0, 6000);                // Truncate to 6000 chars for AI

    console.log(`[PDF Detector] Cleaned text: ${cleanedText.length} chars (from ${firstPagesText.length} original)`);

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

    // Use AI to extract structured metadata from the cleaned text
    console.log('[PDF Detector] Using AI to extract paper metadata from PDF...');
    const aiPaper = await aiService.extractPaperMetadata(cleanedText);

    if (aiPaper) {
      // Enhance with PDF-specific metadata
      return {
        ...aiPaper,
        url: normalizeUrl(window.location.href), // Use the current page URL
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

    // Fallback: Try to parse title/authors/abstract manually
    console.log('[PDF Detector] AI extraction failed, trying heuristic extraction...');
    const lines = firstPagesText.split('\n').map(l => l.trim()).filter(Boolean);

    // Find title: usually first long line (20-200 chars)
    const potentialTitle = lines.find(line => line.length > 20 && line.length < 200);

    // Try to extract authors: look for common patterns
    const authors: string[] = [];
    const authorPatterns = [
      /^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)(?:\s*,\s*|\s+and\s+)/,  // "John Smith, Jane Doe"
      /^by\s+(.+?)(?:\s*$)/i,  // "by John Smith"
    ];

    for (const line of lines.slice(0, 10)) { // Check first 10 lines
      for (const pattern of authorPatterns) {
        const match = line.match(pattern);
        if (match && match[1]) {
          // Split by common delimiters
          const authorNames = match[1].split(/,|and/).map(n => n.trim()).filter(Boolean);
          authors.push(...authorNames);
        }
      }

      // Also check if line looks like "FirstName LastName"
      if (/^[A-Z][a-z]+\s+[A-Z][a-z]+$/.test(line) && line.length < 50) {
        if (!authors.includes(line)) {
          authors.push(line);
        }
      }
    }

    // Try to extract abstract: find "Abstract" section
    let abstract = '';
    const abstractIndex = firstPagesText.toLowerCase().indexOf('abstract');
    if (abstractIndex !== -1) {
      // Get text after "Abstract" heading
      const afterAbstract = firstPagesText.slice(abstractIndex + 8).trim();
      // Take until we hit another section or ~500 chars
      const nextSection = afterAbstract.search(/\n\s*\n[A-Z]/);
      abstract = afterAbstract.slice(0, nextSection !== -1 ? nextSection : 500).trim();
    }

    if (potentialTitle) {
      console.log('[PDF Detector] Extracted via heuristics:', {
        title: potentialTitle,
        authors: authors.length,
        abstractLength: abstract.length,
      });

      return {
        title: potentialTitle,
        authors: authors.slice(0, 10), // Limit to 10 authors max
        abstract,
        url: normalizeUrl(window.location.href),
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
          url: normalizeUrl(window.location.href),
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
 * Relaxed validation for PDF papers
 * PDFs often have extraction issues, so we're more lenient
 * Only requires a valid title
 */
function isValidPDFPaper(paper: ResearchPaper | null): boolean {
  if (!paper) return false;

  // For PDFs, we only require a title
  // Authors and abstract are optional since extraction is harder
  return paper.title.length > 10;
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
      if (isValidPDFPaper(pdfPaper)) {
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
