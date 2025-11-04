import { ResearchPaper, PaperSection } from '../types/index.ts';
import { extractPageText, isPDFPage } from './contentExtractor.ts';
import { aiService } from './aiService.ts';
import { getPDFUrl, extractPDFText, extractPDFPages, isScannedPDF } from './pdfExtractor.ts';
import { normalizeUrl } from './urlUtils.ts';
import { logger } from './logger.ts';
import { DetectorRegistry } from '../detectors/DetectorRegistry.ts';

// Create singleton registry instance
const detectorRegistry = new DetectorRegistry();

// Backward compatibility: Export individual detector functions as thin wrappers
export function detectArXivPaper(): ResearchPaper | null {
  const detector = detectorRegistry.getDetector('arxiv');
  return detector?.detect() || null;
}

export function detectPubMedPaper(): ResearchPaper | null {
  const detector = detectorRegistry.getDetector('pubmed');
  return detector?.detect() || null;
}

export function detectBioRxivPaper(): ResearchPaper | null {
  const detector = detectorRegistry.getDetector('biorxiv');
  return detector?.detect() || null;
}

export function detectIEEEPaper(): ResearchPaper | null {
  const detector = detectorRegistry.getDetector('ieee');
  return detector?.detect() || null;
}

export function detectACMPaper(): ResearchPaper | null {
  const detector = detectorRegistry.getDetector('acm');
  return detector?.detect() || null;
}

export function detectScienceDirectPaper(): ResearchPaper | null {
  const detector = detectorRegistry.getDetector('sciencedirect');
  return detector?.detect() || null;
}

export function detectNaturePaper(): ResearchPaper | null {
  const detector = detectorRegistry.getDetector('nature');
  return detector?.detect() || null;
}

export function detectSciencePaper(): ResearchPaper | null {
  const detector = detectorRegistry.getDetector('science');
  return detector?.detect() || null;
}

export function detectPNASPaper(): ResearchPaper | null {
  const detector = detectorRegistry.getDetector('pnas');
  return detector?.detect() || null;
}

export function detectSSRNPaper(): ResearchPaper | null {
  const detector = detectorRegistry.getDetector('ssrn');
  return detector?.detect() || null;
}

export function detectSemanticScholarPaper(): ResearchPaper | null {
  const detector = detectorRegistry.getDetector('semanticscholar');
  return detector?.detect() || null;
}

export function detectSpringerPaper(): ResearchPaper | null {
  const detector = detectorRegistry.getDetector('springer');
  return detector?.detect() || null;
}

export function detectSchemaOrgPaper(): ResearchPaper | null {
  const detector = detectorRegistry.getDetector('schema.org');
  return detector?.detect() || null;
}

// Legacy detector implementations removed - now using DetectorRegistry

/**
 * Detector for PDF research papers
 * Extracts metadata from PDF and uses AI for title/abstract extraction
 */
