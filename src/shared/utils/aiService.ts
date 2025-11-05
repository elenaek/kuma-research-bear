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
import { buildSimplifyTextPrompt } from '../../shared/prompts/templates/simplification.ts';
import { buildExplainTermPrompt, buildExplainAbstractPrompt, buildImageExplanationPrompt } from '../../shared/prompts/templates/explanation.ts';
import { buildSummaryPrompt } from '../../shared/prompts/templates/summary.ts';
import { buildMetadataExtractionPrompt } from '../../shared/prompts/templates/extraction.ts';
import { buildMethodologyAnalysisPrompt, buildConfounderAnalysisPrompt, buildImplicationAnalysisPrompt, buildLimitationAnalysisPrompt } from '../../shared/prompts/templates/analysis.ts';
import { buildQAPrompt } from '../../shared/prompts/templates/qa.ts';
import { buildJSONRepairPrompt, buildJSONRepairInput } from '../../shared/prompts/templates/utility.ts';
import { buildExtractTermsPrompt, buildExtractChunkTermsPrompt, buildDefinitionPrompt, buildDeduplicateTermsPrompt } from '../../shared/prompts/templates/glossary.ts';
import { getLanguageName, getLanguageInstruction } from '../../shared/prompts/components/language.ts';
import { getVerbosity } from '../utils/settingsService.ts';
import type { PromptLanguage } from '../../shared/prompts/types.ts';

// Import AI core modules
import {
  AISessionManager,
  PromptExecutor,
  JSONRepairService,
  ConversationManager,
  LanguageService,
  HierarchicalSummarizationOrchestrator,
  AnalysisOrchestrator,
  GlossaryOrchestrator,
  ExplanationStrategy,
  SummaryStrategy,
  MetadataExtractionStrategy,
  QAStrategy,
  ImageExplanationStrategy,
} from '../../core/ai/index.ts';

/**
 * Utility: Sleep for a specified duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Configuration for prompt timeout and retry behavior
 */
export interface PromptTimeoutConfig {
  /** Timeout duration in milliseconds (default: 60000ms = 60s) */
  timeoutMs?: number;
  /** Maximum number of retry attempts (default: 2) */
  maxRetries?: number;
  /** Delay between retries in milliseconds (default: 1000ms = 1s) */
  retryDelayMs?: number;
  /** Whether to destroy and recreate session on timeout (default: true) */
  recreateSessionOnTimeout?: boolean;
}

/**
 * Chrome AI Service for interacting with Chrome's built-in AI APIs
 * Uses the stable Prompt API (Chrome 138+)
 * Supports concurrent sessions for multiple tabs/contexts
 */
class ChromeAIService {
  // Core service fields
  private capabilities: AICapabilities | null = null;

  // Token estimation constant: ~500 chars average / 4 chars per token = 125 tokens
  private readonly ESTIMATED_TOKENS_PER_CHUNK = 125;

  // Validation safety threshold: match summarization threshold at 80% to prevent quota exceeded errors
  // This ensures sufficient buffer for Chrome AI streaming overhead
  private readonly VALIDATION_SAFETY_THRESHOLD = 0.80;

  // AI core modules
  private sessionManager: AISessionManager;
  private promptExecutor: PromptExecutor;
  private jsonRepairService: JSONRepairService;
  private conversationManager: ConversationManager;
  private languageService: LanguageService;
  private hierarchicalSummarizationOrchestrator: HierarchicalSummarizationOrchestrator;
  private analysisOrchestrator: AnalysisOrchestrator;
  private glossaryOrchestrator: GlossaryOrchestrator;

  // AI Strategies
  private explanationStrategy: ExplanationStrategy;
  private summaryStrategy: SummaryStrategy;
  private metadataExtractionStrategy: MetadataExtractionStrategy;
  private qaStrategy: QAStrategy;
  private imageExplanationStrategy: ImageExplanationStrategy;

