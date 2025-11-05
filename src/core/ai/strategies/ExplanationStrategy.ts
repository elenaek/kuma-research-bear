import { ExplanationResult } from '../../../shared/types/index.ts';
import { BaseAIStrategy } from './BaseAIStrategy.ts';
import { buildExplainAbstractPrompt } from '../../../shared/prompts/templates/explanation.ts';
import { getLanguageName } from '../../../shared/prompts/components/language.ts';
import { getOutputLanguage, getPersona, getPurpose } from '../../../shared/utils/settingsService.ts';

/**
 * Strategy for explaining research paper abstracts in simple terms
 * Can use hierarchical summary for more comprehensive explanations
 */
export class ExplanationStrategy extends BaseAIStrategy {
  /**
   * Explain a research paper abstract in simple terms
   * Optionally uses hierarchical summary for comprehensive explanation of large papers
   */
  async explainAbstract(
    abstract: string,
    contextId: string = 'default',
    hierarchicalSummary?: string
  ): Promise<ExplanationResult> {
    // Get user's preferred output language
    const outputLanguage = await getOutputLanguage();
    const persona = await getPersona();
    const purpose = await getPurpose();
    this.logDebug('[ExplainAbstract] Output language:', outputLanguage);

    const systemPrompt = buildExplainAbstractPrompt(outputLanguage as 'en' | 'es' | 'ja', persona, purpose);
    const languageName = getLanguageName(outputLanguage as 'en' | 'es' | 'ja');

    // If hierarchical summary is provided, use it for richer context
    let input: string;
    if (hierarchicalSummary) {
      this.logDebug('[Explain] Using hierarchical summary for comprehensive explanation');
      input = `IMPORTANT: You must respond entirely in ${languageName}. Do not use any other language.

Please explain this research paper in simple terms that anyone can understand.
Use the full paper summary below to provide a comprehensive explanation that covers the entire study, not just the abstract.

<OUTPUT FORMAT BEGIN>
### What is the main problem or research question being addressed?
- Answer
### Why is this problem important?
- Answer
### What is the proposed solution, method or model?
- Answer
### What are the key assumptions or premises of the approach?
- Answer
### What are the paper's main findings or results?
- Answer
### How can I use this information in my own life, studies, work or research?
- Answer

**Fields/Subject Areas:**
- Field(s) or subfields this paper belongs in

</OUTPUT FORMAT END>

FULL PAPER SUMMARY:
${hierarchicalSummary}

ABSTRACT:
${abstract}

Use markdown formatting for better readability:
- Use **bold** for important concepts or key terms
- Use bullet points or numbered lists where appropriate
- Use *italic* for emphasis
- Keep paragraphs concise
- Cover the key findings, methodology, and conclusions from the full paper
`;
    } else {
      this.logDebug('[Explain] Using abstract only (standard approach)');
      input = `IMPORTANT: You must respond entirely in ${languageName}. Do not use any other language.

Please explain this research paper abstract in simple terms that anyone can understand.
Use markdown formatting for better readability:
- Use **bold** for important concepts or key terms
- Use bullet points or numbered lists where appropriate
- Use *italic* for emphasis
- Keep paragraphs concise

<OUTPUT FORMAT BEGIN>
### What is the main problem or research question being addressed?
- Answer
### Why is this problem important?
- Answer
### What is the proposed solution, method or model?
- Answer
### What are the key assumptions or premises of the approach?
- Answer
### What are the paper's main findings or results?
- Answer
### How can I use this information in my own life, studies, work or research?
- Answer

**Fields/Subject Areas:**
- Field(s) or subfields this paper belongs in

</OUTPUT FORMAT END>

Abstract:
${abstract}`;
    }

    // Include language in context ID to ensure separate sessions per language
    const languageContextId = `${contextId}-${outputLanguage}`;

    try {
      const explanation = await this.executePrompt(
        input,
        systemPrompt,
        undefined,
        languageContextId,
        [{ type: "text", languages: ["en", "es", "ja"] }],  // expectedInputs
        [{ type: "text", languages: [outputLanguage || "en"] }],  // expectedOutputs
        0.0,
        1
      );

      return {
        originalText: abstract,
        explanation,
        timestamp: Date.now(),
      };
    } finally {
      // Cleanup session after explanation operation
      try {
        await this.destroySession(languageContextId);
      } catch (cleanupError) {
        this.logWarn(`Failed to cleanup explanation session: ${languageContextId}`, cleanupError);
      }
    }
  }
}
