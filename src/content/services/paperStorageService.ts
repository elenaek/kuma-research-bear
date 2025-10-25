import { ResearchPaper, MessageType } from '../../types/index.ts';
import * as ChromeService from '../../services/ChromeService.ts';
import { extractFullText } from './textExtractionService.ts';
import { detectResearchPaper } from '../../utils/paperDetection.ts';
import { generatePaperId } from '../../utils/dbService.ts';
import { extractResearchPaper } from '../../utils/contentExtractor.ts';

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
): import('../../types/index.ts').ContentChunk {
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
  console.log('[PaperStorage] Preparing to store paper:', {
    title: paper.title,
    url: paper.url,
    source: paper.source
  });

  try {
    // Step 1: Detect if this is a research paper
    console.log('[PaperStorage] Detecting if page is a research paper...');
    const detectionResult = await detectResearchPaper();
    console.log('[PaperStorage] Detection result:', detectionResult);

    // If not a research paper, return early (don't store)
    if (!detectionResult.isResearchPaper) {
      console.warn('[PaperStorage] ⚠ Not a research paper, skipping storage');
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
    console.log('[PaperStorage] isPaperStored check result:', alreadyStored);

    if (alreadyStored) {
      console.log('[PaperStorage] Paper already stored, fetching existing data...');
      const existingPaper = await ChromeService.getPaperByUrl(paper.url);
      console.log('[PaperStorage] Existing paper retrieved:', {
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

    // NEW FLOW: Send HTML to background for offscreen extraction (fire-and-forget)
    console.log('[PaperStorage] Research paper detected ✓ Sending HTML to background for extraction...');

    // Serialize HTML
    const paperHtml = document.documentElement.outerHTML;

    // Generate paper ID for returning to caller
    const paperId = generatePaperId(paper.url);

    // Send to background script which will trigger offscreen extraction
    chrome.runtime.sendMessage({
      type: MessageType.EXTRACT_PAPER_HTML,
      payload: {
        paperHtml,
        paperUrl: paper.url,
        paper,
      }
    });

    console.log('[PaperStorage] ✓ Extraction message sent to background (processing in offscreen)');

    // Return immediately - extraction will complete asynchronously
    // User can navigate away while extraction happens
    return {
      stored: true,
      chunkCount: 0, // Will be populated when extraction completes
      alreadyStored: false,
      paperId,
    };
  } catch (error) {
    // Capture detailed error message for debugging
    console.error('[PaperStorage] ❌ Failed to store paper:', {
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
    console.log('[PaperStorage] Detecting if page is a research paper...');
    const detectionResult = await detectResearchPaper();

    // If not a research paper, return false (don't store)
    if (!detectionResult.isResearchPaper) {
      console.warn('[PaperStorage] ⚠ Not a research paper, skipping storage:', detectionResult.reason);
      return false;
    }

    // LEVEL 1 DEDUPLICATION: Check if already stored
    const alreadyStored = await ChromeService.isPaperStoredInDB(paper.url);

    if (alreadyStored) {
      console.log('[PaperStorage] Paper already stored in IndexedDB');
      return true;
    }

    // NEW FLOW: Send HTML to background for offscreen extraction (fire-and-forget)
    console.log('[PaperStorage] Research paper detected ✓ Sending HTML to background for extraction...');

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

    console.log('[PaperStorage] ✓ Extraction message sent to background (processing in offscreen)');
    return true;
  } catch (error) {
    console.warn('[PaperStorage] Failed to store paper:', error);
    return false;
  }
}
