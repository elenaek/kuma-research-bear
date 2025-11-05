import { BaseAIStrategy } from './BaseAIStrategy.ts';
import { buildMetadataExtractionPrompt } from '../../../shared/prompts/templates/extraction.ts';
import { getOutputLanguage } from '../../../shared/utils/settingsService.ts';
import { JSONRepairService } from '../JSONRepairService.ts';
import { AICapabilities } from '../../../shared/types/index.ts';

/**
 * Utility: Sleep for a specified duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Strategy for extracting structured metadata from research papers using AI
 * Implements exponential backoff with max retries
 */
export class MetadataExtractionStrategy extends BaseAIStrategy {
  private extractionRetries: Map<string, number> = new Map();
  private jsonRepairService: JSONRepairService;
  private checkAvailabilityFn: () => Promise<AICapabilities>;

  constructor(
    promptExecutor: any,
    sessionManager: any,
    jsonRepairService: JSONRepairService,
    checkAvailabilityFn: () => Promise<AICapabilities>
  ) {
    super(promptExecutor, sessionManager);
    this.jsonRepairService = jsonRepairService;
    this.checkAvailabilityFn = checkAvailabilityFn;
  }

  /**
   * Extract structured paper metadata from content using AI
   * This is the core method for intelligent paper detection
   * Implements exponential backoff with max 3 retries
   */
  async extractPaperMetadata(content: string, contextId: string = 'extraction'): Promise<any> {
    // Check if AI is readily available (no user gesture needed)
    const capabilities = await this.checkAvailabilityFn();

    if (capabilities.availability !== 'available') {
      this.logDebug(`⚠️ AI extraction skipped: AI status is "${capabilities.availability}"`);

      if (capabilities.availability === 'downloadable') {
        this.logDebug('💡 Tip: Click "Initialize AI" button in the extension popup to download the AI model (one-time setup)');
      } else if (capabilities.availability === 'downloading') {
        this.logDebug('⏳ AI model is currently downloading. AI extraction will work automatically once download completes.');
      } else if (capabilities.availability === 'unavailable') {
        this.logDebug('❌ Chrome AI has crashed. Open extension popup for recovery instructions.');
      }

      return null;
    }

    const url = window.location.href;
    // Use fewer retries for large content (likely PDFs)
    const isProbablyPDF = content.length > 5000;
    const maxRetries = isProbablyPDF ? 2 : 3;
    const baseDelay = isProbablyPDF ? 5000 : 1000; // 5s for PDFs, 1s for HTML

    // Get current retry count for this URL
    const currentRetries = this.extractionRetries.get(url) || 0;

    // Hard stop after max retries
    if (currentRetries >= maxRetries) {
      this.logWarn(`AI extraction failed after ${maxRetries} attempts for ${url}`);
      this.extractionRetries.delete(url); // Reset for next time
      return null;
    }

    // If this is a retry, apply exponential backoff
    if (currentRetries > 0) {
      const delay = baseDelay * Math.pow(2, currentRetries - 1);
      this.logDebug(`Retry ${currentRetries}/${maxRetries} - waiting ${delay}ms before retry...`);
      await sleep(delay);
    }

    // Increment retry count
    this.extractionRetries.set(url, currentRetries + 1);

    // Check content length and warn if too large
    if (content.length > 10000) {
      this.logWarn(`[AI] Content is very large (${content.length} chars). Consider pre-cleaning or truncating before calling AI.`);
    }

    // Truncate content to ~2000 tokens max to stay within context limits
    const maxChars = 8000; // ~2000 tokens
    const truncatedContent = content.slice(0, maxChars);

    const systemPrompt = buildMetadataExtractionPrompt();

    const input = `Extract metadata from this research paper content and return ONLY valid JSON with this exact structure:
{
  "title": "paper title",
  "authors": ["author1", "author2"],
  "abstract": "paper abstract",
  "publishDate": "YYYY-MM-DD or null",
  "doi": "DOI string or null",
  "journal": "journal name or null",
  "venue": "conference or journal name or null",
  "keywords": ["keyword1", "keyword2"] or null,
  "arxivId": "arXiv ID or null",
  "pmid": "PubMed ID or null"
}

Content:
${truncatedContent}

Return ONLY the JSON object, no other text. Extract as much information as you can find.`;

    try {
      this.logDebug(`Attempting AI extraction (attempt ${currentRetries + 1}/${maxRetries})...`);
      const languageOutput = await getOutputLanguage();
      const response = await this.executePrompt(
        input,
        systemPrompt,
        undefined,
        contextId,
        [{ type: 'text', languages: ["en", "es", "ja"] }],
        [{ type: 'text', languages: [languageOutput || "en"] }],
        0.0,
        1
      );

      // Try to extract JSON from response
      // Sometimes the AI adds markdown code blocks
      let jsonStr = response.trim();

      // Remove markdown code blocks if present
      if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/```json\n?/g, '').replace(/```\n?/g, '');
      }

