/**
 * Request Deduplication Service
 * Manages active request tracking to prevent duplicate concurrent operations
 */

// Active request tracking for deduplication
// Key format: "tabId-operation-paperUrl" or "tabId-operation"
const activeRequests = new Map<string, Promise<any>>();

/**
 * Generate a unique request key for deduplication
 * @param tabId - Tab ID (or undefined for default)
 * @param operation - Operation name (e.g., 'analyze', 'glossary')
 * @param paperUrl - Optional paper URL for paper-specific operations
 * @returns Unique request key string
 */
export function getRequestKey(tabId: number | undefined, operation: string, paperUrl?: string): string {
  const tabKey = tabId || 'default';
  return paperUrl ? `${tabKey}-${operation}-${paperUrl}` : `${tabKey}-${operation}`;
}

/**
 * Check if an active request exists for the given key
 */
export function hasRequest(key: string): boolean {
  return activeRequests.has(key);
}

/**
 * Get an existing active request promise
 * @returns The promise if it exists, undefined otherwise
 */
export function getRequest<T = any>(key: string): Promise<T> | undefined {
  return activeRequests.get(key);
}

/**
 * Store an active request promise for deduplication
 */
export function setRequest(key: string, promise: Promise<any>): void {
  activeRequests.set(key, promise);
}

/**
 * Delete an active request by key
 */
export function deleteRequest(key: string): void {
  activeRequests.delete(key);
}

/**
 * Delete all active requests for a specific tab
 * @param tabId - Tab ID to clean up
 * @returns Array of deleted request keys
 */
export function deleteRequestsByTab(tabId: number): string[] {
  const requestsToDelete: string[] = [];

  for (const [key] of activeRequests) {
    if (key.startsWith(`${tabId}-`) || key.startsWith(`tab-${tabId}-`)) {
      requestsToDelete.push(key);
    }
  }

  for (const key of requestsToDelete) {
    activeRequests.delete(key);
  }

  return requestsToDelete;
}

/**
 * Get all active request keys (for debugging/inspection)
 */
export function getAllRequestKeys(): string[] {
  return Array.from(activeRequests.keys());
}

/**
 * Get all request keys for a specific paper URL
 * @param paperUrl - Paper URL to find requests for
 * @returns Array of request keys that include this paper URL
 */
export function getRequestsByUrl(paperUrl: string): string[] {
  const matchingKeys: string[] = [];

  for (const [key] of activeRequests) {
    // Check if this request key includes the paper URL
    // Format: "tabId-operation-paperUrl"
    if (key.endsWith(`-${paperUrl}`)) {
      matchingKeys.push(key);
    }
  }

  return matchingKeys;
}

/**
 * Delete all active requests for a specific paper URL
 * @param paperUrl - Paper URL to clean up
 * @returns Array of deleted request keys
 */
export function deleteRequestsByUrl(paperUrl: string): string[] {
  const requestsToDelete = getRequestsByUrl(paperUrl);

  for (const key of requestsToDelete) {
    activeRequests.delete(key);
  }

  return requestsToDelete;
}

/**
 * Clear all active requests
 */
export function clearAllRequests(): void {
  activeRequests.clear();
}
