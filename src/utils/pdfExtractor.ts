/**
 * PDF extraction utilities
 * Extracts text and metadata from PDF documents
 *
 * NOTE: PDF.js is lazy-loaded to avoid blocking content script initialization
 */

// Type imports only (no runtime import)
import type * as PDFJS from 'pdfjs-dist';

// Lazy load PDF.js library
let pdfjsLib: typeof PDFJS | null = null;

async function getPDFLib(): Promise<typeof PDFJS> {
  if (pdfjsLib) {
    return pdfjsLib;
  }

  try {
    // Dynamic import - only loads when actually needed
    pdfjsLib = await import('pdfjs-dist');

    // Configure PDF.js worker after loading
    // Use locally bundled worker (1MB, copied during build)
    pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('pdf.worker.min.mjs');

    console.log('[PDF Extractor] PDF.js library loaded successfully');
    console.log('[PDF Extractor] Worker URL:', pdfjsLib.GlobalWorkerOptions.workerSrc);
    return pdfjsLib;
  } catch (error) {
    console.error('[PDF Extractor] Failed to load PDF.js library:', error);
    throw new Error('Failed to load PDF.js library. PDF extraction is not available.');
  }
}

export interface PDFContent {
  text: string;
  metadata: {
    title?: string;
    author?: string;
    subject?: string;
    keywords?: string;
    creator?: string;
    producer?: string;
    creationDate?: string;
    modificationDate?: string;
  };
  pageCount: number;
}

export interface PDFExtractionProgress {
  currentPage: number;
  totalPages: number;
  percentComplete: number;
}

/**
 * Check if a URL is a valid PDF URL (not about:blank, etc.)
 */
function isValidPDFUrl(url: string): boolean {
  if (!url || url === 'about:blank' || url === 'about:srcdoc') {
    return false;
  }
  return url.startsWith('http://') || url.startsWith('https://') || url.startsWith('file://');
}

/**
 * Check if current page is showing a PDF
 */
