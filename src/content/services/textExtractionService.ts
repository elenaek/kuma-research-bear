import { extractPageText, isPDFPage } from '../../shared/utils/contentExtractor.ts';
import { getPDFUrl, extractPDFText } from '../../shared/utils/pdfExtractor.ts';
import { logger } from '../../shared/utils/logger.ts';

/**
 * Text Extraction Service
 * Handles extraction of full text from HTML pages and PDFs
 */

/**
 * Extract full text from the current page (HTML or PDF)
 */
export async function extractFullText(): Promise<string> {
  try {
    // Check if this is a PDF page
    if (isPDFPage()) {
      logger.debug('CONTENT_SCRIPT', '[TextExtraction] PDF detected, extracting full PDF text...');
      const pdfUrl = getPDFUrl();
      if (!pdfUrl) {
        logger.error('CONTENT_SCRIPT', '[TextExtraction] Could not determine PDF URL');
        return '';
      }

      try {
        // Extract all text from the PDF (PDF.js is lazy-loaded here)
        const pdfContent = await extractPDFText(pdfUrl, (progress) => {
          logger.debug('PDF_EXTRACTION', `PDF extraction progress: ${progress.percentComplete}% (${progress.currentPage}/${progress.totalPages})`);
        });

        logger.debug('CONTENT_SCRIPT', '[TextExtraction] ✓ PDF text extracted:', {
          pageCount: pdfContent.pageCount,
          textLength: pdfContent.text.length,
          wordCount: pdfContent.text.split(/\s+/).length,
        });

        return pdfContent.text;
      } catch (pdfError) {
        logger.error('CONTENT_SCRIPT', '[TextExtraction] Failed to extract PDF text:', pdfError);
        return '';
      }
    } else {
      // Regular HTML page
      const extracted = extractPageText();
      return extracted.text;
    }
  } catch (error) {
    logger.error('CONTENT_SCRIPT', '[TextExtraction] Fatal error in extractFullText:', error);
    return '';
  }
}
