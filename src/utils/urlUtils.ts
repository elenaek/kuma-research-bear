/**
 * URL Utilities
 *
 * Provides URL normalization and manipulation utilities
 * to ensure consistent URL handling across the extension.
 */

import { logger } from './logger.ts';

/**
 * Decode percent-encoded unreserved characters
 * Per RFC 3986, unreserved characters are: A-Z a-z 0-9 - . _ ~
 * These characters should not be percent-encoded
 */
function decodeUnreservedChars(str: string): string {
  // Match percent-encoded characters
  return str.replace(/%([0-9A-Fa-f]{2})/g, (match, hex) => {
    const charCode = parseInt(hex, 16);
    const char = String.fromCharCode(charCode);

    // Check if it's an unreserved character
    // A-Z (65-90), a-z (97-122), 0-9 (48-57), - (45), . (46), _ (95), ~ (126)
    if (
      (charCode >= 65 && charCode <= 90) ||   // A-Z
      (charCode >= 97 && charCode <= 122) ||  // a-z
      (charCode >= 48 && charCode <= 57) ||   // 0-9
      charCode === 45 ||                       // -
      charCode === 46 ||                       // .
      charCode === 95 ||                       // _
      charCode === 126                         // ~
    ) {
      return char; // Decode unreserved character
    }

    return match; // Keep reserved characters encoded
  });
}

/**
 * Normalize a URL for consistent comparison and storage
 *
 * Applies RFC 3986 compliant normalizations:
 * 1. Removes URL fragments (everything after and including #)
 * 2. Lowercases scheme and domain (case-insensitive per spec)
 * 3. Removes trailing slashes from paths (except root /)
 * 4. Removes default ports (:443 for https, :80 for http)
 * 5. Decodes percent-encoded unreserved characters
 *
 * Does NOT normalize (to preserve semantic meaning):
 * - Query parameters (order/presence matters for versioning)
 * - www prefix (some sites serve different content)
 * - Protocol (http vs https may serve different content)
 *
 * @param url - The URL to normalize
 * @returns The normalized URL
 *
 * @example
 * normalizeUrl('HTTPS://ArXiv.Org/abs/1234.5678/#introduction')
 * // Returns: 'https://arxiv.org/abs/1234.5678'
 *
 * @example
 * normalizeUrl('https://arxiv.org/abs/1234.5678/')
 * // Returns: 'https://arxiv.org/abs/1234.5678'
 *
 * @example
 * normalizeUrl('https://example.com:443/paper%20name')
 * // Returns: 'https://example.com/paper name'
 */
export function normalizeUrl(url: string): string {
  if (!url) return url;

  try {
    // Parse URL using URL API for robust handling
    const urlObj = new URL(url);

    // 1. Remove fragment/hash
    urlObj.hash = '';

    // 2. Lowercase scheme and hostname
    urlObj.protocol = urlObj.protocol.toLowerCase();
    urlObj.hostname = urlObj.hostname.toLowerCase();

    // 3. Remove trailing slash from pathname (except for root path)
    if (urlObj.pathname !== '/' && urlObj.pathname.endsWith('/')) {
      urlObj.pathname = urlObj.pathname.slice(0, -1);
    }

    // 4. Remove default ports
    if (
      (urlObj.protocol === 'https:' && urlObj.port === '443') ||
      (urlObj.protocol === 'http:' && urlObj.port === '80')
    ) {
      urlObj.port = '';
    }

    // 5. Decode unreserved characters in pathname and search
    urlObj.pathname = decodeUnreservedChars(urlObj.pathname);
    if (urlObj.search) {
      urlObj.search = decodeUnreservedChars(urlObj.search);
    }

    // Reconstruct URL without fragment (hash was cleared above)
    return urlObj.href;
  } catch (error) {
    // If URL parsing fails, fall back to simple fragment removal
    logger.warn('GENERAL', 'Failed to parse URL, using fallback normalization:', url, error);
    const hashIndex = url.indexOf('#');
    return hashIndex !== -1 ? url.substring(0, hashIndex) : url;
  }
}
