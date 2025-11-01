/**
 * InputQuota Service
 * Detects and caches the user's Gemini Nano inputQuota for adaptive chunking and RAG
 * Uses Chrome Built-in AI API (LanguageModel.create() -> session.inputQuota)
 */

import { getOutputLanguage } from "./settingsService.ts";
import { logger } from './logger.ts';

/**
 * Singleton service for managing inputQuota detection and adaptive sizing
 */
class InputQuotaService {
  private inputQuota: number | null = null;
  private readonly FALLBACK_QUOTA = 1024; // Conservative fallback (1024 tokens = 4096 chars)

  /**
   * Initialize the service by detecting inputQuota from a temporary session
   * Should be called once on extension startup
   */
  async initialize(): Promise<void> {
    try {
      logger.debug('PERFORMANCE', 'Detecting inputQuota from LanguageModel session...');

      // Check if LanguageModel is available
      if (typeof LanguageModel === 'undefined') {
        logger.warn('PERFORMANCE', 'LanguageModel API not available, using fallback');
        this.inputQuota = this.FALLBACK_QUOTA;
        return;
      }

      // Create temporary session to detect quota
      const outputLanguage = await getOutputLanguage();
      const tempSession = await LanguageModel.create({
        expectedInputs: [{ type: 'text', languages: ["en", "es", "ja"] }],
        expectedOutputs: [{ type: 'text', languages: [outputLanguage || "en"] }], // Default for quota detection
      });
      this.inputQuota = tempSession.inputQuota;

      // Clean up temporary session
      tempSession.destroy();

      logger.debug('PERFORMANCE', `✓ Detected inputQuota: ${this.inputQuota} tokens`);
    } catch (error) {
      logger.error('PERFORMANCE', 'Failed to detect inputQuota:', error);
      this.inputQuota = this.FALLBACK_QUOTA;
      logger.debug('PERFORMANCE', `Using fallback: ${this.inputQuota} tokens`);
    }
  }

  /**
   * Get the detected inputQuota (in tokens)
   * Initializes if not already done
   */
  async getInputQuota(): Promise<number> {
    if (this.inputQuota === null) {
      await this.initialize();
    }
    return this.inputQuota || this.FALLBACK_QUOTA;
  }

  /**
   * Get the maximum chunk size in characters (safety limit for large paragraphs)
   * Formula: Ensures at least 2 chunks can fit with worst-case overhead
   * - Worst-case: chat with history (800 tokens) + response buffer (500 tokens)
   * - Guarantees minimum 2 chunks can fit regardless of use case
   * - Scales automatically with user's hardware/quota
   */
  async getMaxChunkSize(): Promise<number> {
    const quota = await this.getInputQuota();

    // Worst-case overhead: chat with history
    const maxPromptTokens = 800;  // System + summary + history
    const responseBuffer = 500;   // Reserve for LLM response
    const minChunksToFit = 2;     // Guarantee at least 2 chunks

    const availableForChunks = quota - maxPromptTokens - responseBuffer;
    const maxChunkTokens = Math.floor(availableForChunks / minChunksToFit);
    const maxChunkChars = maxChunkTokens * 4;

    logger.debug('PERFORMANCE', `Max chunk size: ${maxChunkChars} chars (${maxChunkTokens} tokens) for quota ${quota}`);
    return maxChunkChars;
  }

  /**
   * Calculate optimal number of RAG chunks to retrieve based on use case
   * Ensures chunks + prompt + response fit within inputQuota
   *
   * @param useCase - The type of query (chat, qa, analysis, definition)
   * @param avgChunkSize - Average chunk size from paper metadata (optional, defaults to 500 chars)
   * @returns Optimal number of chunks to retrieve (clamped between 2-8)
   */
  async getOptimalRAGChunkCount(
    useCase: 'chat' | 'qa' | 'analysis' | 'definition',
    avgChunkSize?: number
  ): Promise<number> {
    const quota = await this.getInputQuota();

    // Estimated prompt sizes for different use cases (in tokens)
    const promptEstimates = {
      chat: 800,       // System (250) + Summary (300) + Recent messages (200) + overhead (50)
      qa: 350,         // System prompt + question
      analysis: 300,   // Analysis-specific prompt
      definition: 250  // Definition lookup prompt
    };

    const estimatedPromptTokens = promptEstimates[useCase];
    const responseBuffer = 500; // Reserve tokens for LLM response

    // Use actual average chunk size from paper, or fallback to 500 chars
    const avgChunkChars = avgChunkSize || 500;
    const avgChunkTokens = Math.ceil(avgChunkChars / 4);

    // Calculate available tokens for chunks
    const availableTokens = quota - estimatedPromptTokens - responseBuffer;

    // Calculate optimal chunk count based on actual average chunk size
    const optimalCount = Math.floor(availableTokens / avgChunkTokens);

    // Clamp to reasonable bounds (min 2, max 8)
    const clampedCount = Math.max(2, Math.min(8, optimalCount));

    logger.debug('PERFORMANCE', `Optimal RAG chunks for ${useCase}: ${clampedCount} (avgChunkSize: ${avgChunkChars} chars, quota: ${quota}, available: ${availableTokens})`);

    return clampedCount;
  }

