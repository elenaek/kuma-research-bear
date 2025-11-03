import {
  AICapabilities,
  AILanguageModelSession,
  AISessionOptions,
  ExplanationResult,
  SummaryResult,
  AIAvailability,
  SummarizerCapabilities,
  MultimodalCapabilities,
  PaperAnalysisResult,
  MethodologyAnalysis,
  ConfounderAnalysis,
  ImplicationAnalysis,
  LimitationAnalysis,
  QuestionAnswer,
  GlossaryResult,
  GlossaryTerm,
  StudyContext,
  ChatMessage,
  SessionMetadata,
  ConversationState
} from '../types/index.ts';
import { JSONSchema } from '../utils/typeToSchema.ts';
import { getSchemaForLanguage } from '../schemas/analysisSchemas.multilang.ts';
import { getOutputLanguage, getPersona, getPurpose, getVerbosity } from './settingsService.ts';
import { getOptimalRAGChunkCount } from './adaptiveRAGService.ts';
import { logger } from './logger.ts';
import { buildSimplifyTextPrompt } from '../prompts/templates/simplification.ts';
import { buildExplainTermPrompt, buildExplainAbstractPrompt, buildImageExplanationPrompt } from '../prompts/templates/explanation.ts';
import { buildSummaryPrompt } from '../prompts/templates/summary.ts';
import { buildMetadataExtractionPrompt } from '../prompts/templates/extraction.ts';
import { buildMethodologyAnalysisPrompt, buildConfounderAnalysisPrompt, buildImplicationAnalysisPrompt, buildLimitationAnalysisPrompt } from '../prompts/templates/analysis.ts';
import { buildQAPrompt } from '../prompts/templates/qa.ts';
import { buildJSONRepairPrompt, buildJSONRepairInput } from '../prompts/templates/utility.ts';
import { buildExtractTermsPrompt, buildExtractChunkTermsPrompt, buildDefinitionPrompt, buildDeduplicateTermsPrompt } from '../prompts/templates/glossary.ts';
import { getLanguageName, getLanguageInstruction } from '../prompts/components/language.ts';
import { getVerbosity } from '../utils/settingsService.ts';
import type { PromptLanguage } from '../prompts/types.ts';

/**
 * Utility: Sleep for a specified duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Chrome AI Service for interacting with Chrome's built-in AI APIs
 * Uses the stable Prompt API (Chrome 138+)
 * Supports concurrent sessions for multiple tabs/contexts
 */
class ChromeAIService {
  // Multiple sessions support - one per context (tab)
  private sessions: Map<string, AILanguageModelSession> = new Map();
  private sessionMetadata: Map<string, SessionMetadata> = new Map(); // Track token usage per session
  private activeRequests: Map<string, AbortController> = new Map(); // Track active requests
  private capabilities: AICapabilities | null = null;
  private extractionRetries: Map<string, number> = new Map(); // Track retries per URL

  // Token estimation constant: ~500 chars average / 4 chars per token = 125 tokens
  private readonly ESTIMATED_TOKENS_PER_CHUNK = 125;

  // Validation safety threshold: match summarization threshold at 80% to prevent quota exceeded errors
  // This ensures sufficient buffer for Chrome AI streaming overhead
  private readonly VALIDATION_SAFETY_THRESHOLD = 0.80;

  /**
   * Check if Chrome Prompt API is available
   */
  async checkAvailability(): Promise<AICapabilities> {
    try {
      // Check if LanguageModel global is available
      if (typeof LanguageModel === 'undefined') {
        return {
          available: false,
          availability: 'no',
          model: 'Gemini Nano',
        };
      }

      const availability: AIAvailability = await LanguageModel.availability();

      // Try to get params, but don't crash if it fails
      let params = null;
      try {
        params = await LanguageModel.params();
      } catch (paramsError) {
        logger.warn('AI_SERVICE', 'Could not fetch AI params:', paramsError);
      }

      this.capabilities = {
        available: availability === 'available',
        availability,
        model: 'Gemini Nano',
        defaultTemperature: params?.temperature?.default,
        defaultTopK: params?.topK?.default,
        maxTopK: params?.topK?.max,
      };

      return this.capabilities;
    } catch (error) {
      logger.error('AI_SERVICE', 'Error checking AI availability:', error);
      return {
        available: false,
        availability: 'no',
        model: 'Gemini Nano',
      };
    }
  }

  /**
   * Check if Chrome Summarizer API is available
   */
  async checkSummarizerAvailability(): Promise<SummarizerCapabilities> {
    try {
      // Check if Summarizer global is available
      if (typeof Summarizer === 'undefined') {
        logger.debug('AI_SERVICE', '[Summarizer] API not available (typeof Summarizer === undefined)');
        return {
          available: false,
          availability: 'no',
          model: 'Gemini Nano',
        };
      }

      const availability: AIAvailability = await Summarizer.availability();
      logger.debug('AI_SERVICE', '[Summarizer] API availability:', availability);

      return {
        available: availability === 'available',
        availability,
        model: 'Gemini Nano',
      };
    } catch (error) {
      logger.error('AI_SERVICE', '[Summarizer] Error checking availability:', error);
      return {
        available: false,
        availability: 'no',
        model: 'Gemini Nano',
      };
    }
  }

  /**
   * Check if Chrome Language Detector API is available
   */
  async checkLanguageDetectorAvailability(): Promise<{ available: boolean; availability: AIAvailability }> {
    try {
      // Check if LanguageDetector global is available
      if (typeof LanguageDetector === 'undefined') {
        logger.debug('AI_SERVICE', '[LanguageDetector] API not available (typeof LanguageDetector === undefined)');
        return {
          available: false,
          availability: 'no',
        };
      }

      const availability: AIAvailability = await LanguageDetector.availability();
      logger.debug('AI_SERVICE', '[LanguageDetector] API availability:', availability);

      return {
        available: availability === 'available',
        availability,
      };
    } catch (error) {
      logger.error('AI_SERVICE', '[LanguageDetector] Error checking availability:', error);
      return {
        available: false,
        availability: 'no',
      };
    }
  }

  /**
   * Check if Chrome Multimodal API (image support) is available
   */
  async checkMultimodalAvailability(): Promise<MultimodalCapabilities> {
    try {
      // Check if LanguageModel global is available
      if (typeof LanguageModel === 'undefined') {
        logger.debug('AI_SERVICE', '[Multimodal] API not available (typeof LanguageModel === undefined)');
        return {
          available: false,
          availability: 'no',
          model: 'Gemini Nano',
          supportsImages: false,
        };
      }

      const availability: AIAvailability = await LanguageModel.availability();
      logger.debug('AI_SERVICE', '[Multimodal] API availability:', availability);

      // Multimodal capabilities are only available in origin trial
      // We need to try creating a session with image inputs to check support
      const outputLanguage = await getOutputLanguage();
      let supportsImages = false;
      if (availability === 'available') {
        try {
          const testSession = await LanguageModel.create({
            expectedInputs: [{ type: 'image', languages: ["en", "es", "ja"] }],
            expectedOutputs: [{ type: 'text', languages: [outputLanguage || "en" ] }], // Default for test session
          });
          supportsImages = true;
          testSession.destroy();
          logger.debug('AI_SERVICE', '[Multimodal] Image input support confirmed');
        } catch (error) {
          logger.debug('AI_SERVICE', '[Multimodal] Image input not supported:', error);
          supportsImages = false;
        }
      }

      return {
        available: availability === 'available' && supportsImages,
        availability,
        model: 'Gemini Nano',
        supportsImages,
      };
    } catch (error) {
      logger.error('AI_SERVICE', '[Multimodal] Error checking availability:', error);
      return {
        available: false,
        availability: 'no',
        model: 'Gemini Nano',
        supportsImages: false,
      };
    }
  }

  /**
   * Generate an explanation for an image in the context of a research paper
   * Uses the Prompt API's multimodal capabilities with structured output
   * @returns Object with title and explanation, or null if generation fails
   */
  async explainImage(
    imageBlob: Blob,
    paperTitle: string,
    paperAbstract: string,
    contextId: string = 'default'
  ): Promise<{ title: string; explanation: string } | null> {
    try {
      logger.debug('AI_SERVICE', '[ImageExplain] Starting image explanation for paper:', paperTitle);

      // Check multimodal availability first
      const { available } = await this.checkMultimodalAvailability();
      if (!available) {
        logger.warn('AI_SERVICE', '[ImageExplain] Multimodal API not available');
        return null;
      }

      // Get user's preferred output language
      const outputLanguage = await getOutputLanguage();
      logger.debug('AI_SERVICE', '[ImageExplain] Using output language:', outputLanguage);

      // Import schema for structured output
      const { imageExplanationSchema } = await import('../schemas/analysisSchemas.ts');
      const persona = await getPersona();
      const purpose = await getPurpose();
      const language = await getOutputLanguage() as PromptLanguage;
      const verbosity = await getVerbosity();

      // Create a session with image input support
      const session = await LanguageModel.create({
        temperature: 0.0,
        topK: 3,
        expectedInputs: [{ type: 'image', languages: ["en", "es", "ja"] }],
        expectedOutputs: [{ type: 'text', languages: [outputLanguage || "en"] }], // Use user's preferred language
        systemPrompt: buildImageExplanationPrompt(persona, purpose, language, verbosity),
      });

      logger.debug('AI_SERVICE', '[ImageExplain] Session created, sending image...');


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

      // Use structured output with responseConstraint
      const response = await session.prompt(`
${purpose === 'learning' ? `Explain this image in plain language.
  Every sentence must be between 14-20 words.

<Explanation Format>
  ### What is shown (1-2 sentence overview of the image and its purpose.)

  ### Key takeaways of image (In 3-5 bullet points, provide a guided explanation of the key aspects of the image.)

  ### Why it matters (Describe in 1-2 sentences what is the significance of the image.)

  ### Analogy (Generate an analogy that is 1-3 sentences long to help understand the core concepts illustrated in the image.)
  </ Explanation Format>` 
  : 
  `Succinctly explain the image.

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
`
}`, {
        responseConstraint: imageExplanationSchema,
      });

      logger.debug('AI_SERVICE', '[ImageExplain] Raw response:', response);

      // Parse JSON response
      const parsed = JSON.parse(response);

      logger.debug('AI_SERVICE', '[ImageExplain] Explanation generated successfully');
      logger.debug('AI_SERVICE', '[ImageExplain] Title:', parsed.title);

      // Cleanup
      session.destroy();

      return {
        title: parsed.title,
        explanation: parsed.explanation,
      };
    } catch (error) {
      logger.error('AI_SERVICE', '[ImageExplain] Error generating image explanation:', error);

      // Try to extract partial data if JSON parsing failed but we got a response
      if (error instanceof SyntaxError && typeof error === 'object') {
        logger.warn('AI_SERVICE', '[ImageExplain] JSON parsing failed, using fallback');
        return {
          title: 'Image Explanation',
          explanation: 'Unable to generate explanation due to parsing error.',
        };
      }

      return null;
    }
  }

  /**
   * Detect the language of a text using Chrome's Language Detector API
   * @param text Text to detect language from (title, abstract, etc.)
   * @returns ISO 639-1 language code (e.g., 'en', 'es', 'fr') or null if detection fails
   */
  async detectLanguage(text: string): Promise<string | null> {
    try {
      if (!text || text.trim().length === 0) {
        logger.warn('AI_SERVICE', '[LanguageDetector] Empty text provided');
        return null;
      }

      // Check availability first
      const { available } = await this.checkLanguageDetectorAvailability();
      if (!available) {
        logger.warn('AI_SERVICE', '[LanguageDetector] API not available, falling back to "en"');
        return 'en'; // Default to English if detector unavailable
      }

      logger.debug('AI_SERVICE', '[LanguageDetector] Detecting language for text (length:', text.length, ')');

      // Create detector and detect language
      const detector = await LanguageDetector.create();
      const results = await detector.detect(text);

      // Cleanup detector
      detector.destroy();

      // Get the most confident result
      if (results && results.length > 0) {
        const topResult = results[0];
        logger.debug('AI_SERVICE', '[LanguageDetector] Detected language:', topResult.detectedLanguage,
                    'with confidence:', topResult.confidence);
        return topResult.detectedLanguage;
      }

      logger.warn('AI_SERVICE', '[LanguageDetector] No language detected, falling back to "en"');
      return 'en';
    } catch (error) {
      logger.error('AI_SERVICE', '[LanguageDetector] Error detecting language:', error);
      return 'en'; // Default to English on error
    }
  }

  /**
   * Create a summarizer session with specified options
   */
  async createSummarizer(options: SummarizerOptions): Promise<AISummarizer | null> {
    try {
      if (typeof Summarizer === 'undefined') {
        logger.error('AI_SERVICE', '[Summarizer] API not available');
        return null;
      }

      logger.debug('AI_SERVICE', '[Summarizer] Creating summarizer with options:', options);
      const summarizer = await Summarizer.create(options);
      logger.debug('AI_SERVICE', '[Summarizer] Summarizer created successfully');
      return summarizer;
    } catch (error) {
      logger.error('AI_SERVICE', '[Summarizer] Error creating summarizer:', error);
      return null;
    }
  }

  /**
   * Generate summary using Chrome Summarizer API
   * Creates both tldr (medium) and key-points (long) summaries
   */
  async generateSummaryWithSummarizer(
    title: string,
    abstract: string,
    contextId: string = 'default'
  ): Promise<SummaryResult | null> {
    try {
      logger.debug('AI_SERVICE', '[Summarizer] Starting summary generation for:', title);

      // Get user's preferred output language
      const outputLanguage = await getOutputLanguage();
      logger.debug('AI_SERVICE', '[Summarizer] Using output language:', outputLanguage);

      const verbosityToSummarizer = (verbosity: number) => {
        switch (verbosity) {
          case 1:
          case 2:
            return 'short';
          case 3:
          case 4:
            return 'medium';
          case 5:
            return 'long';
          default:
        }
      }

      // Create tldr summarizer for quick summary
      const tldrSummarizer = await this.createSummarizer({
        type: 'tldr',
        format: 'markdown',
        length: verbosityToSummarizer(await getVerbosity()),
        sharedContext: `Research paper: ${title}`,
        expectedInputLanguages: ['en'],
        outputLanguage: outputLanguage
      });

      if (!tldrSummarizer) {
        logger.warn('AI_SERVICE', '[Summarizer] Failed to create tldr summarizer');
        return null;
      }

      // Create key-points summarizer for key points
      const keyPointsSummarizer = await this.createSummarizer({
        type: 'key-points',
        format: 'markdown',
        length: verbosityToSummarizer(await getVerbosity()),
        sharedContext: `Research paper: ${title}`,
        expectedInputLanguages: ['en'],
        outputLanguage: outputLanguage
      });

      if (!keyPointsSummarizer) {
        logger.warn('AI_SERVICE', '[Summarizer] Failed to create key-points summarizer');
        tldrSummarizer.destroy();
        return null;
      }

      // Generate both summaries in parallel
      logger.debug('AI_SERVICE', '[Summarizer] Generating summaries...');
      const [tldrResult, keyPointsResult] = await Promise.all([
        tldrSummarizer.summarize(abstract, { context: title }),
        keyPointsSummarizer.summarize(abstract, { context: title })
      ]);

      logger.debug('AI_SERVICE', '[Summarizer] tldr result:', tldrResult);
      logger.debug('AI_SERVICE', '[Summarizer] key-points result:', keyPointsResult);

      // Clean up summarizers
      tldrSummarizer.destroy();
      keyPointsSummarizer.destroy();

      // Parse key points from markdown bullet list
      const keyPoints = keyPointsResult
        .split('\n')
        .filter(line => line.trim().startsWith('-') || line.trim().startsWith('*'))
        .map(line => line.replace(/^[-*]\s*/, '').trim())
        .filter(point => point.length > 0);

      logger.debug('AI_SERVICE', '[Summarizer] ✓ Summary generated successfully using Summarizer API');
      logger.debug('AI_SERVICE', '[Summarizer] Summary:', tldrResult);
      logger.debug('AI_SERVICE', '[Summarizer] Key points:', keyPoints);

      return {
        summary: tldrResult,
        keyPoints: keyPoints.length > 0 ? keyPoints : ['No key points extracted'],
        timestamp: Date.now(),
        generatedBy: 'summarizer-api'
      };
    } catch (error) {
      logger.error('AI_SERVICE', '[Summarizer] Error generating summary:', error);
      return null;
    }
  }

