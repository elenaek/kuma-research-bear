import { extractPageText, isPDFPage } from '../../utils/contentExtractor.ts';
import { getPDFUrl, extractPDFText } from '../../utils/pdfExtractor.ts';

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
      console.log('[TextExtraction] PDF detected, extracting full PDF text...');
      const pdfUrl = getPDFUrl();
      if (!pdfUrl) {
        console.error('[TextExtraction] Could not determine PDF URL');
        return '';
      }

      try {
        // Extract all text from the PDF (PDF.js is lazy-loaded here)
        const pdfContent = await extractPDFText(pdfUrl, (progress) => {
          console.log(`[TextExtraction] PDF extraction progress: ${progress.percentComplete}% (${progress.currentPage}/${progress.totalPages})`);
        });

        console.log('[TextExtraction] ✓ PDF text extracted:', {
          pageCount: pdfContent.pageCount,
          textLength: pdfContent.text.length,
          wordCount: pdfContent.text.split(/\s+/).length,
        });

        return pdfContent.text;
      } catch (pdfError) {
        console.error('[TextExtraction] Failed to extract PDF text:', pdfError);
        return '';
      }
    } else {
      // Regular HTML page
      const extracted = extractPageText();
      return extracted.text;
    }
  } catch (error) {
    console.error('[TextExtraction] Fatal error in extractFullText:', error);
    return '';
  }
}
