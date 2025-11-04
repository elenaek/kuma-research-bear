import { PromptExecutor } from '../core/PromptExecutor.ts';
import { AISessionManager } from '../core/AISessionManager.ts';
import { buildJSONRepairPrompt, buildJSONRepairInput } from '../../../shared/prompts/templates/utility.ts';
import { logger } from '../../../shared/utils/logger.ts';
import { getOutputLanguage } from '../../../shared/utils/settingsService.ts';

/**
 * JSONRepairService - Fixes malformed JSON using AI
 *
 * Responsibilities:
 * - Repair malformed JSON responses from AI
 * - Clean markdown code blocks from JSON
 * - Validate repaired JSON
 * - Handle repair failures gracefully
 *
 * Use Cases:
 * - When JSON parsing fails after AI response
 * - When AI wraps JSON in markdown code blocks
 * - When AI generates slightly malformed JSON
 */
export class JSONRepairService {
  private promptExecutor: PromptExecutor;
  private sessionManager: AISessionManager;

  constructor(sessionManager: AISessionManager, promptExecutor: PromptExecutor) {
    this.sessionManager = sessionManager;
    this.promptExecutor = promptExecutor;
  }

  /**
   * Fix malformed JSON by asking AI to correct it
   *
   * @param malformedJson - The malformed JSON string
   * @param contextId - Context identifier for the session
   * @returns Fixed JSON string (cleaned, trimmed)
   */
  async repairJSON(
    malformedJson: string,
    contextId: string = 'json-repair'
  ): Promise<string> {
    try {
      logger.debug('JSON_REPAIR', 'Attempting to repair malformed JSON');

      // Get or create session for JSON repair
      const outputLanguage = await getOutputLanguage();
      const hasSession = this.sessionManager.hasSession(contextId);

      if (!hasSession) {
        await this.sessionManager.createSession(contextId, {
          systemPrompt: buildJSONRepairPrompt(),
          expectedInputs: [{ type: 'text', languages: ['en', 'es', 'ja'] }],
          expectedOutputs: [{ type: 'text', languages: [outputLanguage || 'en'] }],
          temperature: 0.0,
          topK: 1,
        });
      }

      // Build repair input
      const input = buildJSONRepairInput(malformedJson);

      // Execute repair with timeout
      const response = await this.promptExecutor.executeWithTimeout(
        contextId,
        input,
        {
          timeoutMs: 30000, // 30 seconds for JSON repair
          maxRetries: 2,
          retryDelayMs: 500,
          recreateSessionOnTimeout: true,
        }
      );

      // Clean the response
      const cleaned = this.cleanJSONResponse(response);

      logger.debug('JSON_REPAIR', '✓ JSON repair successful');
      return cleaned;
    } catch (error) {
      logger.error('JSON_REPAIR', 'Failed to repair malformed JSON:', error);
      throw error;
    }
  }

  /**
   * Clean JSON response by removing markdown code blocks
   *
   * @param response - Raw response from AI
   * @returns Cleaned JSON string
   */
  private cleanJSONResponse(response: string): string {
    let cleaned = response.trim();

    // Remove markdown code blocks if present
    if (cleaned.startsWith('```')) {
      cleaned = cleaned
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();
    }

    return cleaned;
  }

  /**
   * Attempt to repair and parse JSON in one operation
   *
   * @param malformedJson - The malformed JSON string
   * @param contextId - Context identifier for the session
   * @returns Parsed JSON object
   */
  async repairAndParse<T = any>(
    malformedJson: string,
    contextId: string = 'json-repair'
  ): Promise<T> {
    const repaired = await this.repairJSON(malformedJson, contextId);

    try {
      return JSON.parse(repaired);
    } catch (parseError) {
      logger.error('JSON_REPAIR', 'Repaired JSON still cannot be parsed:', parseError);
      throw new Error('Repaired JSON is still malformed');
    }
  }

  /**
   * Try parsing JSON, repair if needed
   *
   * @param jsonString - JSON string to parse
   * @param contextId - Context identifier for the session
   * @returns Parsed JSON object
   */
  async parseWithRepair<T = any>(
    jsonString: string,
    contextId: string = 'json-repair'
  ): Promise<T> {
    try {
      // First attempt: parse directly
      return JSON.parse(jsonString);
    } catch (parseError) {
      logger.warn('JSON_REPAIR', 'JSON parse failed, attempting repair...', parseError);

      // Second attempt: ask AI to fix
      try {
        return await this.repairAndParse<T>(jsonString, contextId);
      } catch (repairError) {
        logger.error('JSON_REPAIR', 'AI repair failed:', repairError);
        // Throw original parse error for clarity
        throw parseError;
      }
    }
  }
}
