/**
 * Page Number Extractor
 *
 * Extracts the current page number from PDF viewers and web pages
 * Supports:
 * - PDF.js (Firefox, Chrome PDF viewer)
 * - Browser-native PDF viewers
 * - ArXiv HTML viewer
 */

import { logger } from './logger.ts';

/**
 * Extract page number from current page/PDF
 * Returns page number as string or number, or undefined if not available
 */
export function extractPageNumber(): string | number | undefined {
  // Try PDF.js first (most common)
  const pdfJsPage = extractFromPDFJS();
  if (pdfJsPage) {
    return pdfJsPage;
  }

  // Try Chrome/Edge native PDF viewer
  const nativePage = extractFromNativePDFViewer();
  if (nativePage) {
    return nativePage;
  }

  // Try arXiv HTML viewer
  const arxivPage = extractFromArXivHTML();
  if (arxivPage) {
    return arxivPage;
  }

  // No page number available
  return undefined;
}

/**
 * Extract page number from PDF.js viewer
 * PDF.js exposes PDFViewerApplication global object
 */
function extractFromPDFJS(): number | undefined {
  try {
    // Check if PDFViewerApplication exists (PDF.js)
    const pdfViewer = (window as any).PDFViewerApplication;

    if (pdfViewer && pdfViewer.pdfViewer) {
      // Get current page number
      const currentPage = pdfViewer.pdfViewer.currentPageNumber;

      if (typeof currentPage === 'number' && currentPage > 0) {
        logger.debug('PDF_EXTRACTION', 'PDF.js page:', currentPage);
        return currentPage;
      }
    }

    // Alternative: Check for PDF.js page input element
    const pageInput = document.querySelector('#pageNumber') as HTMLInputElement;
    if (pageInput && pageInput.value) {
      const page = parseInt(pageInput.value, 10);
      if (!isNaN(page) && page > 0) {
        logger.debug('PDF_EXTRACTION', 'PDF.js page from input:', page);
        return page;
      }
    }
  } catch (error) {
    logger.error('PDF_EXTRACTION', 'PDF.js not found or error:', error);
  }

  return undefined;
}

/**
 * Extract page number from Chrome/Edge native PDF viewer
 * Uses the page indicator in the toolbar
 */
function extractFromNativePDFViewer(): number | undefined {
  try {
    // Look for Chrome PDF viewer page indicator
    // Format: "Page 5 of 10" or "5 / 10"
    const toolbarSelectors = [
      '.textLayer', // Chrome PDF plugin
      '#toolbar', // Alternative
      '[role="toolbar"]', // Generic toolbar
    ];

    for (const selector of toolbarSelectors) {
      const toolbar = document.querySelector(selector);
      if (toolbar) {
        const text = toolbar.textContent || '';

        // Try pattern: "Page X of Y"
        let match = text.match(/Page\s+(\d+)\s+of\s+\d+/i);
        if (match) {
          const page = parseInt(match[1], 10);
          logger.debug('PDF_EXTRACTION', 'Native PDF viewer page:', page);
          return page;
        }

        // Try pattern: "X / Y"
        match = text.match(/(\d+)\s*\/\s*\d+/);
        if (match) {
          const page = parseInt(match[1], 10);
          logger.debug('PDF_EXTRACTION', 'Native PDF viewer page (alt):', page);
          return page;
        }
      }
    }

    // Check URL hash for page number (e.g., #page=5)
    const hashMatch = window.location.hash.match(/#page=(\d+)/);
    if (hashMatch) {
      const page = parseInt(hashMatch[1], 10);
      logger.debug('PDF_EXTRACTION', 'Page from URL hash:', page);
      return page;
    }
  } catch (error) {
    logger.error('PDF_EXTRACTION', 'Native PDF viewer error:', error);
  }

  return undefined;
}

/**
 * Extract page number from arXiv HTML viewer
 * arXiv HTML has page anchors like <a name="page-5"></a>
 */
function extractFromArXivHTML(): number | undefined {
  try {
    // Check if this is arXiv
    if (!window.location.href.includes('arxiv.org')) {
      return undefined;
    }

    // Find the page anchor closest to the current scroll position
    const pageAnchors = document.querySelectorAll('a[name^="page-"]');

    if (pageAnchors.length === 0) {
      return undefined;
    }

    // Get current scroll position
    const scrollY = window.scrollY || document.documentElement.scrollTop;

    // Find the page anchor that's closest to current scroll position (above it)
    let currentPage = 1;
    let minDistance = Infinity;

    pageAnchors.forEach((anchor) => {
      const rect = anchor.getBoundingClientRect();
      const anchorY = rect.top + scrollY;

      // Find closest anchor above current position
      if (anchorY <= scrollY + 100) {
        // +100px buffer
        const distance = scrollY - anchorY;
        if (distance < minDistance) {
          minDistance = distance;

          // Extract page number from anchor name (e.g., "page-5")
          const match = anchor.getAttribute('name')?.match(/page-(\d+)/);
          if (match) {
            currentPage = parseInt(match[1], 10);
          }
        }
      }
    });

    if (currentPage > 0) {
      logger.debug('PDF_EXTRACTION', 'arXiv HTML page:', currentPage);
      return currentPage;
    }
  } catch (error) {
    logger.error('PDF_EXTRACTION', 'arXiv HTML error:', error);
  }

  return undefined;
}

/**
 * Check if current page is a PDF
 */
export function isPDFPage(): boolean {
  // Check for PDF.js
  if ((window as any).PDFViewerApplication) {
    return true;
  }

  // Check for PDF mime type in URL
  if (window.location.href.endsWith('.pdf')) {
    return true;
  }

  // Check for PDF viewer indicators
  if (document.querySelector('#viewer.pdfViewer') || document.querySelector('.page[data-page-number]')) {
    return true;
  }

  return false;
}

/**
 * Get page count if available
 */
export function getTotalPages(): number | undefined {
  try {
    // PDF.js
    const pdfViewer = (window as any).PDFViewerApplication;
    if (pdfViewer && pdfViewer.pdfDocument) {
      return pdfViewer.pdfDocument.numPages;
    }

    // Page indicator "X of Y"
    const toolbar = document.body.textContent || '';
    const match = toolbar.match(/of\s+(\d+)/i);
    if (match) {
      return parseInt(match[1], 10);
    }
  } catch (error) {
    logger.error('PDF_EXTRACTION', 'Error getting total pages:', error);
  }

  return undefined;
}
