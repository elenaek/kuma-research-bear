import { Citation } from '../../types/index.ts';
import { addCitation, getAllCitations, deleteCitation } from '../../services/citationsStorage.ts';

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
    console.log('[CitationHandlers] Adding citation to global store:', citation.paperTitle);

    // Store citation in background's IndexedDB
    const storedCitation = await addCitation(citation);

    console.log('[CitationHandlers] ✓ Citation stored successfully:', storedCitation.id);

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
    console.error('[CitationHandlers] Error adding citation:', error);
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
    console.log('[CitationHandlers] Fetching all citations from global store');

    const citations = await getAllCitations();

    console.log('[CitationHandlers] ✓ Retrieved', citations.length, 'citations');

    return {
      success: true,
      citations,
    };
  } catch (error) {
    console.error('[CitationHandlers] Error getting citations:', error);
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
    console.log('[CitationHandlers] Deleting citation:', citationId);

    await deleteCitation(citationId);

    console.log('[CitationHandlers] ✓ Citation deleted successfully');

    // Broadcast to all extension contexts
    chrome.runtime.sendMessage({
      type: 'CITATION_DELETED',
      citationId,
    });

    return {
      success: true,
    };
  } catch (error) {
    console.error('[CitationHandlers] Error deleting citation:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
