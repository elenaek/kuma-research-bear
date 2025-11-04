import { BaseAIStrategy } from './BaseAIStrategy.ts';
import { buildImageExplanationPrompt } from '../../../shared/prompts/templates/explanation.ts';
import { getLanguageInstruction } from '../../../shared/prompts/components/language.ts';
import { getOutputLanguage, getPersona, getPurpose, getVerbosity } from '../../../shared/utils/settingsService.ts';
import type { PromptLanguage } from '../../../shared/prompts/types.ts';
import { MultimodalCapabilities } from '../../../shared/types/index.ts';

/**
 * Strategy for explaining images from research papers using multimodal AI
 * Uses Chrome's experimental LanguageModel API with image input support
 */
export class ImageExplanationStrategy extends BaseAIStrategy {
  private checkMultimodalAvailabilityFn: () => Promise<MultimodalCapabilities>;

  constructor(
    promptExecutor: any,
    sessionManager: any,
    checkMultimodalAvailabilityFn: () => Promise<MultimodalCapabilities>
  ) {
    super(promptExecutor, sessionManager);
    this.checkMultimodalAvailabilityFn = checkMultimodalAvailabilityFn;
  }

  /**
   * Explain an image from a research paper using multimodal AI
   * @param imageBlob - The image to explain
   * @param paperTitle - Title of the paper containing the image
   * @param paperAbstract - Abstract of the paper for context
   * @param contextId - Context ID (currently unused as we create fresh session)
   * @returns Title and explanation, or null if explanation fails
   */
  async explainImage(
    imageBlob: Blob,
    paperTitle: string,
    paperAbstract: string,
    contextId: string = 'default'
  ): Promise<{ title: string; explanation: string } | null> {
    try {
      this.logDebug('[ImageExplain] Starting image explanation for paper:', paperTitle);

      // Check multimodal availability first
      const { available } = await this.checkMultimodalAvailabilityFn();
      if (!available) {
        this.logWarn('[ImageExplain] Multimodal API not available');
        return null;
      }

      // Get user's preferred output language
      const outputLanguage = await getOutputLanguage();
      this.logDebug('[ImageExplain] Using output language:', outputLanguage);

      // Import schema for structured output
      const { imageExplanationSchema } = await import('../../../shared/schemas/analysisSchemas.ts');
      const persona = await getPersona();
      const purpose = await getPurpose();
      const language = await getOutputLanguage() as PromptLanguage;
      const verbosity = await getVerbosity();

      // Create a session with image input support
      // Note: We use LanguageModel API directly here instead of SessionManager
      // because this requires special multimodal capabilities
      const session = await (globalThis as any).LanguageModel.create({
        temperature: 0.0,
        topK: 1,
        expectedInputs: [{ type: 'image', languages: ["en", "es", "ja"] }],
        expectedOutputs: [{ type: 'text', languages: [outputLanguage || "en"] }],
        systemPrompt: buildImageExplanationPrompt(persona, purpose, language, verbosity),
      });

      this.logDebug('[ImageExplain] Session created, sending image...');

      // Use append() method to send multimodal content
      await session.append([
        {
          role: 'user',
          content: [
            {
              type: 'text',
              value: `This image is from the research paper titled "${paperTitle}".

Paper abstract: ${paperAbstract}

${getLanguageInstruction(outputLanguage as PromptLanguage, 'entire').content}`,
            },
            {
              type: 'image',
              value: imageBlob,
            },
          ],
        },
      ]);

      // Build prompt based on purpose
      const explanationPrompt = purpose === 'learning'
        ? `Explain this image in plain language.
  Every sentence must be between 14-20 words.

<Explanation Format>
  ### What is shown (1-2 sentence overview of the image and its purpose.)

  ### Key takeaways of image (In 3-5 bullet points, provide a guided explanation of the key aspects of the image.)

  ### Why it matters (Describe in 1-2 sentences what is the significance of the image.)

  ### Analogy (Generate an analogy that is 1-3 sentences long to help understand the core concepts illustrated in the image.)
  </ Explanation Format>`
        : `Succinctly explain the image.

  Every sentence must be between 14-20 words.

  <Explanation Format>
  ### What it is (1 sentence overview of the visual type and its purpose.)

  ### What is shown (in 3-5 bullet points, provide a guided explanation of the image.)

  ### Why it matters (Describe in 1-2 sentences what the significance of the image is.)

  ### For your paper (Describe in 1-3 bullet points how to integrate key concepts of this visual into an essay topic.)

  ### Examples (Provide 1-2 examples of integrating key concepts of this visual into an essay topic.)

  ### Caveats (In 1-2 sentences, mention limitations, missing data, or possible bias of the image.)
</Explanation Format>

${getLanguageInstruction(outputLanguage as PromptLanguage, 'entire').content}
`;

      // Use structured output with responseConstraint
      const response = await session.prompt(explanationPrompt, {
        responseConstraint: imageExplanationSchema,
      });

      this.logDebug('[ImageExplain] Raw response:', response);

      // Parse JSON response
      const parsed = JSON.parse(response);

      this.logDebug('[ImageExplain] Explanation generated successfully');
      this.logDebug('[ImageExplain] Title:', parsed.title);

      // Cleanup
      session.destroy();

      return {
        title: parsed.title,
        explanation: parsed.explanation,
      };
    } catch (error) {
      this.logError('[ImageExplain] Error generating image explanation:', error);

      // Try to extract partial data if JSON parsing failed but we got a response
      if (error instanceof SyntaxError && typeof error === 'object') {
        this.logWarn('[ImageExplain] JSON parsing failed, using fallback');
        return {
          title: 'Image Explanation',
          explanation: 'Unable to generate explanation due to parsing error.',
        };
      }

      return null;
    }
  }
}