  constructor() {
    // Initialize refactored modules
    this.sessionManager = new AISessionManager();
    this.promptExecutor = new PromptExecutor(this.sessionManager);
    this.jsonRepairService = new JSONRepairService(this.sessionManager, this.promptExecutor);
    this.conversationManager = new ConversationManager(
      this.sessionManager,
      this.createSummarizer.bind(this) // Bind to preserve 'this' context
    );
    this.languageService = new LanguageService();
    this.hierarchicalSummarizationOrchestrator = new HierarchicalSummarizationOrchestrator(
      this.sessionManager,
      this.promptExecutor
    );
    this.analysisOrchestrator = new AnalysisOrchestrator(this.sessionManager, this.promptExecutor);
    this.glossaryOrchestrator = new GlossaryOrchestrator(this.sessionManager, this.promptExecutor);

    // Initialize strategies
    this.explanationStrategy = new ExplanationStrategy(this.promptExecutor, this.sessionManager);
    this.summaryStrategy = new SummaryStrategy(this.promptExecutor, this.sessionManager);
    this.metadataExtractionStrategy = new MetadataExtractionStrategy(
      this.promptExecutor,
      this.sessionManager,
      this.jsonRepairService,
      this.checkAvailability.bind(this)
    );
    this.qaStrategy = new QAStrategy(this.promptExecutor, this.sessionManager);
    this.imageExplanationStrategy = new ImageExplanationStrategy(
      this.promptExecutor,
      this.sessionManager,
      this.checkMultimodalAvailability.bind(this)
    );
  }

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
   *
   * Delegates to LanguageService
   */
  async checkLanguageDetectorAvailability(): Promise<{ available: boolean; availability: AIAvailability }> {
    return this.languageService.checkAvailability();
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
      let supportsImages = false;
      if (availability === 'available') {
        try {
          // Get output language with fallback
          let outputLanguage = 'en';
          try {
            outputLanguage = await getOutputLanguage() || 'en';
          } catch (error) {
            logger.warn('AI_SERVICE', '[Multimodal] Failed to get output language, using default "en":', error);
          }

          const testSession = await LanguageModel.create({
            expectedInputs: [{ type: 'image', languages: ["en", "es", "ja"] }],
            expectedOutputs: [{ type: 'text', languages: [outputLanguage] }],
            temperature: 0.0,
            topK: 1
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
  /**
   * Explain an image from a research paper
   *
   * Delegates to ImageExplanationStrategy
   */
  async explainImage(
    imageBlob: Blob,
    paperTitle: string,
    paperAbstract: string,
    contextId: string = 'default'
  ): Promise<{ title: string; explanation: string } | null> {
    return this.imageExplanationStrategy.explainImage(imageBlob, paperTitle, paperAbstract, contextId);
  }

  /**
   * Detect the language of a text using Chrome's Language Detector API
   *
   * Delegates to LanguageService
   *
   * @param text Text to detect language from (title, abstract, etc.)
   * @returns ISO 639-1 language code (e.g., 'en', 'es', 'fr') or null if detection fails
   */
  async detectLanguage(text: string): Promise<string | null> {
    return this.languageService.detectLanguage(text);
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

      if(!sessionOptions?.temperature) {
        sessionOptions = {
          ...sessionOptions,
          temperature: 0.0
        };
      }
      if(!sessionOptions?.topK) {
        sessionOptions = {
          ...sessionOptions,
          topK: 1
        };
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

      // Register with session manager
      this.sessionManager.registerSession(contextId, session);

      logger.debug('AI_SERVICE', `[AI] Session created successfully. Total sessions: ${this.sessionManager.getSessionCount()}`);
      return session;
    } catch (error) {
      logger.error('AI_SERVICE', `[AI] Error creating session for context ${contextId}:`, error);
      throw error;
    }
  }

  /**
   * Destroy a session for a specific context
   *
   * Delegates to sessionManager for all session cleanup
   */
  async destroySessionForContext(contextId: string): Promise<void> {
    // Delegate to sessionManager for session destruction
    // This handles: session.destroy(), sessions Map cleanup, metadata cleanup, and abort controllers
    await this.sessionManager.destroySession(contextId);

    logger.debug('AI_SERVICE', `[AI] Session cleanup completed for context: ${contextId}`);
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
   * Now includes automatic timeout protection with configurable retry logic
   */
  /**
   * Execute prompt with timeout and retry logic
   *
   * NOTE: This method maintains the original aiService API while delegating to PromptExecutor.
   * It handles session creation with aiService-specific logic (language settings, systemPrompt conversion)
   * that AISessionManager doesn't handle yet.
   *
   * Delegates to PromptExecutor for timeout/retry, with custom retry logic
   * for session recreation.
   */
  async prompt(
    input: string,
    systemPrompt?: string,
    responseConstraint?: JSONSchema,
    contextId: string = 'default',
    expectedInputs: Array<{ type: string; languages: string[] }> = [{ type: 'text', languages: ["en", "es", "ja"] }],
    expectedOutputs: Array<{ type: string; languages: string[] }> = [{ type: 'text', languages: ["en"] }],
    temperature: number = 0.0,
    topK: number = 1,
    timeoutConfig?: PromptTimeoutConfig
  ): Promise<string> {
    // Merge timeout config with defaults
    const config: Required<PromptTimeoutConfig> = {
      timeoutMs: timeoutConfig?.timeoutMs ?? 60000,
      maxRetries: timeoutConfig?.maxRetries ?? 2,
      retryDelayMs: timeoutConfig?.retryDelayMs ?? 1000,
      recreateSessionOnTimeout: timeoutConfig?.recreateSessionOnTimeout ?? true
    };

    logger.debug('PROMPT_ENGINEERING', '[Prompt] contextId:', contextId);
    logger.debug('PROMPT_ENGINEERING', '[Prompt] expectedOutputs:', JSON.stringify(expectedOutputs));

    let lastError: any;

    // Retry loop (handles session recreation)
    for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
      try {
        // Ensure session exists with correct options
        // Only include defined properties to avoid passing undefined to Chrome API
        const sessionOpts: AISessionOptions = {};
        if (systemPrompt !== undefined) sessionOpts.systemPrompt = systemPrompt;
        if (expectedInputs !== undefined) sessionOpts.expectedInputs = expectedInputs;
        if (expectedOutputs !== undefined) sessionOpts.expectedOutputs = expectedOutputs;
        if (temperature !== undefined) sessionOpts.temperature = temperature;
        if (topK !== undefined) sessionOpts.topK = topK;

        await this.getOrCreateSession(contextId, sessionOpts);

        // Delegate to PromptExecutor (single attempt, no retry at this level)
        return await this.promptExecutor.executeWithTimeout(
          contextId,
          input,
          { timeoutMs: config.timeoutMs, maxRetries: 1, retryDelayMs: 0, recreateSessionOnTimeout: false },
          { responseConstraint }
        );

      } catch (error: any) {
        lastError = error;

        // Check if it was a timeout
        const isTimeout = error.message?.includes('PROMPT_TIMEOUT') || error.message?.includes('timeout');

        if (isTimeout && attempt < config.maxRetries) {
          logger.warn('AI_SERVICE', `[Prompt] Timeout on attempt ${attempt}/${config.maxRetries}`);

          // Optionally destroy and recreate session
          if (config.recreateSessionOnTimeout) {
            logger.debug('AI_SERVICE', `[Prompt] Recreating session for context: ${contextId}`);
            await this.destroySessionForContext(contextId);
          }

          // Wait before retry
          logger.debug('AI_SERVICE', `[Prompt] Waiting ${config.retryDelayMs}ms before retry...`);
          await sleep(config.retryDelayMs);

          continue;
        }

        // Not a timeout or final attempt - throw
        throw error;
      }
    }

    // All retries exhausted
    logger.error('AI_SERVICE', `[Prompt] Failed after ${config.maxRetries} attempts for context ${contextId}`);
    throw lastError;
  }

  /**
   * Fix malformed JSON by asking AI to correct it
   * Used when initial JSON parsing fails
   *
   * Delegates to JSONRepairService
   */
  async fixMalformedJSON(malformedJson: string, contextId: string = 'default'): Promise<string> {
    return this.jsonRepairService.repairJSON(malformedJson, contextId);
  }

  /**
   * Explain a research paper abstract
   * Optionally uses hierarchical summary for comprehensive explanation of large papers
   *
   * Delegates to ExplanationStrategy
   */
  async explainAbstract(
    abstract: string,
    contextId: string = 'default',
    hierarchicalSummary?: string
  ): Promise<ExplanationResult> {
    return this.explanationStrategy.explainAbstract(abstract, contextId, hierarchicalSummary);
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

    // Fall back to Prompt API - delegate to SummaryStrategy
    logger.debug('AI_SERVICE', '[Summary] Using Prompt API for summary generation');
    return this.summaryStrategy.generateSummary(title, abstract, contextId, hierarchicalSummary);
  }

  /**
   * Explain a technical term
   */
  async explainTerm(term: string, context?: string, contextId: string = 'default'): Promise<string> {
    const systemPrompt = buildExplainTermPrompt();

    const input = context
      ? `Explain the term "${term}" in the context of: ${context}`
      : `Explain the term "${term}" in simple terms`;

    return await this.prompt(input, systemPrompt, undefined, contextId, undefined, undefined, 0.0, 1);
  }

  /**
   * Simplify a section of text
   */
  async simplifyText(text: string, contextId: string = 'default'): Promise<string> {
    const systemPrompt = buildSimplifyTextPrompt();

    const input = `Rewrite this text in simpler terms:\n\n${text}`;

    return await this.prompt(input, systemPrompt, undefined, contextId, undefined, undefined, 0.0, 1);
  }

  /**
   * Extract structured paper metadata from content using AI
   * This is the core method for intelligent paper detection
   * Implements exponential backoff with max 3 retries
   *
   * Delegates to MetadataExtractionStrategy
   */
  async extractPaperMetadata(content: string, contextId: string = 'extraction'): Promise<any> {
    return this.metadataExtractionStrategy.extractPaperMetadata(content, contextId);
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
      const response = await this.prompt(input, systemPrompt, undefined, contextId, undefined, undefined, 0.0, 1);

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
      await this.destroyAllSessions();
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
  private async destroyAllSessions(): Promise<void> {
    await this.sessionManager.destroyAllSessions();
  }

  /**
   * Analyze paper methodology
   * Examines study design, data collection, sample size, and statistical methods
   * Uses hierarchical summary + RAG to find relevant methodology sections
   *
   * Delegates to AnalysisOrchestrator
   */
  async analyzeMethodology(
    paperId: string,
    hierarchicalSummary: string,
    contextId: string = 'analysis'
  ): Promise<MethodologyAnalysis> {
    return this.analysisOrchestrator.analyzeMethodology(paperId, hierarchicalSummary, contextId);
  }

  /**
   * Identify confounders and biases
   * Looks for potential confounding variables and methodological biases
   * Uses hierarchical summary + RAG to find relevant sections
   *
   * Delegates to AnalysisOrchestrator
   */
  async identifyConfounders(
    paperId: string,
    hierarchicalSummary: string,
    contextId: string = 'analysis'
  ): Promise<ConfounderAnalysis> {
    return this.analysisOrchestrator.identifyConfounders(paperId, hierarchicalSummary, contextId);
  }

  /**
   * Analyze implications and applications
   * Identifies real-world applications and significance
   * Uses hierarchical summary + RAG to find relevant sections
   *
   * Delegates to AnalysisOrchestrator
   */
  async analyzeImplications(
    paperId: string,
    hierarchicalSummary: string,
    contextId: string = 'analysis'
  ): Promise<ImplicationAnalysis> {
    return this.analysisOrchestrator.analyzeImplications(paperId, hierarchicalSummary, contextId);
  }

  /**
   * Identify limitations
   * Extracts and explains study limitations and constraints
   * Uses hierarchical summary + RAG to find relevant sections
   *
   * Delegates to AnalysisOrchestrator
   */
  async identifyLimitations(
    paperId: string,
    hierarchicalSummary: string,
    contextId: string = 'analysis'
  ): Promise<LimitationAnalysis> {
    return this.analysisOrchestrator.identifyLimitations(paperId, hierarchicalSummary, contextId);
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
   *
   * Delegates to QAStrategy
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
    return this.qaStrategy.answerQuestion(question, contextChunks, contextId);
  }

  /**
   * Extract technical terms from truncated paper text using Gemini
   * Simple fallback for legacy papers without pre-extracted chunk terms
   */
  /**
   * Extract technical terms from full text using Gemini Nano
   *
   * Delegates to GlossaryOrchestrator
   *
   * @param text - Text to extract terms from
   * @param paperTitle - Paper title for context
   * @param contextId - Context ID for session management
   * @param targetCount - Number of terms to extract
   * @returns Array of extracted terms
   */
  async extractTermsFromText(
    text: string,
    paperTitle: string,
    contextId: string = 'extract-terms',
    targetCount: number = 50
  ): Promise<string[]> {
    return this.glossaryOrchestrator.extractTermsFromText(text, paperTitle, contextId, targetCount);
  }

  /**
   * Extract technical terms from a single chunk using structured schema
   * Used for on-demand term extraction when glossarization is triggered
   *
   * Delegates to GlossaryOrchestrator
   *
   * @param chunkContent - Content of the chunk to extract terms from
   * @param paperTitle - Paper title for context
   * @param contextId - Context ID for session management
   * @param termCount - Number of terms to extract
   * @returns Array of extracted terms
   */
  async extractTermsFromChunk(
    chunkContent: string,
    paperTitle: string,
    contextId: string = 'extract-chunk-terms',
    termCount: number = 10
  ): Promise<string[]> {
    return this.glossaryOrchestrator.extractTermsFromChunk(chunkContent, paperTitle, contextId, termCount);
  }

  /**
   * Generate a definition for a single keyword using RAG + GeminiNano
   * Hybrid approach: retrieves relevant context via search, then generates definition
   *
   * Delegates to GlossaryOrchestrator
   *
   * @param keyword - Term to define
   * @param paperId - Paper ID for RAG
   * @param paperTitle - Paper title for context
   * @param contextId - Context ID for session management
   * @param useKeywordOnly - Use keyword search instead of semantic
   * @returns Glossary term or null if generation fails
   */
  async generateDefinitionWithRAG(
    keyword: string,
    paperId: string,
    paperTitle: string,
    contextId: string = 'definition',
    useKeywordOnly: boolean = false
  ): Promise<GlossaryTerm | null> {
    return this.glossaryOrchestrator.generateDefinitionWithRAG(
      keyword,
      paperId,
      paperTitle,
      contextId,
      useKeywordOnly
    );
  }

  /**
   * Retrieve existing session for a context (doesn't create new one)
   * @param contextId - Context ID to look up
   * @returns Existing session or null
   */
  getSessionForContext(contextId: string): AILanguageModelSession | null {
    return this.sessionManager.getSession(contextId);
  }

  /**
   * Generate definitions for multiple terms in a single prompt call (batch processing)
   * Much more efficient than calling generateDefinitionWithRAG multiple times
   *
   * Delegates to GlossaryOrchestrator
   *
   * @param keywords - Array of keywords/terms to define
   * @param paperId - Paper ID for RAG context retrieval
   * @param paperTitle - Title of the paper
   * @param contextId - Context ID for session management
   * @param useKeywordOnly - If true, use keyword search; otherwise use semantic search
   * @param conversationContext - (Legacy parameter, ignored by orchestrator)
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
    return this.glossaryOrchestrator.generateDefinitionsBatch(
      keywords,
      paperId,
      paperTitle,
      contextId,
      useKeywordOnly
    );
  }

  /**
   * Deduplicate a batch of terms using Gemini Nano
   * Handles singular/plural, synonyms, abbreviations intelligently
   *
   * Delegates to GlossaryOrchestrator
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
    return this.glossaryOrchestrator.deduplicateTermsBatch(terms, paperTitle, targetCount, contextId);
  }

  /**
   * Create hierarchical summary of entire document using map-reduce approach
   * This ensures full document coverage without losing information to truncation
   *
   * Process:
   * 1. Split document into ~5000 char chunks (with 1000 char overlap)
   * 2. Summarize each chunk sequentially AND extract technical terms
   * 3. Combine chunk summaries
   * 4. Create final meta-summary (~8000 chars)
   *
   * This allows us to process papers of any length while staying within token limits
   *
   * Delegates to HierarchicalSummarizationOrchestrator
   *
   * @returns Object with hierarchical summary and array of terms per chunk
   */
  async createHierarchicalSummary(
    fullText: string,
    contextId: string = 'hierarchical-summary',
    onProgress?: (current: number, total: number) => void
  ): Promise<{ summary: string; chunkTerms: string[][] }> {
    return this.hierarchicalSummarizationOrchestrator.createSummary(fullText, contextId, onProgress);
  }

  /**
   * Summarize conversation history using Summarizer API
   * Takes a list of messages and creates a concise summary
   *
   * Delegates to ConversationManager
   *
   * @param messages Array of chat messages to summarize
   * @param paperTitle Optional paper title for context
   * @returns Summary string or null if summarization fails
   */
  async summarizeConversation(
    messages: ChatMessage[],
    paperTitle?: string
  ): Promise<string | null> {
    return this.conversationManager.summarizeConversation(messages, paperTitle);
  }

  /**
   * Get session metadata including token usage
   * @param contextId Context ID for the session
   * @returns SessionMetadata or null if session doesn't exist or data unavailable
   */
  getSessionMetadata(contextId: string): SessionMetadata | null {
    try {
      const session = this.sessionManager.getSession(contextId);
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
   *
   * Delegates to ConversationManager
   *
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
    return this.conversationManager.cloneSessionWithHistory(contextId, conversationState, systemPrompt, options);
  }

  /**
   * Clear retry count for a specific URL
   * Useful for forcing a fresh attempt
   */
  /**
   * Clear retry tracking for metadata extraction
   *
   * Delegates to MetadataExtractionStrategy
   */
  clearRetries(url?: string) {
    this.metadataExtractionStrategy.clearRetries(url);
  }

  /**
   * Legacy method - destroy session (for backward compatibility)
   * @deprecated Use destroySessionForContext instead
   */
  async destroySession(): Promise<void> {
    // Destroy the default session if it exists
    await this.destroySessionForContext('default');
  }
}

// Export singleton instance
export const aiService = new ChromeAIService();