function isPDFViewerPage(): boolean {
  const url = window.location.href.toLowerCase();
  const contentType = document.contentType || document.mimeType;

  // Check URL patterns that indicate PDFs
  if (url.endsWith('.pdf')) return true;
  if (url.includes('/pdf/')) return true; // arXiv, bioRxiv, etc.
  if (url.match(/\.pdf($|\?|#)/)) return true; // PDF with query params

  // Check MIME type
  if (contentType === 'application/pdf') return true;

  // Check for Chrome's PDF viewer indicators
  if (document.querySelector('embed[type="application/pdf"]')) return true;

  return false;
}

/**
 * Get the PDF URL from the current page
 * Handles both direct PDF views and embedded PDFs
 */
export function getPDFUrl(): string | null {
  // Direct PDF view - Chrome's PDF viewer
  // Priority 1: window.location.href if it looks like a PDF
  if (isPDFViewerPage() && isValidPDFUrl(window.location.href)) {
    console.log('[PDF Extractor] Detected direct PDF view:', window.location.href);
    return window.location.href;
  }

  // Priority 2: Embedded PDF via <embed> tag (but filter out about:blank)
  const embedElement = document.querySelector('embed[type="application/pdf"]') as HTMLEmbedElement;
  if (embedElement && embedElement.src && isValidPDFUrl(embedElement.src)) {
    console.log('[PDF Extractor] Detected embedded PDF via <embed>:', embedElement.src);
    return embedElement.src;
  }

  // Priority 3: Embedded PDF via <object> tag
  const objectElement = document.querySelector('object[type="application/pdf"]') as HTMLObjectElement;
  if (objectElement && objectElement.data && isValidPDFUrl(objectElement.data)) {
    console.log('[PDF Extractor] Detected embedded PDF via <object>:', objectElement.data);
    return objectElement.data;
  }

  // Priority 4: Embedded PDF via <iframe>
  const iframeElement = document.querySelector('iframe[src*=".pdf"]') as HTMLIFrameElement;
  if (iframeElement && iframeElement.src && isValidPDFUrl(iframeElement.src)) {
    console.log('[PDF Extractor] Detected embedded PDF via <iframe>:', iframeElement.src);
    return iframeElement.src;
  }

  console.log('[PDF Extractor] Could not detect PDF URL');
  return null;
}

/**
 * Extract metadata from PDF document
 */
async function extractPDFMetadata(pdfDocument: any): Promise<PDFContent['metadata']> {
  try {
    const metadata = await pdfDocument.getMetadata();
    const info = metadata.info || {};

    return {
      title: info.Title || undefined,
      author: info.Author || undefined,
      subject: info.Subject || undefined,
      keywords: info.Keywords || undefined,
      creator: info.Creator || undefined,
      producer: info.Producer || undefined,
      creationDate: info.CreationDate || undefined,
      modificationDate: info.ModDate || undefined,
    };
  } catch (error) {
    console.error('Error extracting PDF metadata:', error);
    return {};
  }
}

/**
 * Extract text from a single PDF page
 */
async function extractPageText(page: any): Promise<string> {
  try {
    const textContent = await page.getTextContent();
    const textItems = textContent.items;

    // Join text items with spaces
    // PDF text items might not have natural spacing, so we add spaces
    let pageText = '';
    let lastY = 0;

    for (const item of textItems) {
      // Type guard to check if item has necessary properties
      if ('str' in item && 'transform' in item) {
        const currentY = item.transform[5];

        // Add line break if we moved to a new line (Y coordinate changed significantly)
        if (lastY !== 0 && Math.abs(currentY - lastY) > 5) {
          pageText += '\n';
        }

        pageText += item.str + ' ';
        lastY = currentY;
      }
    }

    return pageText.trim();
  } catch (error) {
    console.error('Error extracting text from page:', error);
    return '';
  }
}

/**
 * Extract all text from a PDF document
 * @param pdfUrl URL of the PDF document
 * @param progressCallback Optional callback to track extraction progress
 */
export async function extractPDFText(
  pdfUrl: string,
  progressCallback?: (progress: PDFExtractionProgress) => void
): Promise<PDFContent> {
  try {
    console.log('[PDF Extractor] Loading PDF from:', pdfUrl);

    // Lazy load PDF.js library
    const pdfjs = await getPDFLib();

    // Load the PDF document
    const loadingTask = pdfjs.getDocument(pdfUrl);
    const pdfDocument = await loadingTask.promise;

    console.log('[PDF Extractor] PDF loaded, extracting content...');

    // Extract metadata
    const metadata = await extractPDFMetadata(pdfDocument);

    // Extract text from all pages
    const pageCount = pdfDocument.numPages;
    const textPages: string[] = [];

    for (let i = 1; i <= pageCount; i++) {
      // Report progress
      if (progressCallback) {
        progressCallback({
          currentPage: i,
          totalPages: pageCount,
          percentComplete: Math.round((i / pageCount) * 100),
        });
      }

      const page = await pdfDocument.getPage(i);
      const pageText = await extractPageText(page);
      textPages.push(pageText);

      console.log(`[PDF Extractor] Extracted page ${i}/${pageCount}`);
    }

    // Combine all page text with double line breaks between pages
    const fullText = textPages.join('\n\n');

    console.log('[PDF Extractor] Extraction complete!', {
      pageCount,
      textLength: fullText.length,
      wordCount: fullText.split(/\s+/).length,
    });

    return {
      text: fullText,
      metadata,
      pageCount,
    };
  } catch (error) {
    console.error('[PDF Extractor] Failed to extract PDF:', error);
    throw new Error(`Failed to extract PDF: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Extract text from specific pages of a PDF
 * Useful for extracting just the first few pages for title/abstract detection
 */
export async function extractPDFPages(
  pdfUrl: string,
  startPage: number = 1,
  endPage: number = 2
): Promise<string> {
  try {
    // Lazy load PDF.js library
    const pdfjs = await getPDFLib();

    const loadingTask = pdfjs.getDocument(pdfUrl);
    const pdfDocument = await loadingTask.promise;

    const pageCount = pdfDocument.numPages;
    const actualEndPage = Math.min(endPage, pageCount);
    const textPages: string[] = [];

    for (let i = startPage; i <= actualEndPage; i++) {
      const page = await pdfDocument.getPage(i);
      const pageText = await extractPageText(page);
      textPages.push(pageText);
    }

    return textPages.join('\n\n');
  } catch (error) {
    console.error('[PDF Extractor] Failed to extract PDF pages:', error);
    throw new Error(`Failed to extract PDF pages: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Check if PDF appears to be a scanned document (image-based, no text)
 * Returns true if the PDF has very little extractable text relative to page count
 */
export async function isScannedPDF(pdfUrl: string): Promise<boolean> {
  try {
    // Extract first 2 pages
    const firstPagesText = await extractPDFPages(pdfUrl, 1, 2);

    // If we have less than 100 characters of text across 2 pages, likely scanned
    if (firstPagesText.length < 100) {
      return true;
    }

    // Additional heuristic: very low character density
    // Lazy load PDF.js library
    const pdfjs = await getPDFLib();

    const loadingTask = pdfjs.getDocument(pdfUrl);
    const pdfDocument = await loadingTask.promise;
    const pageCount = pdfDocument.numPages;

    // Average characters per page
    const avgCharsPerPage = firstPagesText.length / Math.min(2, pageCount);

    // If less than 200 chars per page, likely scanned
    return avgCharsPerPage < 200;
  } catch (error) {
    console.error('[PDF Extractor] Error checking if PDF is scanned:', error);
    return false; // Assume not scanned if we can't check
  }
}
