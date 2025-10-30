import { Citation } from '../../types/index.ts';
import { addCitation, getAllCitations, deleteCitation } from '../../services/citationsStorage.ts';
import { logger } from '../../utils/logger.ts';

/**
 * Citation Message Handlers
 * Handles citation operations centralized in the background worker
 * Citations are stored in background's IndexedDB to be global across all tabs
 */

/**
 * Add a citation to the global citations store
 */
export async function handleAddCitation(payload: any): Promise<any> {
  try {
    const citation: Citation = payload.citation;
    logger.debug('BACKGROUND_SCRIPT', '[CitationHandlers] Adding citation to global store:', citation.paperTitle);

    // Store citation in background's IndexedDB
    const storedCitation = await addCitation(citation);

    logger.debug('BACKGROUND_SCRIPT', '[CitationHandlers] ✓ Citation stored successfully:', storedCitation.id);

    // Broadcast to all extension contexts (sidepanel, popup, etc.)
    chrome.runtime.sendMessage({
      type: 'CITATION_ADDED',
      citationId: storedCitation.id,
    });

    return {
      success: true,
      citationId: storedCitation.id,
    };
  } catch (error) {
    logger.error('BACKGROUND_SCRIPT', '[CitationHandlers] Error adding citation:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Get all citations from the global store
 */
export async function handleGetAllCitations(): Promise<any> {
  try {
    logger.debug('BACKGROUND_SCRIPT', '[CitationHandlers] Fetching all citations from global store');

    const citations = await getAllCitations();

    logger.debug('BACKGROUND_SCRIPT', '[CitationHandlers] ✓ Retrieved', citations.length, 'citations');

    return {
      success: true,
      citations,
    };
  } catch (error) {
    logger.error('BACKGROUND_SCRIPT', '[CitationHandlers] Error getting citations:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      citations: [],
    };
  }
}

/**
 * Delete a citation from the global store
 */
export async function handleDeleteCitation(payload: any): Promise<any> {
  try {
    const citationId: string = payload.citationId;
    logger.debug('BACKGROUND_SCRIPT', '[CitationHandlers] Deleting citation:', citationId);

    await deleteCitation(citationId);

    logger.debug('BACKGROUND_SCRIPT', '[CitationHandlers] ✓ Citation deleted successfully');

    // Broadcast to all extension contexts
    chrome.runtime.sendMessage({
      type: 'CITATION_DELETED',
      citationId,
    });

    return {
      success: true,
    };
  } catch (error) {
    logger.error('BACKGROUND_SCRIPT', '[CitationHandlers] Error deleting citation:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
