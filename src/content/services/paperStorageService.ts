import { ResearchPaper, MessageType } from '../../shared/types/index.ts';
import * as ChromeService from '../../services/chromeService.ts';
import { extractFullText } from './textExtractionService.ts';
import { detectResearchPaper } from '../../shared/utils/paperDetection.ts';
import { generatePaperId } from '../../shared/utils/dbService.ts';
import { extractResearchPaper, isPDFPage } from '../../shared/utils/contentExtractor.ts';
import { logger } from '../../shared/utils/logger.ts';

/**
 * Paper Storage Service
 * Handles paper storage operations via background worker using ChromeService
 */

export interface StorageResult {
  stored: boolean;
  chunkCount: number;
  alreadyStored: boolean;
  storageError?: string;
  paperId?: string;
  detectionFailed?: boolean;  // NEW: Indicates if paper detection failed
  detectionReason?: string;   // NEW: Reason for detection failure
}

/**
 * Create a metadata chunk containing paper information for RAG semantic search
 * This allows users to ask questions like "Who wrote this?" or "When was this published?"
 */
export function createMetadataChunk(
  paper: ResearchPaper,
  paperId: string
): import('../../shared/types/index.ts').ContentChunk {
  // Format metadata as semantic-search-friendly text
  const metadataParts: string[] = [];

  // Title
  metadataParts.push(`Paper Title: ${paper.title}`);
  metadataParts.push('');

  // Authors
  if (paper.authors && paper.authors.length > 0) {
    metadataParts.push(`Authors: ${paper.authors.join(', ')}`);
    metadataParts.push('');
  }

  // Abstract
  if (paper.abstract) {
    metadataParts.push('Abstract:');
    metadataParts.push(paper.abstract);
    metadataParts.push('');
  }

  // Publication Information
  const pubInfo: string[] = [];
  if (paper.metadata?.publishDate) {
    pubInfo.push(`Published: ${paper.metadata.publishDate}`);
  }
  if (paper.metadata?.journal) {
    pubInfo.push(`Journal: ${paper.metadata.journal}`);
  }
  if (paper.metadata?.venue) {
    pubInfo.push(`Venue: ${paper.metadata.venue}`);
  }
  if (paper.source) {
    pubInfo.push(`Source: ${paper.source}`);
  }

  if (pubInfo.length > 0) {
    metadataParts.push('Publication Information:');
    pubInfo.forEach(info => metadataParts.push(`- ${info}`));
    metadataParts.push('');
  }

  // Identifiers
  const identifiers: string[] = [];
  if (paper.metadata?.doi) {
    identifiers.push(`DOI: ${paper.metadata.doi}`);
  }
  if (paper.metadata?.arxivId) {
    identifiers.push(`arXiv ID: ${paper.metadata.arxivId}`);
  }
  if (paper.metadata?.pmid) {
    identifiers.push(`PubMed ID: ${paper.metadata.pmid}`);
  }
  if (paper.metadata?.pmcid) {
    identifiers.push(`PubMed Central ID: ${paper.metadata.pmcid}`);
  }
  if (paper.url) {
    identifiers.push(`URL: ${paper.url}`);
  }

  if (identifiers.length > 0) {
    metadataParts.push('Identifiers:');
    identifiers.forEach(id => metadataParts.push(`- ${id}`));
    metadataParts.push('');
  }

  // Keywords
  if (paper.metadata?.keywords && paper.metadata.keywords.length > 0) {
    metadataParts.push(`Keywords: ${paper.metadata.keywords.join(', ')}`);
  }

  const metadataContent = metadataParts.join('\n');

  // Create chunk object
  return {
    id: `chunk_${paperId}_0`,
    paperId,
    content: metadataContent,
    index: 0,
    section: 'Paper Metadata',
    sectionLevel: 1,
    isResearchPaper: true,
    startChar: 0,
    endChar: metadataContent.length,
    tokenCount: Math.ceil(metadataContent.length / 4),
  };
}

/**
 * Store paper with full text extraction and storage status tracking
 * Handles both new papers and already-stored papers
 */
