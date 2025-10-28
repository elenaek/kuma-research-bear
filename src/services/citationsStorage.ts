import { Citation, CitationFormat, CitationsStore } from '../types/index.ts';
import { initDB, CITATIONS_STORE, CITATIONS_SETTINGS_STORE } from '../utils/dbService.ts';

const SETTINGS_ID = 'global-settings';
const DEFAULT_FORMAT: CitationFormat = 'apa';

/**
 * Generate unique ID for a citation
 */
export function generateCitationId(): string {
  return `citation_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Add a new citation
 */
export async function addCitation(citation: Citation): Promise<Citation> {
  const db = await initDB();

  try {
    const transaction = db.transaction([CITATIONS_STORE], 'readwrite');
    const store = transaction.objectStore(CITATIONS_STORE);

    // Ensure citation has an ID
    if (!citation.id) {
      citation.id = generateCitationId();
    }

    // Ensure addedAt timestamp exists
    if (!citation.addedAt) {
      citation.addedAt = Date.now();
    }

    await new Promise<void>((resolve, reject) => {
      const request = store.add(citation);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(new Error('Failed to add citation'));
    });

    console.log('✓ Citation added:', citation.id);
    db.close();
    return citation;
  } catch (error) {
    db.close();
    console.error('Error adding citation:', error);
    throw error;
  }
}

/**
 * Get a single citation by ID
 */
export async function getCitation(id: string): Promise<Citation | null> {
  const db = await initDB();

  try {
    const transaction = db.transaction([CITATIONS_STORE], 'readonly');
    const store = transaction.objectStore(CITATIONS_STORE);

    const citation = await new Promise<Citation | null>((resolve, reject) => {
      const request = store.get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(new Error('Failed to get citation'));
    });

    db.close();
    return citation;
  } catch (error) {
    db.close();
    console.error('Error getting citation:', error);
    return null;
  }
}

/**
 * Get all citations, sorted by custom order or alphabetically by author
 */
export async function getAllCitations(): Promise<Citation[]> {
  const db = await initDB();

  try {
    const transaction = db.transaction([CITATIONS_STORE], 'readonly');
    const store = transaction.objectStore(CITATIONS_STORE);

    const citations = await new Promise<Citation[]>((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(new Error('Failed to get citations'));
    });

    db.close();

    // Sort citations
    return sortCitations(citations);
  } catch (error) {
    db.close();
    console.error('Error getting all citations:', error);
    return [];
  }
}

/**
 * Get citations for a specific paper
 */
export async function getCitationsForPaper(paperId: string): Promise<Citation[]> {
  const db = await initDB();

  try {
    const transaction = db.transaction([CITATIONS_STORE], 'readonly');
    const store = transaction.objectStore(CITATIONS_STORE);
    const index = store.index('paperId');

    const citations = await new Promise<Citation[]>((resolve, reject) => {
      const request = index.getAll(paperId);
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(new Error('Failed to get citations for paper'));
    });

    db.close();
    return sortCitations(citations);
  } catch (error) {
    db.close();
    console.error('Error getting citations for paper:', error);
    return [];
  }
}

/**
 * Update an existing citation
 */
export async function updateCitation(citation: Citation): Promise<Citation> {
  const db = await initDB();

  try {
    const transaction = db.transaction([CITATIONS_STORE], 'readwrite');
    const store = transaction.objectStore(CITATIONS_STORE);

    await new Promise<void>((resolve, reject) => {
      const request = store.put(citation);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(new Error('Failed to update citation'));
    });

    console.log('✓ Citation updated:', citation.id);
    db.close();
    return citation;
  } catch (error) {
    db.close();
    console.error('Error updating citation:', error);
    throw error;
  }
}

/**
 * Delete a citation
 */
export async function deleteCitation(id: string): Promise<void> {
  const db = await initDB();

  try {
    const transaction = db.transaction([CITATIONS_STORE], 'readwrite');
    const store = transaction.objectStore(CITATIONS_STORE);

    await new Promise<void>((resolve, reject) => {
      const request = store.delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(new Error('Failed to delete citation'));
    });

    console.log('✓ Citation deleted:', id);
    db.close();
  } catch (error) {
    db.close();
    console.error('Error deleting citation:', error);
    throw error;
  }
}

/**
 * Update the order of multiple citations
 */
export async function updateCitationsOrder(citationIds: string[]): Promise<void> {
  const db = await initDB();

  try {
    const transaction = db.transaction([CITATIONS_STORE], 'readwrite');
    const store = transaction.objectStore(CITATIONS_STORE);

    // Assign customOrder to each citation based on position in array
    for (let i = 0; i < citationIds.length; i++) {
      const citation = await new Promise<Citation>((resolve, reject) => {
        const request = store.get(citationIds[i]);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(new Error('Failed to get citation for order update'));
      });

      if (citation) {
        citation.customOrder = i;
        await new Promise<void>((resolve, reject) => {
          const request = store.put(citation);
          request.onsuccess = () => resolve();
          request.onerror = () => reject(new Error('Failed to update citation order'));
        });
      }
    }

    console.log('✓ Citation order updated');
    db.close();
  } catch (error) {
    db.close();
    console.error('Error updating citation order:', error);
    throw error;
  }
}

/**
 * Reset custom order (return to alphabetical)
 */
export async function resetCitationsOrder(): Promise<void> {
  const db = await initDB();

  try {
    const transaction = db.transaction([CITATIONS_STORE], 'readwrite');
    const store = transaction.objectStore(CITATIONS_STORE);

    const citations = await new Promise<Citation[]>((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(new Error('Failed to get citations'));
    });

    // Remove customOrder from all citations
    for (const citation of citations) {
      if (citation.customOrder !== undefined) {
        delete citation.customOrder;
        await new Promise<void>((resolve, reject) => {
          const request = store.put(citation);
          request.onsuccess = () => resolve();
          request.onerror = () => reject(new Error('Failed to reset citation order'));
        });
      }
    }

    console.log('✓ Citation order reset to alphabetical');
    db.close();
  } catch (error) {
    db.close();
    console.error('Error resetting citation order:', error);
    throw error;
  }
}

/**
 * Get the selected citation format
 */
export async function getSelectedFormat(): Promise<CitationFormat> {
  const db = await initDB();

  try {
    const transaction = db.transaction([CITATIONS_SETTINGS_STORE], 'readonly');
    const store = transaction.objectStore(CITATIONS_SETTINGS_STORE);

    const settings = await new Promise<{ id: string; selectedFormat: CitationFormat } | null>((resolve, reject) => {
      const request = store.get(SETTINGS_ID);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(new Error('Failed to get citation format'));
    });

    db.close();
    return settings?.selectedFormat || DEFAULT_FORMAT;
  } catch (error) {
    db.close();
    console.error('Error getting selected format:', error);
    return DEFAULT_FORMAT;
  }
}

/**
 * Set the selected citation format
 */
export async function setSelectedFormat(format: CitationFormat): Promise<void> {
  const db = await initDB();

  try {
    const transaction = db.transaction([CITATIONS_SETTINGS_STORE], 'readwrite');
    const store = transaction.objectStore(CITATIONS_SETTINGS_STORE);

    await new Promise<void>((resolve, reject) => {
      const request = store.put({ id: SETTINGS_ID, selectedFormat: format });
      request.onsuccess = () => resolve();
      request.onerror = () => reject(new Error('Failed to set citation format'));
    });

    console.log('✓ Citation format set to:', format);
    db.close();
  } catch (error) {
    db.close();
    console.error('Error setting citation format:', error);
    throw error;
  }
}

/**
 * Get citation count
 */
export async function getCitationCount(): Promise<number> {
  const db = await initDB();

  try {
    const transaction = db.transaction([CITATIONS_STORE], 'readonly');
    const store = transaction.objectStore(CITATIONS_STORE);

    const count = await new Promise<number>((resolve, reject) => {
      const request = store.count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error('Failed to count citations'));
    });

    db.close();
    return count;
  } catch (error) {
    db.close();
    console.error('Error counting citations:', error);
    return 0;
  }
}

/**
 * Delete all citations for a specific paper
 */
export async function deleteCitationsForPaper(paperId: string): Promise<number> {
  const citations = await getCitationsForPaper(paperId);

  for (const citation of citations) {
    await deleteCitation(citation.id);
  }

  return citations.length;
}

/**
 * Sort citations by custom order first, then alphabetically by first author
 */
function sortCitations(citations: Citation[]): Citation[] {
  return citations.sort((a, b) => {
    // If both have custom order, sort by that
    if (a.customOrder !== undefined && b.customOrder !== undefined) {
      return a.customOrder - b.customOrder;
    }

    // If only one has custom order, it comes first
    if (a.customOrder !== undefined) return -1;
    if (b.customOrder !== undefined) return 1;

    // Otherwise, sort alphabetically by first author's last name
    const aAuthor = getLastName(a.authors[0] || '');
    const bAuthor = getLastName(b.authors[0] || '');

    return aAuthor.localeCompare(bAuthor);
  });
}

/**
 * Extract last name from author string
 * Handles formats: "John Smith", "Smith, John", "Smith"
 */
function getLastName(authorName: string): string {
  if (!authorName) return '';

  // If contains comma, assume "LastName, FirstName" format
  if (authorName.includes(',')) {
    return authorName.split(',')[0].trim();
  }

  // Otherwise, assume "FirstName LastName" format
  const parts = authorName.trim().split(' ');
  return parts[parts.length - 1] || '';
}