  /**
   * Get or create a session for a specific context (tab)
   * Creates a fresh session for each operation
   * Converts deprecated systemPrompt to initialPrompts format
   */
  async getOrCreateSession(
    contextId: string,
    options?: AISessionOptions,
    onDownloadProgress?: (progress: number) => void
  ): Promise<AILanguageModelSession> {
    // Always create a new session - simpler and more reliable
    try {
      if (typeof LanguageModel === 'undefined') {
        throw new Error('Prompt API not available');
      }

      logger.debug('AI_SERVICE', `[AI] Creating new session for context: ${contextId}`);

      // Convert systemPrompt to initialPrompts if present (new API format)
      let sessionOptions: any = options || {};
      if (options?.systemPrompt) {
        sessionOptions = {
          ...options,
          initialPrompts: [
            {
              role: 'system',
              content: options.systemPrompt
            }
          ]
        };
        // Remove deprecated systemPrompt field
        delete sessionOptions.systemPrompt;
      }

      // Add expectedOutputs if not already specified
      if (!sessionOptions?.expectedOutputs) {
        let outputLanguage = 'en'; // Default fallback
        try {
          outputLanguage = await getOutputLanguage();
        } catch (error) {
          logger.warn('AI_SERVICE', '[AI] Failed to get output language, using default "en":', error);
        }
        sessionOptions = {
          ...sessionOptions,
          expectedInputs: sessionOptions?.expectedInputs || [{ type: 'text', languages: ["en", "es", "ja"] }],
          expectedOutputs: sessionOptions?.expectedOutputs || [{ type: 'text', languages: [outputLanguage || "en"] }],
        };
      }

      // Add monitor callback for download progress if provided
      if (onDownloadProgress) {
        sessionOptions = {
          ...sessionOptions,
          monitor(m: any) {
            m.addEventListener('downloadprogress', (e: any) => {
              const progress = e.loaded || 0; // 0 to 1
              logger.debug('AI_SERVICE', `[AI] GeminiNano download progress: ${(progress * 100).toFixed(1)}%`);
              onDownloadProgress(progress);
            });
          }
        };
      }

      const session = await LanguageModel.create(sessionOptions);

      this.sessions.set(contextId, session);
      logger.debug('AI_SERVICE', `[AI] Session created successfully. Total sessions: ${this.sessions.size}`);
      return session;
    } catch (error) {
      logger.error('AI_SERVICE', `[AI] Error creating session for context ${contextId}:`, error);
      throw error;
    }
  }

  /**
   * Destroy a session for a specific context
   */
  destroySessionForContext(contextId: string) {
    const session = this.sessions.get(contextId);
    if (session) {
      try {
        session.destroy();
        logger.debug('AI_SERVICE', `[AI] Session destroyed for context: ${contextId}`);
      } catch (error) {
        logger.error('AI_SERVICE', `[AI] Error destroying session for context ${contextId}:`, error);
      }
    }

    this.sessions.delete(contextId);

    // Cancel any active requests for this context
    const abortController = this.activeRequests.get(contextId);
    if (abortController) {
      abortController.abort();
      this.activeRequests.delete(contextId);
    }
  }

  /**
   * Legacy method - creates a session without context (for backward compatibility)
   * @deprecated Use getOrCreateSession instead
   */
  async createSession(options?: AISessionOptions, onDownloadProgress?: (progress: number) => void): Promise<boolean> {
    try {
      // Use a default context for legacy calls
      await this.getOrCreateSession('default', options, onDownloadProgress);
      return true;
    } catch (error) {
      logger.error('AI_SERVICE', 'Error creating AI session:', error);
      return false;
    }
  }