      // Parse the JSON (with AI self-fixing if needed)
      let metadata;
      try {
        // First attempt: parse directly
        metadata = JSON.parse(jsonStr);
      } catch (parseError) {
        this.logWarn('JSON parse failed, asking AI to fix...', parseError);

        try {
          // Ask AI to fix the malformed JSON
          const fixedJson = await this.jsonRepairService.fixMalformedJSON(jsonStr, contextId);

          // Remove markdown if AI added it
          let cleanedFixed = fixedJson.trim();
          if (cleanedFixed.startsWith('```')) {
            cleanedFixed = cleanedFixed.replace(/```json\n?/g, '').replace(/```\n?/g, '');
          }

          // Try parsing the fixed JSON
          metadata = JSON.parse(cleanedFixed);
          this.logDebug('✓ AI successfully fixed malformed JSON');
        } catch (fixError) {
          // Both attempts failed
          this.logError('AI could not fix malformed JSON:', fixError);
          throw parseError; // throw original error for retry logic
        }
      }

      // Validate required fields
      if (!metadata.title || !metadata.authors || !metadata.abstract) {
        throw new Error('Missing required metadata fields');
      }

      // Ensure authors is an array
      if (!Array.isArray(metadata.authors)) {
        metadata.authors = [metadata.authors];
      }

      // Success! Clear retry count
      this.extractionRetries.delete(url);
      this.logDebug('AI extraction successful!');

      // Cleanup session after successful extraction
      try {
        await this.destroySession(contextId);
      } catch (cleanupError) {
        this.logWarn(`Failed to cleanup extraction session: ${contextId}`, cleanupError);
      }

      return {
        title: metadata.title.trim(),
        authors: metadata.authors.map((a: string) => a.trim()),
        abstract: metadata.abstract.trim(),
        url: window.location.href,
        source: 'ai-extracted' as const,
        metadata: {
          publishDate: metadata.publishDate || undefined,
          doi: metadata.doi || undefined,
          journal: metadata.journal || undefined,
          venue: metadata.venue || undefined,
          keywords: metadata.keywords || undefined,
          arxivId: metadata.arxivId || undefined,
          pmid: metadata.pmid || undefined,
          extractionMethod: 'ai' as const,
          extractionTimestamp: Date.now(),
        },
      };
    } catch (error) {
      this.logError(`AI extraction attempt ${currentRetries + 1} failed:`, error);

      // If we haven't hit max retries, try again
      if (currentRetries + 1 < maxRetries) {
        this.logDebug(`Will retry with exponential backoff...`);
        return await this.extractPaperMetadata(content, contextId);
      }

      // Max retries exceeded
      this.logError(`AI extraction failed after ${maxRetries} attempts`);
      this.extractionRetries.delete(url); // Reset for next time

      // Cleanup session after failed extraction
      try {
        await this.destroySession(contextId);
      } catch (cleanupError) {
        this.logWarn(`Failed to cleanup extraction session: ${contextId}`, cleanupError);
      }

      return null;
    }
  }

  /**
   * Clear retry tracking for a specific URL or all URLs
   */
  clearRetries(url?: string): void {
    if (url) {
      this.extractionRetries.delete(url);
    } else {
      this.extractionRetries.clear();
    }
  }
}