  /**
   * Calculate minimum quota required for paper analysis
   * Dynamically calculates based on hierarchical summary size
   *
   * @param hierarchicalSummarySize - Size of the hierarchical summary in characters
   * @returns Minimum quota needed for full analysis with reasonable RAG context
   */
  async getMinimumAnalysisQuota(hierarchicalSummarySize: number): Promise<{
    minimumQuota: number;
    breakdown: {
      hierarchicalSummary: number;
      perSectionOverhead: number;
      perSectionRAG: number;
      responseBuffer: number;
      totalPerSection: number;
      totalAllSections: number;
      safetyMargin: number;
    };
  }> {
    // Convert hierarchical summary chars to tokens (rough: 1 token = 4 chars)
    const summaryTokens = Math.ceil(hierarchicalSummarySize / 4);

    // Per-section overhead (system prompt + input formatting + structured output overhead)
    // Analysis uses structured JSON schemas which add ~100-150 tokens overhead
    const systemPromptTokens = 150;
    const inputFormattingTokens = 50;
    const schemaOverheadTokens = 100;
    const perSectionOverhead = systemPromptTokens + inputFormattingTokens + schemaOverheadTokens;

    // Estimated RAG context per section (minimum 2 chunks, ~125 tokens each)
    const minChunksPerSection = 2;
    const avgChunkTokens = 125;
    const perSectionRAG = minChunksPerSection * avgChunkTokens;

    // Response buffer per section (conservative: 400 tokens for structured output)
    const responseBufferPerSection = 400;

    // Total per section = summary + overhead + RAG + response
    const totalPerSection = summaryTokens + perSectionOverhead + perSectionRAG + responseBufferPerSection;

    // Total for all 4 sections (methodology, confounders, implications, limitations)
    const numSections = 4;
    const totalAllSections = totalPerSection * numSections;

    // Add 20% safety margin for unexpected overhead
    const safetyMargin = Math.ceil(totalAllSections * 0.2);
    const minimumQuota = totalAllSections + safetyMargin;

    logger.debug('PERFORMANCE', `Minimum analysis quota: ${minimumQuota} tokens (summary: ${summaryTokens}, per-section: ${totalPerSection}, sections: ${numSections})`);

    return {
      minimumQuota,
      breakdown: {
        hierarchicalSummary: summaryTokens,
        perSectionOverhead,
        perSectionRAG,
        responseBuffer: responseBufferPerSection,
        totalPerSection,
        totalAllSections,
        safetyMargin,
      },
    };
  }

  /**
   * Get detailed quota info for debugging
   */
  async getQuotaInfo(): Promise<{
    inputQuota: number;
    maxChunkSize: number;
    ragChunkCounts: {
      chat: number;
      qa: number;
      analysis: number;
      definition: number;
    };
  }> {
    const inputQuota = await this.getInputQuota();
    const maxChunkSize = await this.getMaxChunkSize();

    return {
      inputQuota,
      maxChunkSize,
      ragChunkCounts: {
        chat: await this.getOptimalRAGChunkCount('chat'),
        qa: await this.getOptimalRAGChunkCount('qa'),
        analysis: await this.getOptimalRAGChunkCount('analysis'),
        definition: await this.getOptimalRAGChunkCount('definition'),
      },
    };
  }

  /**
   * Reset the service (useful for testing or re-detection)
   */
  reset(): void {
    this.inputQuota = null;
  }
}

// Export singleton instance
export const inputQuotaService = new InputQuotaService();
