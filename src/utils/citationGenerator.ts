import { Citation, StoredPaper } from '../types/index.ts';
import { aiService } from './aiService.ts';
import { generateCitationId } from '../services/citationsStorage.ts';
import { extractPageNumber } from './pageNumberExtractor.ts';
import { logger } from './logger.ts';

/**
 * Citation Generator - Hybrid approach
 *
 * Orchestrates citation generation using:
 * 1. Deterministic formatting when metadata is complete
 * 2. AI enhancement when metadata is missing
 * 3. Page number extraction from PDF viewers
 */

/**
 * Check if paper has complete metadata for citations
 */
function hasCompleteMetadata(paper: StoredPaper): boolean {
  const hasPublishDate = !!paper.metadata?.publishDate;
  const hasJournalOrVenue = !!(paper.metadata?.journal || paper.metadata?.venue);

  return hasPublishDate && hasJournalOrVenue;
}

/**
 * Generate a citation from selected text
 *
 * @param selectedText - The quoted text from the paper
 * @param paper - The paper being cited
 * @param sectionName - The section where the quote appears (e.g., "Introduction", "Methods")
 * @returns Complete citation object ready for storage
 */
export async function generateCitation(
  selectedText: string,
  paper: StoredPaper,
  sectionName?: string
): Promise<Citation> {
  logger.debug('UTILS', '[Citation Generator] Generating citation for:', paper.title);

  // Step 1: Extract page number (if available from PDF viewer)
  let pageNumber: string | number | undefined;
  try {
    pageNumber = extractPageNumber();
    logger.debug('UTILS', '[Citation Generator] Page number:', pageNumber || 'Not available (using section name)');
  } catch (error) {
    logger.debug('UTILS', '[Citation Generator] Could not extract page number, will use section name');
  }

  // Use section name if no page number available
  if (!pageNumber && sectionName) {
    pageNumber = sectionName;
  }

  // Step 2: Check if metadata enhancement is needed
  let enhancedMetadata = paper.metadata || {};
  const needsEnhancement = !hasCompleteMetadata(paper);

  if (needsEnhancement && !paper.metadata?.metadataEnhanced) {
    logger.debug('UTILS', '[Citation Generator] Metadata incomplete, attempting AI enhancement...');

    try {
      const enhanced = await aiService.enhanceMetadataForCitation(paper);

      if (enhanced) {
        enhancedMetadata = {
          ...enhancedMetadata,
          ...enhanced,
        };
        logger.debug('UTILS', '[Citation Generator] ✓ Metadata enhanced successfully');
      } else {
        logger.debug('UTILS', '[Citation Generator] AI enhancement returned no results, using existing metadata');
      }
    } catch (error) {
      logger.error('UTILS', '[Citation Generator] Error during AI enhancement:', error);
      logger.debug('UTILS', '[Citation Generator] Proceeding with existing metadata');
    }
  } else if (paper.metadata?.metadataEnhanced) {
    logger.debug('UTILS', '[Citation Generator] Metadata already enhanced, skipping AI call');
  } else {
    logger.debug('UTILS', '[Citation Generator] Metadata complete, no enhancement needed');
  }

  // Step 3: Build citation object
  const citation: Citation = {
    id: generateCitationId(),
    paperId: paper.id,
    paperTitle: paper.title,
    authors: paper.authors || ['Unknown Author'],
    publishDate: enhancedMetadata.publishDate,
    journal: enhancedMetadata.journal,
    venue: enhancedMetadata.venue,
    doi: enhancedMetadata.doi,
    url: paper.url,
    source: paper.source,
    selectedText: selectedText.trim(),
    pageNumber,
    section: sectionName,
    addedAt: Date.now(),
  };

  logger.debug('UTILS', '[Citation Generator] ✓ Citation generated:', {
    id: citation.id,
    title: citation.paperTitle,
    hasPageNumber: !!citation.pageNumber,
    hasPublishDate: !!citation.publishDate,
    hasJournal: !!citation.journal,
  });

  return citation;
}

/**
 * Batch generate citations for multiple quotes from the same paper
 * More efficient than calling generateCitation multiple times (metadata enhanced once)
 */
export async function generateCitationsBatch(
  quotes: Array<{ text: string; section?: string; pageNumber?: string | number }>,
  paper: StoredPaper
): Promise<Citation[]> {
  logger.debug('UTILS', '[Citation Generator] Batch generating', quotes.length, 'citations');

  // Enhance metadata once if needed
  let enhancedMetadata = paper.metadata || {};
  const needsEnhancement = !hasCompleteMetadata(paper);

  if (needsEnhancement && !paper.metadata?.metadataEnhanced) {
    logger.debug('UTILS', '[Citation Generator] Enhancing metadata for batch...');

    try {
      const enhanced = await aiService.enhanceMetadataForCitation(paper);

      if (enhanced) {
        enhancedMetadata = {
          ...enhancedMetadata,
          ...enhanced,
        };
      }
    } catch (error) {
      logger.error('UTILS', '[Citation Generator] Error during batch enhancement:', error);
    }
  }

  // Generate citations
  const citations: Citation[] = [];

  for (const quote of quotes) {
    const citation: Citation = {
      id: generateCitationId(),
      paperId: paper.id,
      paperTitle: paper.title,
      authors: paper.authors || ['Unknown Author'],
      publishDate: enhancedMetadata.publishDate,
      journal: enhancedMetadata.journal,
      venue: enhancedMetadata.venue,
      doi: enhancedMetadata.doi,
      url: paper.url,
      source: paper.source,
      selectedText: quote.text.trim(),
      pageNumber: quote.pageNumber || quote.section,
      section: quote.section,
      addedAt: Date.now(),
    };

    citations.push(citation);
  }

  logger.debug('UTILS', '[Citation Generator] ✓ Batch complete:', citations.length, 'citations generated');

  return citations;
}

/**
 * Update paper metadata with enhanced metadata (persist to storage)
 * Call this after generating a citation to save the enhanced metadata for future use
 */
export function shouldUpdatePaperMetadata(paper: StoredPaper): boolean {
  return !paper.metadata?.metadataEnhanced;
}