export async function detectPDFPaper(): Promise<ResearchPaper | null> {
  logger.debug('UTILS', '[PDF Detector] Starting PDF paper detection...');

  try {
    // Get the PDF URL
    const pdfUrl = getPDFUrl();
    if (!pdfUrl) {
      logger.debug('UTILS', '[PDF Detector] Could not determine PDF URL');
      return null;
    }

    logger.debug('UTILS', '[PDF Detector] PDF URL found:', pdfUrl);

    // Check if it's a scanned PDF (no extractable text)
    const isScanned = await isScannedPDF(pdfUrl);
    if (isScanned) {
      logger.warn('UTILS', '[PDF Detector] This appears to be a scanned PDF with no extractable text');
      return null;
    }

    // Extract the first few pages to get title/abstract
    logger.debug('UTILS', '[PDF Detector] Extracting first 2 pages for metadata detection...');
    const firstPagesText = await extractPDFPages(pdfUrl, 1, 2);

    // Clean PDF text for AI processing
    // Remove excessive whitespace, special characters, and truncate
    const cleanedText = firstPagesText
      .replace(/\s+/g, ' ')           // Normalize whitespace
      .replace(/[\x00-\x1F\x7F]/g, '') // Remove control characters
      .replace(/[^\x20-\x7E\s]/g, '')  // Keep only printable ASCII
      .trim()
      .slice(0, 6000);                // Truncate to 6000 chars for AI

    logger.debug('UTILS', `[PDF Detector] Cleaned text: ${cleanedText.length} chars (from ${firstPagesText.length} original)`);

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
    logger.debug('UTILS', '[PDF Detector] Using AI to extract paper metadata from PDF...');
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
    logger.debug('UTILS', '[PDF Detector] AI extraction failed, trying heuristic extraction...');
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
      logger.debug('UTILS', '[PDF Detector] Extracted via heuristics:', {
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

    logger.debug('UTILS', '[PDF Detector] Could not extract paper metadata from PDF');
    return null;
  } catch (error) {
    logger.error('UTILS', '[PDF Detector] Error detecting PDF paper:', error);
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
  logger.debug('UTILS', 'Starting automatic paper detection (no AI)...');

  // Use the DetectorRegistry to try all detectors in priority order
  const paper = detectorRegistry.detectPaper();

  if (isValidPaper(paper)) {
    logger.debug('UTILS', 'Paper detected via detector:', paper!.title);
    return paper;
  }

  // No paper detected with non-AI methods
  logger.debug('UTILS', 'No paper detected automatically. Use "Detect Paper" button to try AI extraction.');
  return null;
}

/**
 * AI-first paper detection (for manual button clicks)
 * Prioritizes AI extraction, then falls back to other methods
 * Best used when triggered by user gesture (has access to AI)
 */
export async function detectPaperWithAI(): Promise<ResearchPaper | null> {
  logger.debug('UTILS', 'Starting AI-first paper detection...');

  // Strategy 1: Check if this is a PDF page and handle accordingly
  try {
    // Check if we're on a PDF page
    if (isPDFPage()) {
      logger.debug('UTILS', 'PDF page detected, using PDF extraction...');
      const pdfPaper = await detectPDFPaper();
      if (isValidPDFPaper(pdfPaper)) {
        logger.debug('UTILS', '✓ Paper detected from PDF:', pdfPaper!.title);
        return pdfPaper;
      }
      logger.debug('UTILS', 'Could not extract valid paper from PDF');
      return null;
    }

    // Extract page text
    const extracted = extractPageText();

    if (extracted.text.length >= 100) {
      logger.debug('UTILS', 'Attempting AI extraction (priority)...');

      // Use AI to extract metadata
      const aiPaper = await aiService.extractPaperMetadata(extracted.text);

      if (isValidPaper(aiPaper)) {
        logger.debug('UTILS', '✓ Paper detected via AI:', aiPaper!.title);
        return aiPaper;
      }

      logger.debug('UTILS', 'AI extraction did not return valid paper, trying fallbacks...');
    } else {
      logger.debug('UTILS', 'Not enough content for AI extraction, trying fallbacks...');
    }
  } catch (error) {
    logger.error('UTILS', 'Error during AI extraction:', error);
    logger.debug('UTILS', 'Falling back to traditional detection methods...');
  }

  // Strategy 2: Fall back to DetectorRegistry for all site-specific detectors
  const paper = detectorRegistry.detectPaper();
  if (isValidPaper(paper)) {
    logger.debug('UTILS', 'Paper detected via detector:', paper!.title);
    return paper;
  }

  logger.debug('UTILS', '❌ No research paper detected on this page');
  return null;
}

/**
 * Hybrid paper detection with field-level tracking
 * Combines results from multiple sources to maximize metadata completeness
 * Uses the hybrid extraction coordinator to merge partial results
 */
export async function detectPaperHybrid(): Promise<ResearchPaper | null> {
  logger.debug('UTILS', 'Starting hybrid paper detection...');

  const {
    mergeExtractionResults,
    paperToPartialResult,
    identifyMissingFields,
    determinePaperSource
  } = await import('./metadataCoordinator.ts');

  const partialResults = [];

  // Step 1: Try all site-specific extractors from registry (highest quality when available)
  const allDetectors = detectorRegistry.getAllDetectors();

  for (const detector of allDetectors) {
    try {
      const paper = detector.detect();
      if (paper) {
        logger.debug('UTILS', `Site-specific extraction succeeded (${detector.name}): ${paper.title}`);
        // Schema.org and high-priority detectors get higher confidence
        const confidence = detector.name === 'schema.org' ? 0.90 : 0.95;
        partialResults.push(paperToPartialResult(paper, 'dom-selector', confidence));
        // If we got a complete result from a trusted source, we might be done
        if (isValidPaper(paper)) {
          logger.debug('UTILS', 'Complete paper found from site-specific extractor');
          break; // Found a complete result, no need to try other site-specific extractors
        }
      }
    } catch (error) {
      logger.debug('UTILS', `Site-specific extractor (${detector.name}) failed:`, error);
    }
  }

  // Step 3: Check what's missing and use AI to fill gaps if needed
  if (partialResults.length > 0) {
    const missingFields = identifyMissingFields(partialResults[0]);

    if (missingFields.length > 0) {
      logger.debug('UTILS', `Missing fields: ${missingFields.join(', ')}, attempting AI extraction...`);

      try {
        // Check if this is a PDF
        if (isPDFPage()) {
          const pdfPaper = await detectPDFPaper();
          if (pdfPaper) {
            logger.debug('UTILS', 'PDF AI extraction succeeded');
            partialResults.push(paperToPartialResult(pdfPaper, 'ai', 0.75));
          }
        } else {
          // Extract page text and use AI
          const extracted = extractPageText();
          if (extracted.text.length >= 100) {
            const aiPaper = await aiService.extractPaperMetadata(extracted.text);
            if (aiPaper) {
              logger.debug('UTILS', 'AI extraction succeeded');
              partialResults.push(paperToPartialResult(aiPaper, 'ai', 0.75));
            }
          }
        }
      } catch (error) {
        logger.debug('UTILS', 'AI extraction failed:', error);
      }
    }
  } else {
    // No partial results yet, try AI as primary method
    logger.debug('UTILS', 'No structured data found, trying AI extraction...');

    try {
      if (isPDFPage()) {
        const pdfPaper = await detectPDFPaper();
        if (pdfPaper) {
          partialResults.push(paperToPartialResult(pdfPaper, 'ai', 0.75));
        }
      } else {
        const extracted = extractPageText();
        if (extracted.text.length >= 100) {
          const aiPaper = await aiService.extractPaperMetadata(extracted.text);
          if (aiPaper) {
            partialResults.push(paperToPartialResult(aiPaper, 'ai', 0.75));
          }
        }
      }
    } catch (error) {
      logger.debug('UTILS', 'AI extraction failed:', error);
    }
  }

  // Step 4: Merge all partial results
  if (partialResults.length > 0) {
    logger.debug('UTILS', `Merging ${partialResults.length} partial results...`);
    const merged = mergeExtractionResults(partialResults);

    if (merged) {
      // Override source with domain-based detection
      merged.source = determinePaperSource(merged.url);
      logger.debug('UTILS', `✓ Hybrid detection succeeded: ${merged.title}`);
      logger.debug('UTILS', `  Confidence: ${(merged.metadata?.confidence || 0) * 100}%`);
      logger.debug('UTILS', `  Fields from ${Object.keys(merged.metadata?.fieldSources || {}).length} sources`);
      return merged;
    }
  }

  logger.debug('UTILS', '❌ Hybrid detection failed - no valid paper found');
  return null;
}

/**
 * Synchronous version for backward compatibility
 * Only tries non-AI detectors
 */
export function detectPaperSync(): ResearchPaper | null {
  const paper = detectorRegistry.detectPaper();

  if (paper) {
    logger.debug('UTILS', 'Paper detected (sync):', paper.title);
    return paper;
  }

  return null;
}
