/**
 * Offscreen Document Service
 * Manages the lifecycle of the offscreen document for embedding generation
 */

import { MessageType } from '../../types/index.ts';

const OFFSCREEN_DOCUMENT_PATH = '/src/offscreen/offscreen.html';
let creating: Promise<void> | null = null;

/**
 * Setup offscreen document if it doesn't exist
 * Ensures only one offscreen document exists at a time
 */
export async function setupOffscreenDocument(): Promise<void> {
  const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH);

  // Check if offscreen document already exists
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [offscreenUrl]
  });

  if (existingContexts.length > 0) {
    return;
  }

  // Avoid multiple simultaneous creation attempts
  if (creating) {
    await creating;
    return;
  }

  // Create offscreen document
  creating = chrome.offscreen.createDocument({
    url: OFFSCREEN_DOCUMENT_PATH,
    reasons: [chrome.offscreen.Reason.DOM_SCRAPING], // Need DOM for Transformers.js
    justification: 'Generate embeddings using Transformers.js which requires DOM access',
  });

  await creating;
  creating = null;
}

/**
 * Close offscreen document
 */
export async function closeOffscreenDocument(): Promise<void> {
  try {
    await chrome.offscreen.closeDocument();
    console.log('[Offscreen] Document closed');
  } catch (error) {
    console.log('[Offscreen] No document to close or already closed');
  }
}

/**
 * Generate embeddings for a paper using the offscreen document
 */
export async function generateEmbeddingsOffscreen(paperId: string): Promise<{ success: boolean; count?: number; error?: string }> {
  try {
    // Ensure offscreen document exists
    await setupOffscreenDocument();

    // Send message to offscreen document
    const response = await chrome.runtime.sendMessage({
      type: MessageType.GENERATE_EMBEDDINGS,
      payload: { paperId }
    });

    if (response.success) {
      console.log('[Offscreen] ✓ Generated', response.count, 'embeddings');
      return { success: true, count: response.count };
    } else {
      return { success: false, error: response.error };
    }
  } catch (error) {
    console.error('[Offscreen] Error generating embeddings:', error);
    return { success: false, error: String(error) };
  }
}

/**
 * Perform semantic search using the offscreen document
 * Returns ranked chunk IDs based on cosine similarity
 */
export async function searchSemanticOffscreen(
  paperId: string,
  query: string,
  limit: number = 5
): Promise<{ success: boolean; chunkIds?: string[]; error?: string }> {
  try {
    // Ensure offscreen document exists
    await setupOffscreenDocument();

    // Send message to offscreen document
    const response = await chrome.runtime.sendMessage({
      type: MessageType.SEMANTIC_SEARCH,
      payload: { paperId, query, limit }
    });

    if (response.success && response.chunkIds) {
      return { success: true, chunkIds: response.chunkIds };
    } else {
      return { success: false, chunkIds: [], error: response.error };
    }
  } catch (error) {
    console.error('[Offscreen] Error in semantic search:', error);
    return { success: false, chunkIds: [], error: String(error) };
  }
}