  /**
   * Validate prompt size using Chrome AI's measureInputUsage() API
   * Returns actual token usage for a prompt before sending
   *
   * @param session - AI session to measure against
   * @param prompt - The prompt string to measure
   * @returns Object with validation result: { fits: boolean, actualUsage: number, quota: number, available: number }
   */
  async validatePromptSize(
    session: AILanguageModelSession,
    prompt: string
  ): Promise<{
    fits: boolean;
    actualUsage: number;
    quota: number;
    available: number;
    error?: string;
  }> {
    try {
      // Use Chrome AI's measureInputUsage() to get actual token count
      const actualUsage = await session.measureInputUsage(prompt);
      const quota = session.inputQuota ?? 0;

      // Calculate available space (quota - what's already in session)
      const currentUsage = session.inputUsage ?? 0;
      const available = quota - currentUsage;

      // Apply safety threshold (80%) to prevent QuotaExceededError during streaming
      const safeAvailable = Math.floor(available * this.VALIDATION_SAFETY_THRESHOLD);
      const fits = actualUsage <= safeAvailable;

      logger.debug('PROMPT_ENGINEERING', `[Prompt Validation] Actual usage: ${actualUsage}, Available: ${safeAvailable}/${quota} (${Math.round(this.VALIDATION_SAFETY_THRESHOLD * 100)}% threshold), Fits: ${fits}`);

      return {
        fits,
        actualUsage,
        quota,
        available: safeAvailable
      };
    } catch (error) {
      logger.error('PROMPT_ENGINEERING', '[Prompt Validation] Error measuring input usage:', error);

      // Fallback: estimate if measureInputUsage() fails
      const estimatedUsage = Math.ceil(prompt.length / 4);
      const quota = session.inputQuota ?? 0;
      const currentUsage = session.inputUsage ?? 0;
      const available = quota - currentUsage;

      // Apply safety threshold (80%) to prevent QuotaExceededError during streaming
      const safeAvailable = Math.floor(available * this.VALIDATION_SAFETY_THRESHOLD);

      return {
        fits: estimatedUsage <= safeAvailable,
        actualUsage: estimatedUsage,
        quota,
        available: safeAvailable,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Prompt the AI model with context support
   */
  async prompt(
    input: string,
    systemPrompt?: string,
    responseConstraint?: JSONSchema,
    contextId: string = 'default',
    expectedInputs?: Array<{ type: string; languages: string[] }>,
    expectedOutputs?: Array<{ type: string; languages: string[] }>,
    temperature?: number,
    topK?: number
  ): Promise<string> {
    try {
      logger.debug('PROMPT_ENGINEERING', '[Prompt] contextId:', contextId);
      logger.debug('PROMPT_ENGINEERING', '[Prompt] expectedOutputs:', JSON.stringify(expectedOutputs));

      // Get or create session for this context
      const session = await this.getOrCreateSession(contextId, { systemPrompt, expectedInputs, expectedOutputs, temperature, topK });

      // Create abort controller for this request
      const abortController = new AbortController();

      // Cancel any existing request for this context
      const existingController = this.activeRequests.get(contextId);
      if (existingController) {
        logger.debug('AI_SERVICE', `[AI] Cancelling existing request for context: ${contextId}`);
        existingController.abort();
      }

      this.activeRequests.set(contextId, abortController);

      try {
        // Make the prompt call with abort signal
        const response = await session.prompt(input, {
          responseConstraint,
          signal: abortController.signal
        });

        // Clear the request tracking on success
        this.activeRequests.delete(contextId);

        return response;
      } catch (error: any) {
        // Clear the request tracking
        this.activeRequests.delete(contextId);

        // Check if it was an abort
        if (error.name === 'AbortError') {
          logger.debug('AI_SERVICE', `[AI] Request aborted for context: ${contextId}`);
          throw new Error('AI request was cancelled');
        }

        throw error;
      }
    } catch (error) {
      logger.error('AI_SERVICE', `[AI] Error prompting AI for context ${contextId}:`, error);
      throw error;
    }
  }

  /**
   * Fix malformed JSON by asking AI to correct it
   * Used when initial JSON parsing fails
   */
  async fixMalformedJSON(malformedJson: string, contextId: string = 'default'): Promise<string> {
    const systemPrompt = buildJSONRepairPrompt();
    const input = buildJSONRepairInput(malformedJson);

    try {
      const response = await this.prompt(input, systemPrompt, undefined, contextId);
      return response.trim();
    } catch (error) {
      logger.error('AI_SERVICE', 'Failed to fix malformed JSON:', error);
      throw error;
    }
  }

  /**
   * Explain a research paper abstract
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
    logger.debug('AI_SERVICE', '[ExplainAbstract] Output language:', outputLanguage);

    const systemPrompt = buildExplainAbstractPrompt(outputLanguage as 'en' | 'es' | 'ja', persona, purpose);
    const languageName = getLanguageName(outputLanguage as 'en' | 'es' | 'ja');

    // If hierarchical summary is provided, use it for richer context
    let input: string;
    if (hierarchicalSummary) {
      logger.debug('AI_SERVICE', '[Explain] Using hierarchical summary for comprehensive explanation');
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

For mathematical expressions, equations, or formulas:
- Use $expression$ for inline math (e.g., $E = mc^2$, $p < 0.05$)
- Use $$expression$$ for display equations on separate lines
- You can also use \\(expression\\) for inline, \\[expression\\] for display
- Use proper LaTeX syntax (e.g., \\frac{numerator}{denominator}, \\sum_{i=1}^{n}, Greek letters like \\alpha, \\beta)`;
    } else {
      logger.debug('AI_SERVICE', '[Explain] Using abstract only (standard approach)');
      input = `IMPORTANT: You must respond entirely in ${languageName}. Do not use any other language.

Please explain this research paper abstract in simple terms that anyone can understand.
Use markdown formatting for better readability:
- Use **bold** for important concepts or key terms
- Use bullet points or numbered lists where appropriate
- Use *italic* for emphasis
- Keep paragraphs concise

For mathematical expressions, equations, or formulas:
- Use $expression$ for inline math (e.g., $E = mc^2$, $p < 0.05$)
- Use $$expression$$ for display equations on separate lines
- You can also use \\(expression\\) for inline, \\[expression\\] for display
- Use proper LaTeX syntax (e.g., \\frac{numerator}{denominator}, \\sum_{i=1}^{n}, Greek letters like \\alpha, \\beta)

<OUTPUT FORMAT BEGIN>
### What is the main problem or research question being addressed?
- Answer
### Why is this problem important?
- Answer
### What is the proposed solution, method or model?
- Answer
### What are the key assumptions orp remises of the approach?
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
    const explanation = await this.prompt(
      input,
      systemPrompt,
      undefined,
      languageContextId,
      [{ type: "text", languages: ["en", "es", "ja"] }],  // expectedInputs
      [{ type: "text", languages: [outputLanguage || "en"] }]  // expectedOutputs
    );

    return {
      originalText: abstract,
      explanation,
      timestamp: Date.now(),
    };
  }

  /**
   * Generate a summary of a paper
   * Tries Summarizer API first, falls back to Prompt API if unavailable
   * Optionally uses hierarchical summary to capture entire paper (not just abstract)
   */
  async generateSummary(
    title: string,
    abstract: string,
    contextId: string = 'default',
    hierarchicalSummary?: string
  ): Promise<SummaryResult> {
    // Try Summarizer API first if no hierarchical summary (Summarizer works best with abstract)
    if (!hierarchicalSummary) {
      logger.debug('AI_SERVICE', '[Summary] Checking Summarizer API availability...');
      const summarizerCapabilities = await this.checkSummarizerAvailability();

      if (summarizerCapabilities.available) {
        logger.debug('AI_SERVICE', '[Summary] Summarizer API available, using it for summary generation');
        const summarizerResult = await this.generateSummaryWithSummarizer(title, abstract, contextId);

        if (summarizerResult) {
          logger.debug('AI_SERVICE', '[Summary] ✓ Successfully generated summary with Summarizer API');
          return summarizerResult;
        } else {
          logger.warn('AI_SERVICE', '[Summary] Summarizer API failed, falling back to Prompt API');
        }
      } else {
        logger.debug('AI_SERVICE', `[Summary] Summarizer API not available (${summarizerCapabilities.availability}), using Prompt API`);
      }
    } else {
      logger.debug('AI_SERVICE', '[Summary] Using Prompt API for hierarchical summary (better for full paper analysis)');
    }

    // Fall back to Prompt API
    logger.debug('AI_SERVICE', '[Summary] Using Prompt API for summary generation');
    const persona = await getPersona();
    const purpose = await getPurpose();
    const systemPrompt = buildSummaryPrompt(persona, purpose);

    // If hierarchical summary is provided, use it for comprehensive summary
    let input: string;
    if (hierarchicalSummary) {
      logger.debug('AI_SERVICE', '[Summary] Using hierarchical summary for comprehensive key points');
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
      logger.debug('AI_SERVICE', '[Summary] Using abstract only (standard approach)');
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

    const response = await this.prompt(input, systemPrompt, undefined, contextId);

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

    logger.debug('AI_SERVICE', '[Summary] ✓ Successfully generated summary with Prompt API');
    return {
      summary,
      keyPoints: keyPoints.length > 0 ? keyPoints : ['No key points extracted'],
      timestamp: Date.now(),
      generatedBy: 'prompt-api'
    };
  }

  /**
   * Explain a technical term
   */
  async explainTerm(term: string, context?: string, contextId: string = 'default'): Promise<string> {
    const systemPrompt = buildExplainTermPrompt();

    const input = context
      ? `Explain the term "${term}" in the context of: ${context}`
      : `Explain the term "${term}" in simple terms`;

    return await this.prompt(input, systemPrompt, undefined, contextId);
  }

  /**
   * Simplify a section of text
   */
  async simplifyText(text: string, contextId: string = 'default'): Promise<string> {
    const systemPrompt = buildSimplifyTextPrompt();

    const input = `Rewrite this text in simpler terms:\n\n${text}`;

    return await this.prompt(input, systemPrompt, undefined, contextId);
  }

  /**
   * Extract structured paper metadata from content using AI
   * This is the core method for intelligent paper detection
   * Implements exponential backoff with max 3 retries
   */
  async extractPaperMetadata(content: string, contextId: string = 'extraction'): Promise<any> {
    // Check if AI is readily available (no user gesture needed)
    const capabilities = await this.checkAvailability();

    if (capabilities.availability !== 'available') {
      logger.debug('AI_SERVICE', `⚠️ AI extraction skipped: AI status is "${capabilities.availability}"`);

      if (capabilities.availability === 'downloadable') {
        logger.debug('AI_SERVICE', '💡 Tip: Click "Initialize AI" button in the extension popup to download the AI model (one-time setup)');
      } else if (capabilities.availability === 'downloading') {
        logger.debug('AI_SERVICE', '⏳ AI model is currently downloading. AI extraction will work automatically once download completes.');
      } else if (capabilities.availability === 'unavailable') {
        logger.debug('AI_SERVICE', '❌ Chrome AI has crashed. Open extension popup for recovery instructions.');
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
      logger.warn('AI_SERVICE', `AI extraction failed after ${maxRetries} attempts for ${url}`);
      this.extractionRetries.delete(url); // Reset for next time
      return null;
    }

    // If this is a retry, apply exponential backoff
    if (currentRetries > 0) {
      const delay = baseDelay * Math.pow(2, currentRetries - 1);
      logger.debug('AI_SERVICE', `Retry ${currentRetries}/${maxRetries} - waiting ${delay}ms before retry...`);
      await sleep(delay);
    }

    // Increment retry count
    this.extractionRetries.set(url, currentRetries + 1);

    // Check content length and warn if too large
    if (content.length > 10000) {
      logger.warn('AI_SERVICE', `[AI] Content is very large (${content.length} chars). Consider pre-cleaning or truncating before calling AI.`);
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
      logger.debug('AI_SERVICE', `Attempting AI extraction (attempt ${currentRetries + 1}/${maxRetries})...`);
      const response = await this.prompt(input, systemPrompt, undefined, contextId);

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
        logger.warn('AI_SERVICE', 'JSON parse failed, asking AI to fix...', parseError);

        try {
          // Ask AI to fix the malformed JSON
          const fixedJson = await this.fixMalformedJSON(jsonStr, contextId);

          // Remove markdown if AI added it
          let cleanedFixed = fixedJson.trim();
          if (cleanedFixed.startsWith('```')) {
            cleanedFixed = cleanedFixed.replace(/```json\n?/g, '').replace(/```\n?/g, '');
          }

          // Try parsing the fixed JSON
          metadata = JSON.parse(cleanedFixed);
          logger.debug('AI_SERVICE', '✓ AI successfully fixed malformed JSON');
        } catch (fixError) {
          // Both attempts failed
          logger.error('AI_SERVICE', 'AI could not fix malformed JSON:', fixError);
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
      logger.debug('AI_SERVICE', 'AI extraction successful!');

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
      logger.error('AI_SERVICE', `AI extraction attempt ${currentRetries + 1} failed:`, error);

      // If we haven't hit max retries, try again
      if (currentRetries + 1 < maxRetries) {
        logger.debug('AI_SERVICE', `Will retry with exponential backoff...`);
        return await this.extractPaperMetadata(content, contextId);
      }

      // Max retries exceeded
      logger.error('AI_SERVICE', `AI extraction failed after ${maxRetries} attempts`);
      this.extractionRetries.delete(url); // Reset for next time
      return null;
    }
  }

  /**
   * Enhance paper metadata for citations
   * Extracts missing citation metadata (publish date, journal, volume/issue) using AI
   */
  async enhanceMetadataForCitation(
    paper: any,
    contextId: string = 'citation-enhancement'
  ): Promise<any> {
    logger.debug('AI_SERVICE', '[AI] Enhancing metadata for citation:', paper.title);

    const capabilities = await this.checkAvailability();

    if (capabilities.availability !== 'available') {
      logger.debug('AI_SERVICE', '⚠️ AI not available for metadata enhancement');
      return null;
    }

    const systemPrompt = `You are a research paper citation assistant.
Extract missing citation metadata and return it as valid JSON.
Only extract information that can be inferred from the given data.`;

    // Build context from available metadata
    const context = `
Paper title: ${paper.title}
Authors: ${paper.authors?.join(', ') || 'Unknown'}
URL: ${paper.url}
Source: ${paper.source}
DOI: ${paper.metadata?.doi || 'Unknown'}
arXiv ID: ${paper.metadata?.arxivId || 'Unknown'}
PubMed ID: ${paper.metadata?.pmid || 'Unknown'}
Current metadata: ${JSON.stringify(paper.metadata || {})}
`;

    const input = `Extract or infer the missing citation metadata for this research paper and return ONLY valid JSON with this structure:
{
  "publishDate": "YYYY-MM-DD or YYYY (if known/inferable, else null)",
  "journal": "journal name or conference name (if known, else null)",
  "venue": "publication venue (if different from journal, else null)",
  "volume": "volume number (if known, else null)",
  "issue": "issue number (if known, else null)",
  "pageRange": "page range like '123-145' (if known, else null)"
}

Paper information:
${context}

Return ONLY the JSON object, no other text. If you cannot determine a field, use null.`;

    try {
      const response = await this.prompt(input, systemPrompt, undefined, contextId);

      // Parse JSON from response
      let jsonStr = response.trim();

      // Remove markdown code blocks if present
      if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/```json\n?/g, '').replace(/```\n?/g, '');
      }

      const enhanced = JSON.parse(jsonStr);

      logger.debug('AI_SERVICE', '✓ Enhanced metadata:', enhanced);

      return {
        ...enhanced,
        metadataEnhanced: true,
        enhancedAt: Date.now(),
      };
    } catch (error) {
      logger.error('AI_SERVICE', 'Error enhancing metadata:', error);
      return {
        metadataEnhanced: true,
        enhancedAt: Date.now(),
      };
    }
  }

  /**
   * Estimate token count for text
   * Rough estimation: 1 token ≈ 4 characters
   */
  estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * Initialize AI with user gesture
   * This triggers the one-time AI model download if needed
   * Must be called from a user interaction (button click)
   */
  async initializeAI(): Promise<{ success: boolean; message: string }> {
    try {
      logger.debug('AI_SERVICE', 'Initializing AI...');

      const capabilities = await this.checkAvailability();

      if (capabilities.availability === 'available') {
        return {
          success: true,
          message: 'AI is already initialized and ready to use!',
        };
      }

      if (capabilities.availability === 'no') {
        return {
          success: false,
          message: 'AI is not available on this device. Chrome Prompt API is not supported.',
        };
      }

      // Try to create a session (triggers download if needed)
      // Add download progress tracking
      const outputLanguage = await getOutputLanguage();
      const created = await this.createSession({
        systemPrompt: 'You are a helpful research assistant.',
        expectedInputs: [{ type: 'text', languages: ["en", "es", "ja"] }],
        expectedOutputs: [{ type: 'text', languages: [outputLanguage || "en"] }]
      }, (progress) => {
        // Broadcast GeminiNano download progress (0-1 range)
        // Map to 0-100% of combined progress
        const combinedProgress = progress * 100;

        chrome.runtime.sendMessage({
          type: 'MODEL_DOWNLOAD_PROGRESS',
          payload: {
            model: 'gemini',
            progress: progress * 100, // 0-100%
            combinedProgress: combinedProgress, // 0-100%
          },
        }).catch(() => {
          // No listeners, that's ok
        });
      });

      if (created) {
        logger.debug('AI_SERVICE', '✓ GeminiNano initialized successfully!');

        return {
          success: true,
          message: 'AI initialized successfully!',
        };
      } else {
        return {
          success: false,
          message: 'Failed to initialize AI. Please try again.',
        };
      }
    } catch (error) {
      logger.error('AI_SERVICE', 'Error initializing AI:', error);
      return {
        success: false,
        message: `Failed to initialize AI: ${error}`,
      };
    }
  }

  /**
   * Reset AI after a crash
   * Clears crashed sessions and retry counts, then attempts recovery
   * Can be called without requiring Chrome restart
   */
  async resetAI(): Promise<{ success: boolean; message: string }> {
    try {
      logger.debug('AI_SERVICE', '[AI Reset] Attempting to reset crashed AI...');

      // Step 1: Destroy all existing sessions
      this.destroyAllSessions();
      logger.debug('AI_SERVICE', '[AI Reset] ✓ Destroyed all sessions');

      // Step 2: Clear all retry counts
      this.clearRetries();
      logger.debug('AI_SERVICE', '[AI Reset] ✓ Cleared retry counts');

      // Step 3: Clear cached capabilities
      this.capabilities = null;
      logger.debug('AI_SERVICE', '[AI Reset] ✓ Cleared capabilities cache');

      // Step 4: Check current AI availability
      const capabilities = await this.checkAvailability();
      logger.debug('AI_SERVICE', `[AI Reset] AI availability after reset: ${capabilities.availability}`);

      if (capabilities.availability === 'available') {
        // AI is now available - try to create a session
        const outputLanguage = await getOutputLanguage();
        const created = await this.createSession({
          systemPrompt: 'You are a helpful research assistant.',
          expectedInputs: [{ type: 'text', languages: ["en", "es", "ja"] }],
          expectedOutputs: [{ type: 'text', languages: [outputLanguage || "en"] }]
        });

        if (created) {
          logger.debug('AI_SERVICE', '[AI Reset] ✓ AI reset successful!');
          return {
            success: true,
            message: 'AI reset successful! Kuma is back and ready to help.',
          };
        } else {
          logger.debug('AI_SERVICE', '[AI Reset] ⚠️ AI available but session creation failed');
          return {
            success: false,
            message: 'AI is available but session creation failed. Try again.',
          };
        }
      } else if (capabilities.availability === 'downloadable') {
        logger.debug('AI_SERVICE', '[AI Reset] AI needs to be downloaded');
        return {
          success: true,
          message: 'AI reset complete. Click "Wake Kuma up" to initialize.',
        };
      } else if (capabilities.availability === 'downloading') {
        logger.debug('AI_SERVICE', '[AI Reset] AI is downloading');
        return {
          success: true,
          message: 'AI reset complete. Model is downloading...',
        };
      } else if (capabilities.availability === 'unavailable') {
        logger.debug('AI_SERVICE', '[AI Reset] ❌ AI still unavailable after reset');
        return {
          success: false,
          message: 'AI is still crashed. Chrome restart may be required.',
        };
      } else {
        logger.debug('AI_SERVICE', '[AI Reset] ❌ AI not supported on this device');
        return {
          success: false,
          message: 'Chrome AI is not available on this device.',
        };
      }
    } catch (error) {
      logger.error('AI_SERVICE', '[AI Reset] Error during reset:', error);
      return {
        success: false,
        message: `Reset failed: ${error}`,
      };
    }
  }

  /**
   * Destroy all sessions - used during reset
   */
  private destroyAllSessions() {
    for (const [contextId] of this.sessions) {
      this.destroySessionForContext(contextId);
    }
    this.sessions.clear();
    this.activeRequests.clear();
  }

  /**
   * Analyze paper methodology
   * Examines study design, data collection, sample size, and statistical methods
   * Uses hierarchical summary + RAG to find relevant methodology sections
   */
  async analyzeMethodology(
    paperId: string,
    hierarchicalSummary: string,
    contextId: string = 'analysis'
  ): Promise<MethodologyAnalysis> {
    // Get user's preferred output language
    const outputLanguage = await getOutputLanguage();
    const languageName = getLanguageName(outputLanguage as 'en' | 'es' | 'ja');
    const persona = await getPersona();
    const purpose = await getPurpose();
    const verbosity = await getVerbosity();
    const systemPrompt = buildMethodologyAnalysisPrompt(outputLanguage as 'en' | 'es' | 'ja', persona, purpose, verbosity);

    try {
      // Import RAG and quota services
      const { getRelevantChunksByTopicSemantic } = await import('./dbService.ts');
      const { trimChunksByTokenBudget } = await import('./adaptiveRAGService.ts');
      const { inputQuotaService } = await import('./inputQuotaService.ts');

      // Pre-flight quota check: Calculate available quota
      const inputQuota = await inputQuotaService.getInputQuota();
      const summaryTokens = Math.ceil(hierarchicalSummary.length / 4);
      const estimatedOverhead = 150 + 50 + 100; // system + formatting + schema
      const responseBuffer = 400;
      const minRAGTokens = 250; // Minimum 2 chunks

      logger.debug('PROMPT_ENGINEERING', `[Methodology Analysis] Pre-flight check - Quota: ${inputQuota}, Summary: ${summaryTokens} tokens, Overhead: ${estimatedOverhead}, Response buffer: ${responseBuffer}`);

      // Find relevant chunks for methodology using semantic search (oversample for trimming)
      const topics = ['methodology', 'methods', 'design', 'procedure', 'participants', 'sample', 'statistical'];
      const chunkLimit = await getOptimalRAGChunkCount('analysis');
      const relevantChunks = await getRelevantChunksByTopicSemantic(paperId, topics, chunkLimit);

      // Trim chunks by token budget (pass hierarchical summary as conversationState.summary)
      const { chunks: trimmedChunks, budgetStatus } = await trimChunksByTokenBudget(
        relevantChunks,
        'analysis',
        { summary: hierarchicalSummary, recentMessages: [] }
      );

      logger.debug('PROMPT_ENGINEERING', `[Methodology Analysis] Budget status - Available: ${budgetStatus.availableTokens}, Used: ${budgetStatus.usedTokens}, MinTokensFit: ${budgetStatus.minTokensFit}`);
      logger.debug('PROMPT_ENGINEERING', `[Methodology Analysis] Trimmed ${relevantChunks.length} → ${trimmedChunks.length} chunks`);

      if (trimmedChunks.length === 0) {
        logger.warn('PROMPT_ENGINEERING', '[Methodology Analysis] No chunks fit within quota - using summary only');
      }

      // Combine hierarchical summary + trimmed chunks
      const chunksText = trimmedChunks.map(chunk => chunk.content).join('\n\n---\n\n');

      const context = trimmedChunks.length > 0
        ? `FULL PAPER SUMMARY:
${hierarchicalSummary}

DETAILED METHODOLOGY SECTIONS:
${chunksText}`
        : `FULL PAPER SUMMARY:
${hierarchicalSummary}

Note: Limited quota - analysis based on summary only.`;

      const input = `IMPORTANT: You must respond entirely in ${languageName}. All analysis must be in ${languageName}.

Analyze the methodology of this research paper using the full paper summary and detailed methodology sections below.

${context}

Provide a comprehensive analysis of the study design, methods, and rigor.`;

      // Include language in context ID to ensure separate sessions per language
      const languageContextId = `${contextId}-${outputLanguage}`;

      // Get schema with language-appropriate descriptions
      const schema = getSchemaForLanguage('methodology', outputLanguage as 'en' | 'es' | 'ja');

      // Retry logic with exponential backoff
      const maxRetries = 3;
      let lastError: any;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          const response = await this.prompt(
            input,
            systemPrompt,
            schema,
            languageContextId,
            [{ type: "text", languages: ["en", "es", "ja"] }],  // expectedInputs
            [{ type: "text", languages: [outputLanguage || "en"] }]  // expectedOutputs
          );

          // Clean up session immediately after successful use
          try {
            await this.destroySessionForContext(languageContextId);
          } catch (cleanupError) {
            logger.warn('AI_SERVICE', '[Methodology Analysis] Failed to cleanup session:', cleanupError);
          }

          return JSON.parse(response);
        } catch (error) {
          lastError = error;
          const errorMessage = error instanceof Error ? error.message : String(error);
          const isRetryableError = errorMessage.includes('UnknownError') ||
                                   errorMessage.includes('generic failures') ||
                                   errorMessage.includes('timeout') ||
                                   errorMessage.includes('resource');

          if (attempt < maxRetries && isRetryableError) {
            const delay = Math.pow(2, attempt - 1) * 1000; // 1s, 2s, 4s
            logger.warn('AI_SERVICE', `[Methodology Analysis] Failed (attempt ${attempt}/${maxRetries}), retrying in ${delay}ms:`, errorMessage);
            await new Promise(resolve => setTimeout(resolve, delay));
          } else if (attempt === maxRetries) {
            logger.error('AI_SERVICE', `[Methodology Analysis] Failed after ${attempt} attempts:`, error);
          }
        }
      }

      // If all retries failed, throw to outer catch
      throw lastError;
    } catch (error) {
      logger.error('AI_SERVICE', 'Methodology analysis failed:', error);
      return {
        studyType: 'Unable to analyze',
        studyDesign: 'Unable to analyze',
        dataCollection: 'Unable to analyze',
        sampleSize: 'Unable to analyze',
        statisticalMethods: 'Unable to analyze',
        strengths: ['Analysis failed'],
        concerns: ['Could not complete analysis'],
      };
    }
  }

  /**
   * Identify confounders and biases
   * Looks for potential confounding variables and methodological biases
   * Uses hierarchical summary + RAG to find relevant sections
   */
  async identifyConfounders(
    paperId: string,
    hierarchicalSummary: string,
    contextId: string = 'analysis'
  ): Promise<ConfounderAnalysis> {
    // Get user's preferred output language
    const outputLanguage = await getOutputLanguage();
    const languageName = getLanguageName(outputLanguage as 'en' | 'es' | 'ja');
    const persona = await getPersona();
    const purpose = await getPurpose();
    const verbosity = await getVerbosity();
    const systemPrompt = buildConfounderAnalysisPrompt(outputLanguage as 'en' | 'es' | 'ja', persona, purpose, verbosity);

    try {
      // Import RAG and quota services
      const { getRelevantChunksByTopicSemantic } = await import('./dbService.ts');
      const { trimChunksByTokenBudget } = await import('./adaptiveRAGService.ts');
      const { inputQuotaService } = await import('./inputQuotaService.ts');

      // Pre-flight quota check: Calculate available quota
      const inputQuota = await inputQuotaService.getInputQuota();
      const summaryTokens = Math.ceil(hierarchicalSummary.length / 4);
      const estimatedOverhead = 150 + 50 + 100; // system + formatting + schema
      const responseBuffer = 400;

      logger.debug('PROMPT_ENGINEERING', `[Confounder Analysis] Pre-flight check - Quota: ${inputQuota}, Summary: ${summaryTokens} tokens, Overhead: ${estimatedOverhead}, Response buffer: ${responseBuffer}`);

      // Find relevant chunks for confounders/biases using semantic search (oversample for trimming)
      const topics = ['bias', 'confound', 'limitation', 'control', 'random', 'blinding', 'selection'];
      const chunkLimit = await getOptimalRAGChunkCount('analysis');
      const relevantChunks = await getRelevantChunksByTopicSemantic(paperId, topics, chunkLimit);

      // Trim chunks by token budget (pass hierarchical summary as conversationState.summary)
      const { chunks: trimmedChunks, budgetStatus } = await trimChunksByTokenBudget(
        relevantChunks,
        'analysis',
        { summary: hierarchicalSummary, recentMessages: [] }
      );

      logger.debug('PROMPT_ENGINEERING', `[Confounder Analysis] Budget status - Available: ${budgetStatus.availableTokens}, Used: ${budgetStatus.usedTokens}, MinTokensFit: ${budgetStatus.minTokensFit}`);
      logger.debug('PROMPT_ENGINEERING', `[Confounder Analysis] Trimmed ${relevantChunks.length} → ${trimmedChunks.length} chunks`);

      if (trimmedChunks.length === 0) {
        logger.warn('PROMPT_ENGINEERING', '[Confounder Analysis] No chunks fit within quota - using summary only');
      }

      // Combine hierarchical summary + trimmed chunks
      const chunksText = trimmedChunks.map(chunk => chunk.content).join('\n\n---\n\n');

      const context = trimmedChunks.length > 0
        ? `FULL PAPER SUMMARY:
${hierarchicalSummary}

DETAILED SECTIONS (Methods, Limitations, Discussion):
${chunksText}`
        : `FULL PAPER SUMMARY:
${hierarchicalSummary}

Note: Limited quota - analysis based on summary only.`;

      const input = `IMPORTANT: You must respond entirely in ${languageName}. All analysis must be in ${languageName}.

Identify potential confounders and biases in this research paper using the full paper summary and detailed sections below.

${context}

Provide a comprehensive analysis of confounders, biases, and control measures.`;

      // Include language in context ID to ensure separate sessions per language
      const languageContextId = `${contextId}-${outputLanguage}`;

      // Get schema with language-appropriate descriptions
      const schema = getSchemaForLanguage('confounder', outputLanguage as 'en' | 'es' | 'ja');

      // Retry logic with exponential backoff
      const maxRetries = 3;
      let lastError: any;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          const response = await this.prompt(
            input,
            systemPrompt,
            schema,
            languageContextId,
            [{ type: "text", languages: ["en", "es", "ja"] }],  // expectedInputs
            [{ type: "text", languages: [outputLanguage || "en"] }]  // expectedOutputs
          );

          // Clean up session immediately after successful use
          try {
            await this.destroySessionForContext(languageContextId);
          } catch (cleanupError) {
            logger.warn('AI_SERVICE', '[Confounder Analysis] Failed to cleanup session:', cleanupError);
          }

          return JSON.parse(response);
        } catch (error) {
          lastError = error;
          const errorMessage = error instanceof Error ? error.message : String(error);
          const isRetryableError = errorMessage.includes('UnknownError') ||
                                   errorMessage.includes('generic failures') ||
                                   errorMessage.includes('timeout') ||
                                   errorMessage.includes('resource');

          if (attempt < maxRetries && isRetryableError) {
            const delay = Math.pow(2, attempt - 1) * 1000; // 1s, 2s, 4s
            logger.warn('AI_SERVICE', `[Confounder Analysis] Failed (attempt ${attempt}/${maxRetries}), retrying in ${delay}ms:`, errorMessage);
            await new Promise(resolve => setTimeout(resolve, delay));
          } else if (attempt === maxRetries) {
            logger.error('AI_SERVICE', `[Confounder Analysis] Failed after ${attempt} attempts:`, error);
          }
        }
      }

      // If all retries failed, throw to outer catch
      throw lastError;
    } catch (error) {
      logger.error('AI_SERVICE', 'Confounder analysis failed:', error);
      return {
        identified: [{ name: 'Analysis failed', explanation: 'Could not identify confounders due to an error' }],
        biases: [{ name: 'Could not analyze', explanation: 'An error occurred while analyzing biases' }],
        controlMeasures: [{ name: 'Unable to determine', explanation: 'Could not determine control measures due to an error' }],
      };
    }
  }

