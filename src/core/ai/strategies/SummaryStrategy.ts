import { SummaryResult } from '../../../shared/types/index.ts';
import { BaseAIStrategy } from './BaseAIStrategy.ts';
import { buildSummaryPrompt } from '../../../shared/prompts/templates/summary.ts';
import { getPersona, getPurpose } from '../../../shared/utils/settingsService.ts';

/**
 * Strategy for generating research paper summaries
 * Uses Prompt API to create brief summaries and key points
 * Note: Summarizer API integration is handled separately in aiService for backward compatibility
 */
export class SummaryStrategy extends BaseAIStrategy {
  /**
   * Generate a summary of a paper using Prompt API
   * Optionally uses hierarchical summary to capture entire paper (not just abstract)
   */
  async generateSummary(
    title: string,
    abstract: string,
    contextId: string = 'default',
    hierarchicalSummary?: string
  ): Promise<SummaryResult> {
    const persona = await getPersona();
    const purpose = await getPurpose();
    const systemPrompt = buildSummaryPrompt(persona, purpose);

    // If hierarchical summary is provided, use it for comprehensive summary
    let input: string;
    if (hierarchicalSummary) {
      this.logDebug('[Summary] Using hierarchical summary for comprehensive key points');
      input = `Create a brief summary and list 3-5 key points from this paper.
Use the full paper summary below to ensure your key points reflect the entire study (methodology, results, conclusions), not just the abstract.

Title: ${title}

FULL PAPER SUMMARY:
${hierarchicalSummary}

ABSTRACT:
${abstract}

Format your response as:
SUMMARY: [2-3 sentence summary with **bold** for key concepts]
KEY POINTS:
- [point 1]
- [point 2]
- [point 3]

Include key findings and conclusions from the full paper, not just the introduction.`;
    } else {
      this.logDebug('[Summary] Using abstract only (standard approach)');
      input = `Create a brief summary and list 3-5 key points from this paper.
Use markdown formatting for better readability (bold for key terms, etc.):

Title: ${title}

Abstract: ${abstract}

Format your response as:
SUMMARY: [2-3 sentence summary with **bold** for key concepts]
KEY POINTS:
- [point 1]
- [point 2]
- [point 3]`;
    }

    try {
      const response = await this.executePrompt(input, systemPrompt, undefined, contextId, undefined, undefined, 0.0, 1);

      // Parse the response
      const summaryMatch = response.match(/SUMMARY:\s*(.+?)(?=KEY POINTS:|$)/s);
      const keyPointsMatch = response.match(/KEY POINTS:\s*(.+)/s);

      const summary = summaryMatch ? summaryMatch[1].trim() : response;
      const keyPoints = keyPointsMatch
        ? keyPointsMatch[1]
            .split('\n')
            .filter(line => line.trim().startsWith('-'))
            .map(line => line.replace(/^-\s*/, '').trim())
        : [];

      this.logDebug('[Summary] ✓ Successfully generated summary with Prompt API');
      return {
        summary,
        keyPoints: keyPoints.length > 0 ? keyPoints : ['No key points extracted'],
        timestamp: Date.now(),
        generatedBy: 'prompt-api'
      };
    } finally {
      // Cleanup session after summary operation
      try {
        await this.destroySession(contextId);
      } catch (cleanupError) {
        this.logWarn(`Failed to cleanup summary session: ${contextId}`, cleanupError);
      }
    }
  }
}