export async function storePaper(paper: ResearchPaper): Promise<StorageResult> {
  logger.debug('CONTENT_SCRIPT', '[PaperStorage] Preparing to store paper:', {
    title: paper.title,
    url: paper.url,
    source: paper.source
  });

  try {
    // Step 1: Detect if this is a research paper
    // For PDFs, skip HTML-based detection (PDF viewer doesn't have HTML structure)
    const isPDF = isPDFPage();
    let detectionResult;

    if (isPDF) {
      // PDFs from academic sources are pre-validated
      // Skip HTML structure checks which don't apply to PDF viewer
      logger.debug('CONTENT_SCRIPT', '[PaperStorage] PDF detected, skipping HTML-based detection');
      detectionResult = {
        isResearchPaper: true,
        confidence: 100,
        reason: 'PDF from academic source (pre-validated)',
      };
    } else {
      // HTML pages - use full detection
      logger.debug('CONTENT_SCRIPT', '[PaperStorage] Detecting if page is a research paper...');
      detectionResult = await detectResearchPaper();
      logger.debug('CONTENT_SCRIPT', '[PaperStorage] Detection result:', detectionResult);
    }

    // If not a research paper, return early (don't store)
    if (!detectionResult.isResearchPaper) {
      logger.warn('CONTENT_SCRIPT', '[PaperStorage] ⚠ Not a research paper, skipping storage');
      return {
        stored: false,
        chunkCount: 0,
        alreadyStored: false,
        detectionFailed: true,
        detectionReason: detectionResult.reason,
        storageError: `Not a research paper: ${detectionResult.reason}`,
      };
    }

    // LEVEL 1 DEDUPLICATION: Check if already stored
    const alreadyStored = await ChromeService.isPaperStoredInDB(paper.url);
    logger.debug('CONTENT_SCRIPT', '[PaperStorage] isPaperStored check result:', alreadyStored);

    if (alreadyStored) {
      logger.debug('CONTENT_SCRIPT', '[PaperStorage] Paper already stored, fetching existing data...');
      const existingPaper = await ChromeService.getPaperByUrl(paper.url);
      logger.debug('CONTENT_SCRIPT', '[PaperStorage] Existing paper retrieved:', {
        id: existingPaper?.id,
        chunkCount: existingPaper?.chunkCount
      });

      return {
        stored: true,
        chunkCount: existingPaper?.chunkCount || 0,
        alreadyStored: true,
        paperId: existingPaper?.id,
      };
    }

    // Generate paper ID for returning to caller
    const paperId = generatePaperId(paper.url);

    // isPDF is already defined earlier in the function
    if (isPDF) {
      // PDF FLOW: Extract PDF text and send directly to background for storage
      logger.debug('CONTENT_SCRIPT', '[PaperStorage] PDF detected ✓ Extracting PDF text...');

      try {
        // Extract full PDF text using PDF.js
        const fullText = await extractFullText();

        if (!fullText || fullText.trim().length === 0) {
          logger.error('CONTENT_SCRIPT', '[PaperStorage] ❌ PDF extraction returned empty text');
          return {
            stored: false,
            chunkCount: 0,
            alreadyStored: false,
            storageError: 'PDF extraction failed: No text extracted from PDF',
          };
        }

        logger.debug('CONTENT_SCRIPT', '[PaperStorage] ✓ PDF text extracted, sending to background for chunking...');

        // Send PDF text directly to background for chunking and storage
        chrome.runtime.sendMessage({
          type: MessageType.STORE_PAPER_IN_DB,
          payload: {
            paper,
            fullText,
            paperUrl: paper.url,  // Include URL for tabId lookup
          }
        });

        logger.debug('CONTENT_SCRIPT', '[PaperStorage] ✓ PDF sent to background for chunking');

        return {
          stored: true,
          chunkCount: 0, // Will be populated when chunking completes
          alreadyStored: false,
          paperId,
        };
      } catch (pdfError) {
        logger.error('CONTENT_SCRIPT', '[PaperStorage] ❌ PDF extraction failed:', pdfError);
        return {
          stored: false,
          chunkCount: 0,
          alreadyStored: false,
          storageError: `PDF extraction failed: ${pdfError instanceof Error ? pdfError.message : String(pdfError)}`,
        };
      }
    } else {
      // HTML FLOW: Send HTML to background for offscreen extraction (fire-and-forget)
      logger.debug('CONTENT_SCRIPT', '[PaperStorage] HTML page detected ✓ Sending HTML to background for extraction...');

      // Serialize HTML
      const paperHtml = document.documentElement.outerHTML;

      // Send to background script which will trigger offscreen extraction
      chrome.runtime.sendMessage({
        type: MessageType.EXTRACT_PAPER_HTML,
        payload: {
          paperHtml,
          paperUrl: paper.url,
          paper,
        }
      });

      logger.debug('CONTENT_SCRIPT', '[PaperStorage] ✓ Extraction message sent to background (processing in offscreen)');

      // Return immediately - extraction will complete asynchronously
      // User can navigate away while extraction happens
      return {
        stored: true,
        chunkCount: 0, // Will be populated when extraction completes
        alreadyStored: false,
        paperId,
      };
    }
  } catch (error) {
    // Capture detailed error message for debugging
    logger.error('CONTENT_SCRIPT', '[PaperStorage] ❌ Failed to store paper:', {
      error,
      stack: error instanceof Error ? error.stack : undefined,
      paperUrl: paper.url
    });

    return {
      stored: false,
      chunkCount: 0,
      alreadyStored: false,
      storageError: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Simple storage without detailed tracking (for auto-detection on page load)
 */
export async function storePaperSimple(paper: ResearchPaper): Promise<boolean> {
  try {
    // Detect if this is a research paper
    // For PDFs, skip HTML-based detection (PDF viewer doesn't have HTML structure)
    const isPDF = isPDFPage();
    let detectionResult;

    if (isPDF) {
      // PDFs from academic sources are pre-validated
      // Skip HTML structure checks which don't apply to PDF viewer
      logger.debug('CONTENT_SCRIPT', '[PaperStorage] PDF detected, skipping HTML-based detection');
      detectionResult = {
        isResearchPaper: true,
        confidence: 100,
        reason: 'PDF from academic source (pre-validated)',
      };
    } else {
      // HTML pages - use full detection
      logger.debug('CONTENT_SCRIPT', '[PaperStorage] Detecting if page is a research paper...');
      detectionResult = await detectResearchPaper();
    }

    // If not a research paper, return false (don't store)
    if (!detectionResult.isResearchPaper) {
      logger.warn('CONTENT_SCRIPT', '[PaperStorage] ⚠ Not a research paper, skipping storage:', detectionResult.reason);
      return false;
    }

    // LEVEL 1 DEDUPLICATION: Check if already stored
    const alreadyStored = await ChromeService.isPaperStoredInDB(paper.url);

    if (alreadyStored) {
      logger.debug('CONTENT_SCRIPT', '[PaperStorage] Paper already stored in IndexedDB');
      return true;
    }

    // isPDF is already defined earlier in the function
    if (isPDF) {
      // PDF FLOW: Extract PDF text and send directly to background for storage
      logger.debug('CONTENT_SCRIPT', '[PaperStorage] PDF detected ✓ Extracting PDF text...');

      try {
        // Extract full PDF text using PDF.js
        const fullText = await extractFullText();

        if (!fullText || fullText.trim().length === 0) {
          logger.error('CONTENT_SCRIPT', '[PaperStorage] ❌ PDF extraction returned empty text');
          return false;
        }

        logger.debug('CONTENT_SCRIPT', '[PaperStorage] ✓ PDF text extracted, sending to background for chunking...');

        // Send PDF text directly to background for chunking and storage
        chrome.runtime.sendMessage({
          type: MessageType.STORE_PAPER_IN_DB,
          payload: {
            paper,
            fullText,
            paperUrl: paper.url,  // Include URL for tabId lookup
          }
        });

        logger.debug('CONTENT_SCRIPT', '[PaperStorage] ✓ PDF sent to background for chunking');
        return true;
      } catch (pdfError) {
        logger.error('CONTENT_SCRIPT', '[PaperStorage] ❌ PDF extraction failed:', pdfError);
        return false;
      }
    } else {
      // HTML FLOW: Send HTML to background for offscreen extraction (fire-and-forget)
      logger.debug('CONTENT_SCRIPT', '[PaperStorage] HTML page detected ✓ Sending HTML to background for extraction...');

      // Serialize HTML
      const paperHtml = document.documentElement.outerHTML;

      // Send to background script which will trigger offscreen extraction
      chrome.runtime.sendMessage({
        type: MessageType.EXTRACT_PAPER_HTML,
        payload: {
          paperHtml,
          paperUrl: paper.url,
          paper,
        }
      });

      logger.debug('CONTENT_SCRIPT', '[PaperStorage] ✓ Extraction message sent to background (processing in offscreen)');
      return true;
    }
  } catch (error) {
    logger.warn('CONTENT_SCRIPT', '[PaperStorage] Failed to store paper:', error);
    return false;
  }
}