  /**
   * Analyze implications and applications
   * Identifies real-world applications and significance
   * Uses hierarchical summary + RAG to find relevant sections
   */
  async analyzeImplications(
    paperId: string,
    hierarchicalSummary: string,
    contextId: string = 'analysis'
  ): Promise<ImplicationAnalysis> {
    // Get user's preferred output language
    const outputLanguage = await getOutputLanguage();
    const languageName = getLanguageName(outputLanguage as 'en' | 'es' | 'ja');
    const persona = await getPersona();
    const purpose = await getPurpose();
    const verbosity = await getVerbosity();
    const systemPrompt = buildImplicationAnalysisPrompt(outputLanguage as 'en' | 'es' | 'ja', persona, purpose, verbosity);

    try {
      // Import RAG and quota services
      const { getRelevantChunksByTopicSemantic } = await import('./dbService.ts');
      const { trimChunksByTokenBudget } = await import('./adaptiveRAGService.ts');
      const { inputQuotaService } = await import('./inputQuotaService.ts');

      // Pre-flight quota check: Calculate available quota
      const inputQuota = await inputQuotaService.getInputQuota();
      const summaryTokens = Math.ceil(hierarchicalSummary.length / 4);
      const estimatedOverhead = 150 + 50 + 100; // system + formatting + schema
      const responseBuffer = 400;

      logger.debug('PROMPT_ENGINEERING', `[Implications Analysis] Pre-flight check - Quota: ${inputQuota}, Summary: ${summaryTokens} tokens, Overhead: ${estimatedOverhead}, Response buffer: ${responseBuffer}`);

      // Find relevant chunks for implications using semantic search (oversample for trimming)
      const topics = ['implication', 'application', 'significance', 'discussion', 'conclusion', 'impact', 'future'];
      const chunkLimit = await getOptimalRAGChunkCount('analysis');
      const relevantChunks = await getRelevantChunksByTopicSemantic(paperId, topics, chunkLimit);

      // Trim chunks by token budget (pass hierarchical summary as conversationState.summary)
      const { chunks: trimmedChunks, budgetStatus } = await trimChunksByTokenBudget(
        relevantChunks,
        'analysis',
        { summary: hierarchicalSummary, recentMessages: [] }
      );

      logger.debug('PROMPT_ENGINEERING', `[Implications Analysis] Budget status - Available: ${budgetStatus.availableTokens}, Used: ${budgetStatus.usedTokens}, MinTokensFit: ${budgetStatus.minTokensFit}`);
      logger.debug('PROMPT_ENGINEERING', `[Implications Analysis] Trimmed ${relevantChunks.length} → ${trimmedChunks.length} chunks`);

      if (trimmedChunks.length === 0) {
        logger.warn('PROMPT_ENGINEERING', '[Implications Analysis] No chunks fit within quota - using summary only');
      }

      // Combine hierarchical summary + trimmed chunks
      const chunksText = trimmedChunks.map(chunk => chunk.content).join('\n\n---\n\n');

      const context = trimmedChunks.length > 0
        ? `FULL PAPER SUMMARY:
${hierarchicalSummary}

DETAILED SECTIONS (Results, Discussion, Conclusions):
${chunksText}`
        : `FULL PAPER SUMMARY:
${hierarchicalSummary}

Note: Limited quota - analysis based on summary only.`;

      const input = `IMPORTANT: You must respond entirely in ${languageName}. All analysis must be in ${languageName}.

Analyze the implications of this research paper using the full paper summary and detailed sections below.

${context}

Provide a comprehensive analysis of real-world applications, significance, and future research directions.`;

      // Include language in context ID to ensure separate sessions per language
      const languageContextId = `${contextId}-${outputLanguage}`;

      // Get schema with language-appropriate descriptions
      const schema = getSchemaForLanguage('implication', outputLanguage as 'en' | 'es' | 'ja');

      // Retry logic with exponential backoff
      const maxRetries = 3;
      let lastError: any;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          const response = await this.prompt(
            input,
            systemPrompt,
            schema,
            languageContextId,
            [{ type: "text", languages: ["en", "es", "ja"] }],  // expectedInputs
            [{ type: "text", languages: [outputLanguage || "en"] }]  // expectedOutputs
          );

          // Clean up session immediately after successful use
          try {
            await this.destroySessionForContext(languageContextId);
          } catch (cleanupError) {
            logger.warn('AI_SERVICE', '[Implications Analysis] Failed to cleanup session:', cleanupError);
          }

          return JSON.parse(response);
        } catch (error) {
          lastError = error;
          const errorMessage = error instanceof Error ? error.message : String(error);
          const isRetryableError = errorMessage.includes('UnknownError') ||
                                   errorMessage.includes('generic failures') ||
                                   errorMessage.includes('timeout') ||
                                   errorMessage.includes('resource');

          if (attempt < maxRetries && isRetryableError) {
            const delay = Math.pow(2, attempt - 1) * 1000; // 1s, 2s, 4s
            logger.warn('AI_SERVICE', `[Implications Analysis] Failed (attempt ${attempt}/${maxRetries}), retrying in ${delay}ms:`, errorMessage);
            await new Promise(resolve => setTimeout(resolve, delay));
          } else if (attempt === maxRetries) {
            logger.error('AI_SERVICE', `[Implications Analysis] Failed after ${attempt} attempts:`, error);
          }
        }
      }

      // If all retries failed, throw to outer catch
      throw lastError;
    } catch (error) {
      logger.error('AI_SERVICE', 'Implications analysis failed:', error);
      return {
        realWorldApplications: ['Analysis failed'],
        significance: 'Could not analyze',
        futureResearch: ['Unable to determine'],
      };
    }
  }

  /**
   * Identify limitations
   * Extracts and explains study limitations and constraints
   * Uses hierarchical summary + RAG to find relevant sections
   */
  async identifyLimitations(
    paperId: string,
    hierarchicalSummary: string,
    contextId: string = 'analysis'
  ): Promise<LimitationAnalysis> {
    // Get user's preferred output language
    const outputLanguage = await getOutputLanguage();
    const languageName = getLanguageName(outputLanguage as 'en' | 'es' | 'ja');
    const persona = await getPersona();
    const purpose = await getPurpose();
    const verbosity = await getVerbosity();
    const systemPrompt = buildLimitationAnalysisPrompt(outputLanguage as 'en' | 'es' | 'ja', persona, purpose, verbosity);

    try {
      // Import RAG and quota services
      const { getRelevantChunksByTopicSemantic } = await import('./dbService.ts');
      const { trimChunksByTokenBudget } = await import('./adaptiveRAGService.ts');
      const { inputQuotaService } = await import('./inputQuotaService.ts');

      // Pre-flight quota check: Calculate available quota
      const inputQuota = await inputQuotaService.getInputQuota();
      const summaryTokens = Math.ceil(hierarchicalSummary.length / 4);
      const estimatedOverhead = 150 + 50 + 100; // system + formatting + schema
      const responseBuffer = 400;

      logger.debug('PROMPT_ENGINEERING', `[Limitations Analysis] Pre-flight check - Quota: ${inputQuota}, Summary: ${summaryTokens} tokens, Overhead: ${estimatedOverhead}, Response buffer: ${responseBuffer}`);

      // Find relevant chunks for limitations using semantic search (oversample for trimming)
      const topics = ['limitation', 'constraint', 'weakness', 'generalizability', 'caveat', 'shortcoming'];
      const chunkLimit = await getOptimalRAGChunkCount('analysis');
      const relevantChunks = await getRelevantChunksByTopicSemantic(paperId, topics, chunkLimit);

      // Trim chunks by token budget (pass hierarchical summary as conversationState.summary)
      const { chunks: trimmedChunks, budgetStatus } = await trimChunksByTokenBudget(
        relevantChunks,
        'analysis',
        { summary: hierarchicalSummary, recentMessages: [] }
      );

      logger.debug('PROMPT_ENGINEERING', `[Limitations Analysis] Budget status - Available: ${budgetStatus.availableTokens}, Used: ${budgetStatus.usedTokens}, MinTokensFit: ${budgetStatus.minTokensFit}`);
      logger.debug('PROMPT_ENGINEERING', `[Limitations Analysis] Trimmed ${relevantChunks.length} → ${trimmedChunks.length} chunks`);

      if (trimmedChunks.length === 0) {
        logger.warn('PROMPT_ENGINEERING', '[Limitations Analysis] No chunks fit within quota - using summary only');
      }

      // Combine hierarchical summary + trimmed chunks
      const chunksText = trimmedChunks.map(chunk => chunk.content).join('\n\n---\n\n');

      const context = trimmedChunks.length > 0
        ? `FULL PAPER SUMMARY:
${hierarchicalSummary}

DETAILED SECTIONS (Limitations, Discussion):
${chunksText}`
        : `FULL PAPER SUMMARY:
${hierarchicalSummary}

Note: Limited quota - analysis based on summary only.`;

      const input = `IMPORTANT: You must respond entirely in ${languageName}. All analysis must be in ${languageName}.

Identify the limitations of this research paper using the full paper summary and detailed sections below.

${context}

Provide a comprehensive analysis of study limitations and generalizability.`;

      // Include language in context ID to ensure separate sessions per language
      const languageContextId = `${contextId}-${outputLanguage}`;

      // Get schema with language-appropriate descriptions
      const schema = getSchemaForLanguage('limitation', outputLanguage as 'en' | 'es' | 'ja');

      // Retry logic with exponential backoff
      const maxRetries = 3;
      let lastError: any;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          const response = await this.prompt(
            input,
            systemPrompt,
            schema,
            languageContextId,
            [{ type: "text", languages: ["en", "es", "ja"] }],  // expectedInputs
            [{ type: "text", languages: [outputLanguage || "en"] }]  // expectedOutputs
          );

          // Clean up session immediately after successful use
          try {
            await this.destroySessionForContext(languageContextId);
          } catch (cleanupError) {
            logger.warn('AI_SERVICE', '[Limitations Analysis] Failed to cleanup session:', cleanupError);
          }

          return JSON.parse(response);
        } catch (error) {
          lastError = error;
          const errorMessage = error instanceof Error ? error.message : String(error);
          const isRetryableError = errorMessage.includes('UnknownError') ||
                                   errorMessage.includes('generic failures') ||
                                   errorMessage.includes('timeout') ||
                                   errorMessage.includes('resource');

          if (attempt < maxRetries && isRetryableError) {
            const delay = Math.pow(2, attempt - 1) * 1000; // 1s, 2s, 4s
            logger.warn('AI_SERVICE', `[Limitations Analysis] Failed (attempt ${attempt}/${maxRetries}), retrying in ${delay}ms:`, errorMessage);
            await new Promise(resolve => setTimeout(resolve, delay));
          } else if (attempt === maxRetries) {
            logger.error('AI_SERVICE', `[Limitations Analysis] Failed after ${attempt} attempts:`, error);
          }
        }
      }

      // If all retries failed, throw to outer catch
      throw lastError;
    } catch (error) {
      logger.error('AI_SERVICE', 'Limitations analysis failed:', error);
      return {
        studyLimitations: ['Analysis failed'],
        generalizability: 'Could not analyze',
      };
    }
  }

  /**
   * Generate complete paper analysis
   * Combines all analysis methods for comprehensive evaluation
   * Uses hierarchical summary + RAG for accurate, comprehensive analysis
   */
  async analyzePaper(
    paperId: string,
    hierarchicalSummary: string,
    contextId: string = 'analysis',
    onProgress?: (step: number, total: number) => void,
    onSectionComplete?: (section: string, result: any) => void
  ): Promise<PaperAnalysisResult> {
    logger.debug('AI_SERVICE', 'Starting comprehensive paper analysis with hierarchical summary + RAG...');

    const totalSteps = 4;

    // Run analyses sequentially to report progress after each step
    logger.debug('AI_SERVICE', '[Analysis] Step 1/4: Analyzing methodology...');
    const methodology = await this.analyzeMethodology(paperId, hierarchicalSummary, `${contextId}-methodology`);
    if (onSectionComplete) onSectionComplete('methodology', methodology);
    if (onProgress) onProgress(1, totalSteps);

    logger.debug('AI_SERVICE', '[Analysis] Step 2/4: Identifying confounders...');
    const confounders = await this.identifyConfounders(paperId, hierarchicalSummary, `${contextId}-confounders`);
    if (onSectionComplete) onSectionComplete('confounders', confounders);
    if (onProgress) onProgress(2, totalSteps);

    logger.debug('AI_SERVICE', '[Analysis] Step 3/4: Analyzing implications...');
    const implications = await this.analyzeImplications(paperId, hierarchicalSummary, `${contextId}-implications`);
    if (onSectionComplete) onSectionComplete('implications', implications);
    if (onProgress) onProgress(3, totalSteps);

    logger.debug('AI_SERVICE', '[Analysis] Step 4/4: Identifying limitations...');
    const limitations = await this.identifyLimitations(paperId, hierarchicalSummary, `${contextId}-limitations`);
    if (onSectionComplete) onSectionComplete('limitations', limitations);
    if (onProgress) onProgress(4, totalSteps);

    return {
      methodology,
      confounders,
      implications,
      limitations,
      timestamp: Date.now(),
    };
  }

  /**
   * Answer a question about a research paper using RAG
   * Uses relevant content chunks to provide context-aware answers
   */
  async answerQuestion(
    question: string,
    contextChunks: Array<{
      content: string;
      section?: string;
      index: number;
      parentSection?: string;
      paragraphIndex?: number;
      sentenceGroupIndex?: number;
    }>,
    contextId: string = 'qa'
  ): Promise<QuestionAnswer> {
    logger.debug('AI_SERVICE', 'Answering question using RAG...');

    // Get user's preferred output language
    const outputLanguage = await getOutputLanguage();

    // Validate and trim chunks if needed (with retry logic)
    let finalContextChunks = contextChunks;
    const MAX_RETRIES = 3;

    const buildContext = (chunks: typeof contextChunks) => {
      return chunks
        .map((chunk) => {
          // Build hierarchical citation path
          const hierarchy = chunk.parentSection
            ? `${chunk.parentSection} > ${chunk.section || 'Unknown'}`
            : (chunk.section || 'Unknown section');

          // Add paragraph/sentence info if available (natural boundaries)
          let citation = `[${hierarchy}`;
          if (chunk.paragraphIndex !== undefined) {
            citation += ` > Para ${chunk.paragraphIndex + 1}`;
            if (chunk.sentenceGroupIndex !== undefined) {
              citation += ` > Sentences`;
            }
          }
          citation += `]`;

          return `${citation}\n${chunk.content}`;
        })
        .join('\n\n---\n\n');
    };
    const persona = await getPersona();
    const purpose = await getPurpose();
    const verbosity = await getVerbosity();
    const systemPrompt = buildQAPrompt(outputLanguage as 'en' | 'es' | 'ja', persona, purpose, verbosity);

    // Include language in context ID to ensure separate sessions per language
    const languageContextId = `${contextId}-${outputLanguage}`;

    // Create session first for validation
    const session = await this.getOrCreateSession(languageContextId, {
      systemPrompt,
      expectedInputs: [{ type: "text", languages: ["en", "es", "ja"] }],
      expectedOutputs: [{ type: "text", languages: [outputLanguage || "en"] }]
    });

    // Validate prompt size with retry logic
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      const context = buildContext(finalContextChunks);
      const input = `Based on the following excerpts from a research paper, answer this question:

Question: ${question}

Paper Context:
${context}

Provide a clear, accurate answer based on the information above.
Use markdown formatting for better readability:
- Use **bold** for key findings or important concepts
- Use bullet points or numbered lists for multiple items
- Use *italic* for emphasis
- Mention which sections you used in your answer`;

      // Validate prompt size using Chrome AI's measureInputUsage()
      const validation = await this.validatePromptSize(session, input);

      if (validation.fits) {
        logger.debug('PROMPT_ENGINEERING', `[Q&A] ✓ Prompt validation passed on attempt ${attempt} (${validation.actualUsage} tokens)`);
        break;
      }

      // Prompt too large - try trimming more chunks
      logger.warn('PROMPT_ENGINEERING', `[Q&A] Prompt too large (${validation.actualUsage} > ${validation.available}), trimming chunks... (attempt ${attempt}/${MAX_RETRIES})`);

      if (attempt >= MAX_RETRIES) {
        // Last attempt - use minimal chunks (just 1-2 most relevant)
        logger.error('PROMPT_ENGINEERING', `[Q&A] Max retries reached, using minimal chunks`);
        finalContextChunks = contextChunks.slice(0, Math.min(2, contextChunks.length));
      } else {
        // Remove last 2 chunks and retry (but keep at least 1 chunk)
        const newLength = Math.max(1, finalContextChunks.length - 2);
        finalContextChunks = finalContextChunks.slice(0, newLength);
      }

      if (finalContextChunks.length === 0) {
        throw new Error('Context too large even after aggressive trimming. Try a shorter question or use a model with larger context.');
      }
    }

    // Build final context and input with validated chunks
    const context = buildContext(finalContextChunks);
    const input = `Based on the following excerpts from a research paper, answer this question:

Question: ${question}

Paper Context:
${context}

Provide a clear, accurate answer based on the information above.
Use markdown formatting for better readability:
- Use **bold** for key findings or important concepts
- Use bullet points or numbered lists for multiple items
- Use *italic* for emphasis
- Mention which sections you used in your answer`;

    try {
      const answer = await this.prompt(
        input,
        systemPrompt,
        undefined,
        languageContextId,
        [{ type: "text", languages: ["en", "es", "ja"] }],  // expectedInputs
        [{ type: "text", languages: [outputLanguage || "en"] }]  // expectedOutputs
      );

      // Extract section references from the answer (simple heuristic)
      const sources: string[] = [];
      contextChunks.forEach(chunk => {
        if (chunk.section && answer.toLowerCase().includes(chunk.section.toLowerCase().slice(0, 15))) {
          if (!sources.includes(chunk.section)) {
            sources.push(chunk.section);
          }
        }
      });

      // If no sources detected, use all sections
      if (sources.length === 0) {
        sources.push(...contextChunks.map(c => c.section || 'Content').filter((v, i, a) => a.indexOf(v) === i));
      }

      return {
        question,
        answer,
        sources,
        timestamp: Date.now(),
      };
    } catch (error) {
      logger.error('AI_SERVICE', 'Question answering failed:', error);
      return {
        question,
        answer: 'Sorry, I encountered an error while trying to answer this question. Please try again.',
        sources: [],
        timestamp: Date.now(),
      };
    }
  }

  /**
   * Extract technical terms from truncated paper text using Gemini
   * Simple fallback for legacy papers without pre-extracted chunk terms
   */
  async extractTermsFromText(
    text: string,
    paperTitle: string,
    contextId: string = 'extract-terms',
    targetCount: number = 50
  ): Promise<string[]> {
    logger.debug('AI_SERVICE', '[TermExtraction] Extracting terms from', text.length, 'chars of text');

    // Truncate to ~10k characters
    const truncatedText = text.slice(0, 10000);

    // Get user's preferred output language
    const outputLanguage = await getOutputLanguage();
    const languageName = getLanguageName(outputLanguage as 'en' | 'es' | 'ja');

    const systemPrompt = buildExtractTermsPrompt(outputLanguage as 'en' | 'es' | 'ja');

    const input = `Paper Title: ${paperTitle}

From the following excerpt of a research paper, extract the TOP ${targetCount} most important technical terms, acronyms, and domain-specific concepts that would be valuable in a glossary.

Prioritize:
- Technical terms and scientific terminology (HIGH PRIORITY)
- Acronyms and initialisms (e.g., DNA, MRI, RCT) (HIGH PRIORITY)
- Domain-specific jargon and specialized concepts (HIGH PRIORITY)
- Methodological terms (MEDIUM PRIORITY)
- Statistical or mathematical terms (MEDIUM PRIORITY)

DO NOT include:
- Person names (authors, researchers, people)
- Institution names (universities, organizations)
- Place names (cities, countries, regions)
- General English words
- Common verbs or adjectives

Paper excerpt:
${truncatedText}

Extract exactly ${targetCount} unique terms (or fewer if there aren't enough technical terms).
Return ONLY the terms as a comma-separated list, in order of importance.
IMPORTANT: Respond in ${languageName} but keep technical terms and acronyms in their original form.`;

    try {
      logger.debug('AI_SERVICE', '[TermExtraction] Sending text to Gemini Nano for term extraction...');

      const response = await this.prompt(
        input,
        systemPrompt,
        undefined, // No schema - simple text response
        contextId,
        [{ type: "text", languages: ["en", "es", "ja"] }],
        [{ type: "text", languages: [outputLanguage || "en"] }],
        0,  // temperature
        3   // topK
      );

      // Parse comma-separated list
      const extractedTerms = response
        .split(',')
        .map(term => term.trim())
        .filter(term => term.length > 0 && term.length < 100); // Sanity check

      logger.debug('AI_SERVICE', '[TermExtraction] ✓ Extracted', extractedTerms.length, 'terms');
      logger.debug('AI_SERVICE', '[TermExtraction] Sample terms:', extractedTerms.slice(0, 10).join(', '));

      return extractedTerms;
    } catch (error) {
      logger.error('AI_SERVICE', '[TermExtraction] Failed to extract terms:', error);
      return [];
    }
  }

  /**
   * Extract technical terms from a single chunk using the structured schema
   * Used for on-demand term extraction when glossarization is triggered
   * @param chunkContent The content of the chunk to extract terms from
   * @param paperTitle The title of the paper for context
   * @param contextId The context ID for the AI session
   * @param termCount Number of terms to extract (default: 10)
   * @returns Array of extracted terms
   */
  async extractTermsFromChunk(
    chunkContent: string,
    paperTitle: string,
    contextId: string = 'extract-chunk-terms',
    termCount: number = 10
  ): Promise<string[]> {
    logger.debug('AI_SERVICE', '[ChunkTermExtraction] Extracting', termCount, 'terms from chunk of', chunkContent.length, 'chars');

    // Use the same schema as hierarchical summarization for consistency
    const outputLanguage = await getOutputLanguage();
    const chunkSchema = getSchemaForLanguage('chunk-summary', outputLanguage as 'en' | 'es' | 'ja');

    const systemPrompt = buildExtractChunkTermsPrompt(paperTitle, termCount);

    const input = `Extract the ${termCount} most important technical terms and acronyms from this section. Also provide a brief summary:\n\n${chunkContent}`;

    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await this.prompt(input, systemPrompt, chunkSchema, contextId, undefined, undefined, 0, 3);
        const parsed = JSON.parse(response);

        logger.debug('AI_SERVICE', '[ChunkTermExtraction] ✓ Extracted', parsed.terms.length, 'terms');
        logger.debug('AI_SERVICE', '[ChunkTermExtraction] Sample terms:', parsed.terms.slice(0, 5).join(', '));

        return parsed.terms || [];
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const isRetryableError = errorMessage.includes('UnknownError') ||
                                 errorMessage.includes('generic failures') ||
                                 errorMessage.includes('timeout') ||
                                 errorMessage.includes('resource');

        if (attempt < maxRetries && isRetryableError) {
          const delay = Math.pow(2, attempt - 1) * 1000; // 1s, 2s, 4s
          logger.warn('AI_SERVICE', `[ChunkTermExtraction] Failed (attempt ${attempt}/${maxRetries}), retrying in ${delay}ms:`, errorMessage);
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          logger.error('AI_SERVICE', `[ChunkTermExtraction] Failed after ${attempt} attempts:`, error);
          return []; // Return empty array on failure
        }
      }
    }

    return []; // Fallback
  }

  /**
   * Generate a definition for a single keyword using RAG + GeminiNano
   * Hybrid approach: retrieves relevant context via search, then generates definition
   */
  async generateDefinitionWithRAG(
    keyword: string,
    paperId: string,
    paperTitle: string,
    contextId: string = 'definition',
    useKeywordOnly: boolean = false
  ): Promise<GlossaryTerm | null> {
    logger.debug('AI_SERVICE', '[Definition] Generating definition for keyword:', keyword);

    try {
      // Step 1: Find relevant chunks
      // Import getPaperChunks for fallback
      const { getPaperChunks } = await import('./dbService.ts');
      const allChunks = await getPaperChunks(paperId);

      if (allChunks.length === 0) {
        logger.warn('AI_SERVICE', '[Definition] No chunks found for paper:', paperId);
        return null;
      }

      let relevantChunks = [];

      // Get adaptive chunk limit based on paper's chunk size
      const { getAdaptiveChunkLimit, trimChunksByTokenBudget } = await import('./adaptiveRAGService.ts');
      const adaptiveLimit = await getAdaptiveChunkLimit(paperId, 'definition');

      // If useKeywordOnly is true, skip semantic search and go straight to keyword search
      // This is faster for exact term matching (e.g., when we already know the exact terms)
      if (useKeywordOnly) {
        logger.debug('AI_SERVICE', '[Definition] Using keyword-only search for:', keyword);
        const { getRelevantChunks } = await import('./dbService.ts');
        relevantChunks = await getRelevantChunks(paperId, keyword, adaptiveLimit);
      } else {
        // Try semantic search via offscreen document if embeddings are available
        const hasEmbeddings = allChunks.some(chunk => chunk.embedding !== undefined);

        if (hasEmbeddings) {
          try {
            logger.debug('AI_SERVICE', '[Definition] Attempting semantic search via offscreen document for keyword:', keyword);

            // Use offscreen service for semantic search (isolates embedding code from background)
            const { searchSemanticOffscreen } = await import('../background/services/offscreenService.ts');
            const searchResult = await searchSemanticOffscreen(paperId, keyword, adaptiveLimit);

            if (searchResult.success && searchResult.chunkIds && searchResult.chunkIds.length > 0) {
              // Map chunk IDs back to chunks
              relevantChunks = searchResult.chunkIds
                .map(chunkId => allChunks.find(c => c.id === chunkId))
                .filter(c => c !== undefined) as any[];

              logger.debug('AI_SERVICE', '[Definition] Found', relevantChunks.length, 'relevant chunks via semantic search');
            } else {
              logger.debug('AI_SERVICE', '[Definition] Semantic search returned no results, falling back to keyword search');
            }
          } catch (error) {
            logger.warn('AI_SERVICE', '[Definition] Semantic search failed, falling back to keyword search:', error);
          }
        }

        // Fallback to keyword search if semantic search didn't work
        if (relevantChunks.length === 0) {
          logger.debug('AI_SERVICE', '[Definition] Using keyword search for:', keyword);
          const { getRelevantChunks } = await import('./dbService.ts');
          relevantChunks = await getRelevantChunks(paperId, keyword, adaptiveLimit);
        }
      }

      // Trim chunks to fit within token budget
      const trimmedChunks = await trimChunksByTokenBudget(relevantChunks, 'definition');

      if (trimmedChunks.length === 0) {
        logger.warn('AI_SERVICE', '[Definition] No relevant chunks found for keyword:', keyword);
        return null;
      }

      // Step 2: Prepare context from relevant chunks with position and hierarchy
      // Format context from chunks with position and hierarchy
      const contextChunks = trimmedChunks.map(chunk => ({
        content: chunk.content,
        section: chunk.section || 'Unknown section',
        index: chunk.index,
        parentSection: chunk.parentSection,
        paragraphIndex: chunk.paragraphIndex,
        sentenceGroupIndex: chunk.sentenceGroupIndex,
      }));

      // Sort chunks by document order (index) for better context
      contextChunks.sort((a, b) => a.index - b.index);

      // Build context string with position and natural boundary hierarchy
      const contextText = contextChunks
        .map((chunk) => {
          // Build hierarchical citation path
          const hierarchy = chunk.parentSection
            ? `${chunk.parentSection} > ${chunk.section}`
            : chunk.section;

          // Add paragraph/sentence info if available (natural boundaries)
          let citation = `[${hierarchy}`;
          if (chunk.paragraphIndex !== undefined) {
            citation += ` > Para ${chunk.paragraphIndex + 1}`;
            if (chunk.sentenceGroupIndex !== undefined) {
              citation += ` > Sentences`;
            }
          }
          citation += `]`;

          return `${citation}\n${chunk.content}`;
        })
        .join('\n\n');

      // Get user's preferred output language
      const outputLanguage = await getOutputLanguage();
      const languageName = getLanguageName(outputLanguage as 'en' | 'es' | 'ja');

      // Step 3: Generate definition using GeminiNano
      const systemPrompt = buildDefinitionPrompt(outputLanguage as 'en' | 'es' | 'ja');

      const input = `IMPORTANT: All definitions, study contexts, and analogies must be in ${languageName}. Keep the term/acronym in its original form, but explain it in ${languageName}.

Paper Title: ${paperTitle}

Define the following term/acronym based on how it is used in this research paper: "${keyword}"

Here are relevant excerpts from the paper:

${contextText}

Provide:
1. The acronym/term (keep it in its original form)
2. The full expanded form (if it's an acronym)
3. A clear, concise definition based on the paper's context
4. An array of study contexts with sections - for each unique way the term is used, provide:
   - context: describe how the term is used in this paper (string)
   - sections: array of section names where this usage appears (array of strings like ["Introduction", "Methods"])
5. A simple analogy to help understand it

Focus on how this term is specifically used in THIS paper.

For mathematical expressions in definitions, contexts, or analogies:
- Use $expression$ for inline math (e.g., $\\alpha$, $n=100$)
- Use $$expression$$ for display equations
- Alternatively use \\(expression\\) for inline, \\[expression\\] for display`;

      // Use the glossary schema for the single term
      const schema = getSchemaForLanguage('glossary', outputLanguage as 'en' | 'es' | 'ja');

      // Modify schema to expect a single term instead of array
      const singleTermSchema = {
        type: "object",
        properties: {
          acronym: { type: "string" },
          longForm: { type: "string" },
          definition: { type: "string" },
          studyContext: {
            type: "array",
            items: {
              type: "object",
              properties: {
                context: { type: "string" },
                sections: {
                  type: "array",
                  items: { type: "string" }
                }
              },
              required: ["context", "sections"]
            }
          },
          analogy: { type: "string" }
        },
        required: ["acronym", "longForm", "definition", "studyContext", "analogy"]
      };

      const languageContextId = `${contextId}-${keyword}-${outputLanguage}`;
      const response = await this.prompt(
        input,
        systemPrompt,
        singleTermSchema as JSONSchema,
        languageContextId,
        [{ type: "text", languages: ["en", "es", "ja"] }],
        [{ type: "text", languages: [outputLanguage || "en"] }],
        0,  // temperature
        3   // topK
      );

      const term = JSON.parse(response) as GlossaryTerm;
      logger.debug('AI_SERVICE', '[Definition] ✓ Definition generated for:', keyword);

      return term;
    } catch (error) {
      logger.error('AI_SERVICE', '[Definition] Error generating definition for keyword:', keyword, error);
      return null;
    }
  }

  /**
   * Retrieve existing session for a context (doesn't create new one)
   * @param contextId - Context ID to look up
   * @returns Existing session or null
   */
  private async getSessionForContext(contextId: string): Promise<AILanguageModelSession | null> {
    return this.sessions.get(contextId) || null;
  }

  /**
   * Prepare glossary context with iterative validation (similar to chat's prepareContextWithValidation)
   * Progressively trims chunks until the prompt fits within token quota
   *
   * @param session - AI session for quota tracking
   * @param keywordContexts - Array of keywords with their RAG chunks
   * @param schema - The glossary schema object
   * @param instructionTemplate - The instruction text for the prompt
   * @param paperTitle - The paper title
   * @param languageName - Output language name (e.g., 'English', 'Spanish')
   * @param maxAttempts - Maximum number of trimming attempts (default: 10)
   * @returns Validated prompt with final keyword contexts OR error message
   */
  private async prepareGlossaryContextWithValidation(
    session: AILanguageModelSession,
    keywordContexts: Array<{ keyword: string; chunks: ContentChunk[] }>,
    schema: JSONSchema,
    instructionTemplate: string,
    paperTitle: string,
    languageName: string,
    maxAttempts: number = 500
  ): Promise<{
    validatedPrompt?: string;
    systemPrompt?: string;
    finalKeywordContexts: Array<{ keyword: string; chunks: ContentChunk[] }>;
    errorMessage?: string;
  }> {
    // Safety check - session must exist
    if (!session) {
      logger.error('AI_SERVICE', '[GlossaryValidation] Session is null - cannot validate');
      return {
        finalKeywordContexts: keywordContexts,
        errorMessage: 'Session not initialized'
      };
    }

    let currentKeywordContexts = keywordContexts;
    const keywords = keywordContexts.map(kc => kc.keyword);

    // Helper function to build the full prompt from keyword contexts
    const buildGlossaryPrompt = (kcs: Array<{ keyword: string; chunks: ContentChunk[] }>) => {
      const keywordContextsFormatted = kcs.map(kc => {
        const contextText = kc.chunks
          .map((chunk, i) => `[Chunk ${i + 1}]\n${chunk.content}`)
          .join('\n\n');

        return {
          keyword: kc.keyword,
          context: contextText || 'No relevant context found'
        };
      });

      const keywordSections = keywordContextsFormatted.map((kc, idx) => {
        return `
TERM ${idx + 1}: "${kc.keyword}"
Relevant excerpts from paper:
${kc.context}
`;
      }).join('\n---\n');

      const input = `IMPORTANT: All definitions, study contexts, and analogies must be in ${languageName}. Keep the term/acronym in its original form, but explain it in ${languageName}.

Paper Title: ${paperTitle}

Define the following ${kcs.length} terms/acronyms based on how they are used in this research paper:

${keywordSections}

For EACH term, provide:
1. The acronym/term (keep it in its original form)
2. The full expanded form (if it's an acronym, otherwise same as term)
3. A clear, concise definition based on the paper's context
4. An array of study contexts with sections - for each unique way the term is used:
   - context: describe how the term is used in this paper (string)
   - sections: array of section names where this usage appears (array of strings like ["Introduction", "Methods"])
5. A simple analogy to help understand it

Focus on how each term is specifically used in THIS paper.
Return an array with ${kcs.length} term definitions in the same order as listed above.

For mathematical expressions in definitions, contexts, or analogies:
- Use $expression$ for inline math (e.g., $\\alpha$, $n=100$)
- Use $$expression$$ for display equations
- Alternatively use \\(expression\\) for inline, \\[expression\\] for display`;

      return input;
    };

    // Iterative validation loop
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      // Build prompt with current keyword contexts
      const prompt = buildGlossaryPrompt(currentKeywordContexts);

      // Validate using actual token measurement
      const validation = await this.validatePromptSize(session, prompt);

      if (validation.fits) {
        logger.debug('AI_SERVICE', `[GlossaryValidation] ✓ Validation passed on attempt ${attempt} (${validation.actualUsage} tokens)`);

        const systemPrompt = `You are a research paper terminology expert who provides clear, accurate definitions for technical terms and acronyms.
When mathematical expressions, equations, or formulas are needed in definitions or contexts:
- Use $expression$ for inline math (e.g., $E = mc^2$, $\\alpha$)
- Use $$expression$$ for display equations on separate lines
- Alternative: \\(expression\\) for inline, \\[expression\\] for display
- Ensure proper LaTeX syntax (e.g., \\frac{a}{b}, \\sum_{i=1}^{n}, Greek letters)
IMPORTANT: All definitions, contexts, and analogies must be in ${languageName}. Keep the term/acronym in its original form, but explain it in ${languageName}.`;

        return {
          validatedPrompt: prompt,
          systemPrompt,
          finalKeywordContexts: currentKeywordContexts
        };
      }

      // Prompt too large - trim chunks progressively
      logger.warn('AI_SERVICE', `[GlossaryValidation] Prompt too large (${validation.actualUsage} > ${validation.available}) on attempt ${attempt}/${maxAttempts}`);

      if (attempt < maxAttempts) {
        // Strategy: Remove 1 chunk from each keyword (distributed trimming)
        // If a keyword has 0 chunks, keep it with no chunks but continue with others
        const totalChunksBefore = currentKeywordContexts.reduce((sum, kc) => sum + kc.chunks.length, 0);

        currentKeywordContexts = currentKeywordContexts.map(kc => ({
          keyword: kc.keyword,
          chunks: kc.chunks.length > 0 ? kc.chunks.slice(0, kc.chunks.length - 1) : []
        }));

        const totalChunksAfter = currentKeywordContexts.reduce((sum, kc) => sum + kc.chunks.length, 0);

        logger.debug('AI_SERVICE', `[GlossaryValidation] Trimmed ${totalChunksBefore - totalChunksAfter} chunks (${totalChunksBefore} → ${totalChunksAfter})`);

        // Check if we've run out of chunks completely
        if (totalChunksAfter === 0) {
          logger.error('AI_SERVICE', '[GlossaryValidation] No chunks remaining after trimming');
          return {
            finalKeywordContexts: currentKeywordContexts,
            errorMessage: 'Insufficient quota for glossary batch. All chunks trimmed but prompt still too large.'
          };
        }
      } else {
        // Final attempt - use minimal chunks (1 chunk per keyword, or 0 if none available)
        logger.warn('AI_SERVICE', `[GlossaryValidation] Max attempts reached, using minimal chunks`);
        currentKeywordContexts = currentKeywordContexts.map(kc => ({
          keyword: kc.keyword,
          chunks: kc.chunks.slice(0, Math.min(1, kc.chunks.length))
        }));
      }
    }

    // Should never reach here, but return error just in case
    return {
      finalKeywordContexts: currentKeywordContexts,
      errorMessage: 'Failed to validate glossary context after all attempts'
    };
  }

  /**
   * Generate definitions for multiple terms in a single prompt call (batch processing)
   * Much more efficient than calling generateDefinitionWithRAG multiple times
   *
   * @param keywords - Array of keywords/terms to define
   * @param paperId - Paper ID for RAG context retrieval
   * @param paperTitle - Title of the paper
   * @param contextId - Context ID for session management
   * @param useKeywordOnly - If true, use keyword search; otherwise use semantic search
   * @returns Array of glossary terms (null entries for failed definitions)
   */
  async generateDefinitionsBatchWithRAG(
    keywords: string[],
    paperId: string,
    paperTitle: string,
    contextId: string = 'definition-batch',
    useKeywordOnly: boolean = false,
    conversationContext?: { summary?: string; recentMessages?: any[] }
  ): Promise<(GlossaryTerm | null)[]> {
    logger.debug('AI_SERVICE', `[DefinitionBatch] Generating definitions for ${keywords.length} terms in single prompt call`);

    try {
      // Get output language once at the beginning
      const outputLanguage = await getOutputLanguage();
      const languageContextId = `${contextId}-${outputLanguage}`;

      // Create session if it doesn't exist (needed for validation)
      await this.getOrCreateSession(languageContextId, {
        expectedInputs: [{ type: "text", languages: ["en"] }],
        expectedOutputs: [{ type: "text", languages: [outputLanguage] }]
      });

      // Get session for quota tracking and validation (use let so we can reassign on timeout)
      let session = await this.getSessionForContext(languageContextId);

      // Session should now exist, but check just in case
      if (!session) {
        logger.error('AI_SERVICE', '[DefinitionBatch] Failed to create session');
        return keywords.map(() => null);
      }

      // Get schema and build instruction template BEFORE fetching chunks
      // This allows accurate token estimation in budget calculation
      const schema = getSchemaForLanguage('glossary', outputLanguage as 'en' | 'es' | 'ja');

      const languageNames: { [key: string]: string } = {
        'en': 'English',
        'es': 'Spanish',
        'ja': 'Japanese'
      };
      const languageName = languageNames[outputLanguage] || 'English';

      // Build instruction template (without actual keyword contexts which vary)
      const instructionTemplate = `IMPORTANT: All definitions, study contexts, and analogies must be in ${languageName}. Keep the term/acronym in its original form, but explain it in ${languageName}.

Paper Title: ${paperTitle}

Define the following ${keywords.length} terms/acronyms based on how they are used in this research paper:

For EACH term, provide:
1. The acronym/term (keep it in its original form)
2. The full expanded form (if it's an acronym, otherwise same as term)
3. A clear, concise definition based on the paper's context
4. An array of study contexts with sections - for each unique way the term is used:
   - context: describe how the term is used in this paper (string)
   - sections: array of section names where this usage appears (array of strings like ["Introduction", "Methods"])
5. A simple analogy to help understand it

Focus on how each term is specifically used in THIS paper.
Return an array with ${keywords.length} term definitions in the same order as listed above.

For mathematical expressions in definitions, contexts, or analogies:
- Use $expression$ for inline math (e.g., $\\alpha$, $n=100$)
- Use $$expression$$ for display equations
- Alternatively use \\(expression\\) for inline, \\[expression\\] for display`;

      // Step 1: Gather RAG context for each keyword (in parallel)
      const { getPaperChunks } = await import('./dbService.ts');
      const allChunks = await getPaperChunks(paperId);

      logger.debug('AI_SERVICE', '[DefinitionBatch] Gathering RAG context for all keywords...');

      // Start with adaptive initial chunk limit (will be validated and trimmed as needed)
      const initialChunksPerKeyword = Math.min(5, Math.max(3, Math.floor(10 / keywords.length)));

      logger.debug('AI_SERVICE', `[DefinitionBatch] Fetching initial ${initialChunksPerKeyword} chunks per keyword (will validate and trim as needed)`);

      // Gather all chunks for all keywords
      const keywordChunks = await Promise.all(
        keywords.map(async (keyword) => {
          let relevantChunks = [];

          // Use keyword-only search if specified
          if (useKeywordOnly) {
            const { getRelevantChunks } = await import('./dbService.ts');
            relevantChunks = await getRelevantChunks(paperId, keyword, initialChunksPerKeyword);
          } else {
            // Try semantic search
            const hasEmbeddings = allChunks.some(chunk => chunk.embedding !== undefined);

            if (hasEmbeddings) {
              try {
                const { searchSemanticOffscreen } = await import('../background/services/offscreenService.ts');
                const searchResult = await searchSemanticOffscreen(paperId, keyword, initialChunksPerKeyword);

                if (searchResult.success && searchResult.chunkIds && searchResult.chunkIds.length > 0) {
                  relevantChunks = searchResult.chunkIds
                    .map(chunkId => allChunks.find(c => c.id === chunkId))
                    .filter(c => c !== undefined) as any[];
                }
              } catch (error) {
                logger.warn('AI_SERVICE', '[DefinitionBatch] Semantic search failed for', keyword);
              }
            }

            // Fallback to keyword search
            if (relevantChunks.length === 0) {
              const { getRelevantChunks } = await import('./dbService.ts');
              relevantChunks = await getRelevantChunks(paperId, keyword, initialChunksPerKeyword);
            }
          }

          return {
            keyword,
            chunks: relevantChunks
          };
        })
      );

      logger.debug('AI_SERVICE', '[DefinitionBatch] ✓ RAG context gathered for all keywords');

      // Step 2: Validate context and trim if needed
      const validationResult = await this.prepareGlossaryContextWithValidation(
        session,
        keywordChunks,
        schema,
        instructionTemplate,
        paperTitle,
        languageName
      );

      // Handle validation failure
      if (validationResult.errorMessage) {
        logger.error('AI_SERVICE', `[DefinitionBatch] Validation failed: ${validationResult.errorMessage}`);
        return keywords.map(() => null);
      }

      // Extract validated prompt and system prompt
      const { validatedPrompt, systemPrompt, finalKeywordContexts } = validationResult;

      if (!validatedPrompt || !systemPrompt) {
        logger.error('AI_SERVICE', '[DefinitionBatch] Validation returned empty prompt or system prompt');
        return keywords.map(() => null);
      }

      const totalChunksUsed = finalKeywordContexts.reduce((sum, kc) => sum + kc.chunks.length, 0);
      logger.debug('AI_SERVICE', `[DefinitionBatch] Using ${totalChunksUsed} total chunks after validation`);

      // Step 3: Generate definitions with retry logic (schema already defined above)
      // Keep retry logic as backup for transient errors (not quota errors - those are handled by validation)
      const maxRetries = 3;
      let lastError: any;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          logger.debug('AI_SERVICE', `[DefinitionBatch] Attempt ${attempt}/${maxRetries} - Generating definitions for ${keywords.length} terms`);

          // Track session usage before call
          const usageBeforeCall = session?.inputUsage || 0;

          // Create 60-second timeout promise for glossarization
          const timeoutPromise = new Promise<string>((_, reject) =>
            setTimeout(() => reject(new Error('GLOSSARIZATION_TIMEOUT')), 60000)
          );

          // Race the prompt call against the timeout
          const promptPromise = this.prompt(
            validatedPrompt,
            systemPrompt,
            schema,
            languageContextId,
            [{ type: "text", languages: ["en"] }],
            [{ type: "text", languages: [outputLanguage] }],
            0,  // temperature
            3   // topK
          );

          // Use the validated prompt with 60s timeout protection
          const response = await Promise.race([promptPromise, timeoutPromise]);

          // Track actual token usage after successful call
          const updatedSession = await this.getSessionForContext(languageContextId);
          const usageAfterCall = updatedSession?.inputUsage || usageBeforeCall;
          const actualTokensUsed = usageAfterCall - usageBeforeCall;

          // Log token usage
          logger.debug('AI_SERVICE', `[DefinitionBatch] Token Usage:
  - Batch size: ${keywords.length} keywords
  - Chunks used: ${totalChunksUsed} chunks
  - Actual tokens used: ${actualTokensUsed} tokens`);

          // Step 4: Parse response
          const parsed = JSON.parse(response);
          const terms = parsed.terms as GlossaryTerm[];

          logger.debug('AI_SERVICE', `[DefinitionBatch] ✓ Successfully generated ${terms.length} definitions on attempt ${attempt}`);
          return terms;

        } catch (error) {
          lastError = error;
          const errorMessage = error instanceof Error ? error.message : String(error);
          const errorLower = errorMessage.toLowerCase();

          // Check if this was a timeout error
          const isTimeoutError = errorMessage === 'GLOSSARIZATION_TIMEOUT' || errorLower.includes('timeout');

          // If timeout occurred, destroy and recreate session before retrying
          if (isTimeoutError && attempt < maxRetries) {
            logger.warn('AI_SERVICE', `[DefinitionBatch] Timeout after 60s (attempt ${attempt}/${maxRetries}). Recreating session...`);

            // Destroy the potentially stuck session
            this.destroySessionForContext(languageContextId);

            // Create a fresh session
            await this.getOrCreateSession(languageContextId, {
              expectedInputs: [{ type: "text", languages: ["en"] }],
              expectedOutputs: [{ type: "text", languages: [outputLanguage] }]
            });

            // Get the new session reference
            session = await this.getSessionForContext(languageContextId);

            if (!session) {
              logger.error('AI_SERVICE', '[DefinitionBatch] Failed to recreate session after timeout');
              break;
            }

            logger.debug('AI_SERVICE', `[DefinitionBatch] Session recreated successfully. Retrying...`);

            // Small delay before retry
            await new Promise(resolve => setTimeout(resolve, 1000));
            continue; // Retry immediately with new session
          }

          // Only retry on transient errors (not quota - validation already handled that)
          const isTransientError = errorLower.includes('unknownerror') ||
                                   errorLower.includes('generic failures') ||
                                   errorLower.includes('resource');

          // If we get a quota error after validation, something is wrong - don't retry
          if (errorLower.includes('quota') || errorLower.includes('input is too large')) {
            logger.error('AI_SERVICE', `[DefinitionBatch] Unexpected quota error after validation: ${errorMessage}`);
            break; // Don't retry quota errors - validation should have prevented this
          }

          if (attempt < maxRetries && isTransientError) {
            const delay = Math.pow(2, attempt - 1) * 1000; // 1s, 2s, 4s
            logger.warn('AI_SERVICE', `[DefinitionBatch] Transient error (attempt ${attempt}/${maxRetries}), retrying in ${delay}ms:`, errorMessage);
            await new Promise(resolve => setTimeout(resolve, delay));
          } else if (!isTransientError) {
            logger.error('AI_SERVICE', '[DefinitionBatch] Non-retryable error, aborting:', errorMessage);
            break;
          } else if (attempt === maxRetries) {
            logger.error('AI_SERVICE', `[DefinitionBatch] Failed on final attempt ${attempt}/${maxRetries}:`, errorMessage);
          }
        }
      }

      // All retries exhausted
      logger.error('AI_SERVICE', `[DefinitionBatch] Failed after ${maxRetries} attempts:`, lastError);
      // Fall through to catch block
      throw lastError;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('AI_SERVICE', '[DefinitionBatch] Error generating batch definitions:', errorMessage);
      logger.error('AI_SERVICE', `[DefinitionBatch] Failed keywords:`, keywords);
      logger.error('AI_SERVICE', `[DefinitionBatch] Context ID:`, contextId);
      logger.error('AI_SERVICE', `[DefinitionBatch] Paper ID:`, paperId);
      // Return array of nulls if batch fails
      return keywords.map(() => null);
    }
  }

  /**
   * Deduplicate a batch of terms using Gemini Nano
   * Handles singular/plural, synonyms, abbreviations intelligently
   *
   * @param terms - Array of terms to deduplicate
   * @param paperTitle - Title of the paper for context
   * @param targetCount - Target number of unique terms to return
   * @param contextId - Context ID for session management
   * @returns Deduplicated array of technical terms
   */
  async deduplicateTermsBatch(
    terms: string[],
    paperTitle: string,
    targetCount: number = 50,
    contextId: string = 'dedupe-batch'
  ): Promise<string[]> {
    logger.debug('AI_SERVICE', '[TermDedupe] Deduplicating', terms.length, 'terms, target:', targetCount);

    // Get user's preferred output language
    const outputLanguage = await getOutputLanguage();
    const languageName = getLanguageName(outputLanguage as 'en' | 'es' | 'ja');

    // Prepare term list
    const termList = terms.join(', ');

    const systemPrompt = buildDeduplicateTermsPrompt(outputLanguage as 'en' | 'es' | 'ja', targetCount);

    const input = `Paper Title: ${paperTitle}

From the following list of technical terms extracted from this paper, deduplicate and select the TOP ${targetCount} MOST IMPORTANT unique terms.

DEDUPLICATION RULES:
1. Singular vs Plural: Choose ONE canonical form
   - Prefer singular unless plural is the standard form
   - Example: "spectrum" vs "spectra" → choose "spectrum"
2. Synonyms: If multiple terms mean the same thing, choose the most common/standard form
3. Abbreviations: Include BOTH abbreviation AND full form IF the abbreviation is commonly used
   - Example: Keep both "CMB" and "cosmic microwave background"
4. Variations: Remove redundant variations (e.g., "power spectrum", "angular power spectrum" → keep the more specific one)

PRIORITIZE:
- Technical terms and scientific terminology (HIGH)
- Acronyms and initialisms (HIGH)
- Domain-specific jargon (HIGH)
- Methodological terms (MEDIUM)
- Frequently appearing terms (HIGH)

Terms to deduplicate:
${termList}

Return exactly ${targetCount} unique, deduplicated terms (or fewer if not enough unique terms exist).
Return ONLY the selected terms as a comma-separated list, in order of importance.
IMPORTANT: Respond in ${languageName} but keep technical terms and acronyms in their original form.`;

    try {
      logger.debug('AI_SERVICE', '[TermDedupe] Sending terms to Gemini Nano for deduplication...');

      const response = await this.prompt(
        input,
        systemPrompt,
        undefined, // No schema - simple text response
        contextId,
        [{ type: "text", languages: ["en", "es", "ja"] }],
        [{ type: "text", languages: [outputLanguage || "en"] }],
        0,  // temperature
        3   // topK
      );

      // Parse comma-separated list
      const deduplicatedTerms = response
        .split(',')
        .map(term => term.trim())
        .filter(term => term.length > 0 && term.length < 100); // Sanity check

      logger.debug('AI_SERVICE', '[TermDedupe] ✓ Deduplicated to', deduplicatedTerms.length, 'unique terms');
      logger.debug('AI_SERVICE', '[TermDedupe] Sample:', deduplicatedTerms.slice(0, 10).join(', '));

      return deduplicatedTerms;
    } catch (error) {
      logger.error('AI_SERVICE', '[TermDedupe] Error deduplicating terms:', error);
      // Fallback: return unique terms (basic dedup)
      logger.warn('AI_SERVICE', '[TermDedupe] Falling back to basic deduplication');
      const uniqueTerms = Array.from(new Set(terms.map(t => t.toLowerCase())))
        .slice(0, targetCount);
      return uniqueTerms;
    }
  }

  /**
   * Create hierarchical summary of entire document using map-reduce approach
   * This ensures full document coverage without losing information to truncation
   *
   * Process:
   * 1. Split document into ~5000 char chunks (with 1000 char overlap)
   * 2. Summarize each chunk in parallel AND extract technical terms
   * 3. Combine chunk summaries
   * 4. Create final meta-summary (~8000 chars)
   *
   * This allows us to process papers of any length while staying within token limits
   *
   * @returns Object with hierarchical summary and array of terms per chunk
   */
  async createHierarchicalSummary(
    fullText: string,
    contextId: string = 'hierarchical-summary',
    onProgress?: (current: number, total: number) => void
  ): Promise<{ summary: string; chunkTerms: string[][] }> {
    logger.debug('AI_SERVICE', '[Hierarchical Summary] Starting hierarchical summarization...');
    logger.debug('AI_SERVICE', '[Hierarchical Summary] Document length:', fullText.length, 'chars');

    // Import chunking utility
    const { chunkContent } = await import('./contentExtractor.ts');

    // Step 1: Split into chunks (5000 chars, 1000 char overlap for speed and context)
    const chunks = chunkContent(fullText, 5000, 1000);
    logger.debug('AI_SERVICE', '[Hierarchical Summary] Split into', chunks.length, 'chunks');

    const chunkSummarySystemPrompt = `You are a research paper summarizer. Create concise summaries that capture key information AND extract technical terms.
CRITICAL:
- Preserve ALL acronyms exactly (e.g., "SES", "RCT", "fMRI")
- Keep technical terminology intact - do NOT paraphrase
- Maintain domain-specific language
- Include acronym definitions if present
- Capture key findings, methods, data
- Extract 5-10 most important technical terms, acronyms, initialisms, and domain-specific jargon a user would need to know to understand this section
For mathematical expressions: use $expression$ for inline math, $$expression$$ for display equations. Use proper LaTeX syntax (\\frac{a}{b}, \\sum, \\alpha, etc.).`;

    // Get chunk summary schema with terms extraction
    const outputLanguage = await getOutputLanguage();
    const chunkSchema = getSchemaForLanguage('chunk-summary', outputLanguage as 'en' | 'es' | 'ja');

    // If document is already small enough, just return a single summary with terms
    if (chunks.length === 1) {
      logger.debug('AI_SERVICE', '[Hierarchical Summary] Document is small, creating single summary with terms');
      const input = `Summarize this research paper content concisely, capturing all important points. Also extract the 5-10 most important technical terms and acronyms:\n\n${fullText.slice(0, 6000)}`;
      const response = await this.prompt(input, chunkSummarySystemPrompt, chunkSchema, contextId);
      const parsed = JSON.parse(response);
      logger.debug('AI_SERVICE', '[Hierarchical Summary] Single summary created:', parsed.summary.length, 'chars,', parsed.terms.length, 'terms');
      return { summary: parsed.summary, chunkTerms: [parsed.terms] };
    }

    // Step 2: Summarize each chunk SEQUENTIALLY with retry logic and progress tracking
    logger.debug('AI_SERVICE', '[Hierarchical Summary] Summarizing chunks sequentially with retry logic...');

    // Report initial progress
    if (onProgress) {
      onProgress(0, chunks.length);
    }

    const chunkResults: Array<{ summary: string; terms: string[] }> = [];

    // Helper function for retry logic with exponential backoff
    const summarizeChunkWithRetry = async (
      chunk: { content: string },
      index: number,
      maxRetries: number = 3
    ): Promise<{ summary: string; terms: string[] }> => {
      const input = `Summarize this section of a research paper, capturing all important points. Also extract the 5-10 most important technical terms and acronyms:\n\n${chunk.content}`;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          const chunkContextId = `${contextId}-chunk-${index}`;
          const response = await this.prompt(input, chunkSummarySystemPrompt, chunkSchema, chunkContextId);
          const parsed = JSON.parse(response);

          logger.debug('AI_SERVICE', `[Hierarchical Summary] Chunk ${index + 1}/${chunks.length} summarized:`, parsed.summary.length, 'chars,', parsed.terms.length, 'terms');

          // Clean up session immediately after successful use
          try {
            await this.destroySessionForContext(chunkContextId);
          } catch (cleanupError) {
            logger.warn('AI_SERVICE', `[Hierarchical Summary] Failed to cleanup session for chunk ${index}:`, cleanupError);
          }

          return { summary: parsed.summary, terms: parsed.terms };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          const isRetryableError = errorMessage.includes('UnknownError') ||
                                   errorMessage.includes('generic failures') ||
                                   errorMessage.includes('timeout') ||
                                   errorMessage.includes('resource');

          if (attempt < maxRetries && isRetryableError) {
            const delay = Math.pow(2, attempt - 1) * 1000; // 1s, 2s, 4s
            logger.warn('AI_SERVICE', `[Hierarchical Summary] Chunk ${index + 1} failed (attempt ${attempt}/${maxRetries}), retrying in ${delay}ms:`, errorMessage);
            await new Promise(resolve => setTimeout(resolve, delay));
          } else {
            logger.error('AI_SERVICE', `[Hierarchical Summary] Chunk ${index + 1} failed after ${attempt} attempts:`, error);
            // Return original chunk content truncated if all retries fail
            return { summary: chunk.content.slice(0, 500), terms: [] };
          }
        }
      }

      // Fallback (shouldn't reach here, but TypeScript needs it)
      return { summary: chunk.content.slice(0, 500), terms: [] };
    };

    // Process chunks sequentially
    for (let i = 0; i < chunks.length; i++) {
      const result = await summarizeChunkWithRetry(chunks[i], i);
      chunkResults.push(result);

      // Report progress after this chunk completes
      if (onProgress) {
        onProgress(i + 1, chunks.length);
      }

      // Add small delay between chunks to prevent resource contention
      if (i < chunks.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 150));
      }
    }

    logger.debug('AI_SERVICE', '[Hierarchical Summary] All chunks summarized and terms extracted');

    // Separate summaries and terms
    const chunkSummaries = chunkResults.map(result => result.summary);
    const chunkTerms = chunkResults.map(result => result.terms);
    logger.debug('AI_SERVICE', '[Hierarchical Summary] Extracted', chunkTerms.flat().length, 'total terms from all chunks');

    // Step 3: Combine chunk summaries
    const combinedSummaries = chunkSummaries.join('\n\n');
    logger.debug('AI_SERVICE', '[Hierarchical Summary] Combined summaries length:', combinedSummaries.length, 'chars');

    // Step 4: Create final meta-summary
    // If combined summaries are small enough, return as-is with terms
    if (combinedSummaries.length <= 8000) {
      logger.debug('AI_SERVICE', '[Hierarchical Summary] Combined summaries already compact');
      return { summary: combinedSummaries, chunkTerms };
    }

    // Otherwise, create a meta-summary
    logger.debug('AI_SERVICE', '[Hierarchical Summary] Creating meta-summary from', chunkSummaries.length, 'chunk summaries...');
    const metaSystemPrompt = `You are a research paper summarizer.
Create a comprehensive but concise summary from multiple section summaries.
CRITICAL:
- Preserve ALL acronyms and technical terminology exactly
- Do NOT paraphrase specialized terms
- Maintain term consistency across sections
- Include methodology, findings, results, conclusions
For mathematical expressions: use $expression$ for inline math, $$expression$$ for display equations. Use proper LaTeX syntax (\\frac{a}{b}, \\sum, \\alpha, etc.).
`;
    const metaInput = `Create a comprehensive summary of this research paper from these section summaries. Capture all key findings, methodology, results, and conclusions:\n\n${combinedSummaries.slice(0, 20000)}`;

    try {
      const finalSummary = await this.prompt(metaInput, metaSystemPrompt, undefined, `${contextId}-meta`);
      logger.debug('AI_SERVICE', '[Hierarchical Summary] ✓ Meta-summary created:', finalSummary.length, 'chars');
      return { summary: finalSummary, chunkTerms };
    } catch (error) {
      logger.error('AI_SERVICE', '[Hierarchical Summary] Meta-summary failed, returning truncated combined summaries:', error);
      // Fallback to truncated combined summaries
      return { summary: combinedSummaries.slice(0, 8000) + '...', chunkTerms };
    }
  }

  /**
   * Summarize conversation history using Summarizer API
   * Takes a list of messages and creates a concise summary
   * @param messages Array of chat messages to summarize
   * @param paperTitle Optional paper title for context
   * @returns Summary string or null if summarization fails
   */
  async summarizeConversation(
    messages: ChatMessage[],
    paperTitle?: string
  ): Promise<string | null> {
    try {
      logger.debug('AI_SERVICE', '[Conversation Summarizer] Starting summarization of', messages.length, 'messages');

      // Format messages as conversation text
      const conversationText = messages
        .map(msg => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`)
        .join('\n\n');

      // Create summarizer with conversation-appropriate settings
      const summarizer = await this.createSummarizer({
        type: 'tldr',
        format: 'plain-text',
        length: 'medium',
        sharedContext: paperTitle ? `Research paper discussion: ${paperTitle}` : 'Research paper discussion',
      });

      if (!summarizer) {
        logger.warn('AI_SERVICE', '[Conversation Summarizer] Failed to create summarizer');
        return null;
      }

      // Generate summary
      const summary = await summarizer.summarize(conversationText);
      summarizer.destroy();

      logger.debug('AI_SERVICE', '[Conversation Summarizer] ✓ Summary created:', summary.length, 'chars');
      return summary;
    } catch (error) {
      logger.error('AI_SERVICE', '[Conversation Summarizer] Error summarizing conversation:', error);
      return null;
    }
  }

  /**
   * Get session metadata including token usage
   * @param contextId Context ID for the session
   * @returns SessionMetadata or null if session doesn't exist or data unavailable
   */
  getSessionMetadata(contextId: string): SessionMetadata | null {
    try {
      const session = this.sessions.get(contextId);
      if (!session) {
        logger.warn('AI_SERVICE', `[Session Metadata] No session found for context: ${contextId}`);
        return null;
      }

      // Safely access session properties with defensive checks
      // These properties might be undefined or throw errors depending on session state
      let inputUsage = 0;
      let inputQuota = 0;

      try {
        inputUsage = session.inputUsage ?? 0;
        inputQuota = session.inputQuota ?? 0;
      } catch (propertyError) {
        logger.warn('AI_SERVICE', '[Session Metadata] Could not access session usage properties:', propertyError);
        // Continue with default values (0)
      }

      const usagePercentage = inputQuota > 0 ? (inputUsage / inputQuota) * 100 : 0;
      const needsSummarization = usagePercentage >= 80;

      const metadata: SessionMetadata = {
        inputUsage,
        inputQuota,
        usagePercentage,
        lastChecked: Date.now(),
        needsSummarization,
      };

      // Store metadata
      this.sessionMetadata.set(contextId, metadata);

      logger.debug('AI_SERVICE', `[Session Metadata] ${contextId}:`, {
        usage: inputUsage,
        quota: inputQuota,
        percentage: usagePercentage.toFixed(2) + '%',
        needsSummarization,
      });

      return metadata;
    } catch (error) {
      logger.error('AI_SERVICE', '[Session Metadata] Error getting session metadata:', error);
      return null;
    }
  }

  /**
   * Clone a session with conversation history
   * Used when token usage approaches limit - resets tokens while preserving context
   * @param contextId Context ID for the session to clone
   * @param conversationState Current conversation state (summary + recent messages)
   * @param systemPrompt System prompt for the session
   * @param options Additional session options
   * @returns New cloned session
   */
  async cloneSessionWithHistory(
    contextId: string,
    conversationState: ConversationState,
    systemPrompt: string,
    options?: AISessionOptions
  ): Promise<AILanguageModelSession> {
    logger.debug('AI_SERVICE', '[Session Clone] Cloning session for', contextId);
    logger.debug('AI_SERVICE', '[Session Clone] Conversation state:', {
      hasSummary: !!conversationState.summary,
      recentMessages: conversationState.recentMessages.length,
    });

    // Build initialPrompts array with system prompt, summary, and recent messages
    // Combine system prompt and conversation summary into single system message
    // (Prompt API only allows one system message at the first position)
    let systemPromptContent = systemPrompt;
    if (conversationState.summary) {
      systemPromptContent += `\n\nPrevious conversation summary: ${conversationState.summary}`;
    }

    const initialPrompts: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: systemPromptContent }
    ];

    // Add recent messages
    for (const msg of conversationState.recentMessages) {
      initialPrompts.push({
        role: msg.role,
        content: msg.content
      });
    }

    logger.debug('AI_SERVICE', '[Session Clone] Creating new session with', initialPrompts.length, 'initial prompts');

    // Destroy old session
    const oldSession = this.sessions.get(contextId);
    if (oldSession) {
      try {
        oldSession.destroy();
      } catch (error) {
        logger.warn('AI_SERVICE', '[Session Clone] Error destroying old session:', error);
      }
    }

    // Get output language if not already in options
    const outputLanguage = await getOutputLanguage();

    // Create new session with conversation history
    const newSession = await LanguageModel.create({
      ...options,
      initialPrompts,
      expectedInputs: [{ type: 'text', languages: ["en", "es", "ja"] }],
      expectedOutputs: [{ type: 'text', languages: [outputLanguage || "en"] }],
    });

    // Update session map
    this.sessions.set(contextId, newSession);

    // Reset metadata
    this.sessionMetadata.delete(contextId);

    logger.debug('AI_SERVICE', '[Session Clone] ✓ Session cloned successfully');
    return newSession;
  }

  /**
   * Clear retry count for a specific URL
   * Useful for forcing a fresh attempt
   */
  clearRetries(url?: string) {
    if (url) {
      this.extractionRetries.delete(url);
    } else {
      // Clear all retries
      this.extractionRetries.clear();
    }
  }

  /**
   * Legacy method - destroy session (for backward compatibility)
   * @deprecated Use destroySessionForContext instead
   */
  destroySession() {
    // Destroy the default session if it exists
    this.destroySessionForContext('default');
  }
}

// Export singleton instance
export const aiService = new ChromeAIService();
