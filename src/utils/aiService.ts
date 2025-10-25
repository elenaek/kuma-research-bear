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
import { getOutputLanguage } from './settingsService.ts';
import { getOptimalRAGChunkCount } from './adaptiveRAGService.ts';

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
        console.warn('Could not fetch AI params:', paramsError);
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
      console.error('Error checking AI availability:', error);
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
        console.log('[Summarizer] API not available (typeof Summarizer === undefined)');
        return {
          available: false,
          availability: 'no',
          model: 'Gemini Nano',
        };
      }

      const availability: AIAvailability = await Summarizer.availability();
      console.log('[Summarizer] API availability:', availability);

      return {
        available: availability === 'available',
        availability,
        model: 'Gemini Nano',
      };
    } catch (error) {
      console.error('[Summarizer] Error checking availability:', error);
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
        console.log('[LanguageDetector] API not available (typeof LanguageDetector === undefined)');
        return {
          available: false,
          availability: 'no',
        };
      }

      const availability: AIAvailability = await LanguageDetector.availability();
      console.log('[LanguageDetector] API availability:', availability);

      return {
        available: availability === 'available',
        availability,
      };
    } catch (error) {
      console.error('[LanguageDetector] Error checking availability:', error);
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
        console.log('[Multimodal] API not available (typeof LanguageModel === undefined)');
        return {
          available: false,
          availability: 'no',
          model: 'Gemini Nano',
          supportsImages: false,
        };
      }

      const availability: AIAvailability = await LanguageModel.availability();
      console.log('[Multimodal] API availability:', availability);

      // Multimodal capabilities are only available in origin trial
      // We need to try creating a session with image inputs to check support
      let supportsImages = false;
      if (availability === 'available') {
        try {
          const testSession = await LanguageModel.create({
            expectedInputs: [{ type: 'image' }],
          });
          supportsImages = true;
          testSession.destroy();
          console.log('[Multimodal] Image input support confirmed');
        } catch (error) {
          console.log('[Multimodal] Image input not supported:', error);
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
      console.error('[Multimodal] Error checking availability:', error);
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
      console.log('[ImageExplain] Starting image explanation for paper:', paperTitle);

      // Check multimodal availability first
      const { available } = await this.checkMultimodalAvailability();
      if (!available) {
        console.warn('[ImageExplain] Multimodal API not available');
        return null;
      }

      // Get user's preferred output language
      const outputLanguage = await getOutputLanguage();
      console.log('[ImageExplain] Using output language:', outputLanguage);

      // Import schema for structured output
      const { imageExplanationSchema } = await import('../schemas/analysisSchemas.ts');

      // Create a session with image input support
      const session = await LanguageModel.create({
        temperature: 0.7,
        topK: 40,
        expectedInputs: [{ type: 'image' }],
        systemPrompt: `You are an expert research assistant helping readers understand scientific figures and images in research papers. Provide clear, concise explanations of images in the context of the paper.`,
      });

      console.log('[ImageExplain] Session created, sending image...');

      // Use append() method to send multimodal content
      await session.append([
        {
          role: 'user',
          content: [
            {
              type: 'text',
              value: `This image is from the research paper titled "${paperTitle}".

Paper abstract: ${paperAbstract}

Please analyze this image and provide:
1. A concise title (3-7 words) describing what the image shows
2. A detailed explanation covering:
   - What the image depicts (chart, diagram, photo, etc.)
   - Key findings or information shown
   - How it relates to the paper's research
   - Any important trends, patterns, or notable elements

Keep the explanation concise (2-3 paragraphs) and accessible to readers who may not be experts in the field.

FORMATTING INSTRUCTIONS:
- Use markdown formatting (headers, bold, italic, lists, etc.) to structure your explanation
- For mathematical equations, formulas, or variables, use LaTeX notation:
  * Inline math: $equation$ (e.g., $E = mc^2$)
  * Display math: $$equation$$ (e.g., $$\\frac{1}{2}mv^2$$)
- Use code blocks for algorithms or code snippets
- Use bullet points or numbered lists for clarity

Respond in ${outputLanguage === 'en' ? 'English' : outputLanguage === 'es' ? 'Spanish' : outputLanguage === 'ja' ? 'Japanese' : 'English'}.`,
            },
            {
              type: 'image',
              value: imageBlob,
            },
          ],
        },
      ]);

      // Use structured output with responseConstraint
      const response = await session.prompt('Please explain this image.', {
        responseConstraint: imageExplanationSchema,
      });

      console.log('[ImageExplain] Raw response:', response);

      // Parse JSON response
      const parsed = JSON.parse(response);

      console.log('[ImageExplain] Explanation generated successfully');
      console.log('[ImageExplain] Title:', parsed.title);

      // Cleanup
      session.destroy();

      return {
        title: parsed.title,
        explanation: parsed.explanation,
      };
    } catch (error) {
      console.error('[ImageExplain] Error generating image explanation:', error);

      // Try to extract partial data if JSON parsing failed but we got a response
      if (error instanceof SyntaxError && typeof error === 'object') {
        console.warn('[ImageExplain] JSON parsing failed, using fallback');
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
        console.warn('[LanguageDetector] Empty text provided');
        return null;
      }

      // Check availability first
      const { available } = await this.checkLanguageDetectorAvailability();
      if (!available) {
        console.warn('[LanguageDetector] API not available, falling back to "en"');
        return 'en'; // Default to English if detector unavailable
      }

      console.log('[LanguageDetector] Detecting language for text (length:', text.length, ')');

      // Create detector and detect language
      const detector = await LanguageDetector.create();
      const results = await detector.detect(text);

      // Cleanup detector
      detector.destroy();

      // Get the most confident result
      if (results && results.length > 0) {
        const topResult = results[0];
        console.log('[LanguageDetector] Detected language:', topResult.detectedLanguage,
                    'with confidence:', topResult.confidence);
        return topResult.detectedLanguage;
      }

      console.warn('[LanguageDetector] No language detected, falling back to "en"');
      return 'en';
    } catch (error) {
      console.error('[LanguageDetector] Error detecting language:', error);
      return 'en'; // Default to English on error
    }
  }

  /**
   * Create a summarizer session with specified options
   */
  async createSummarizer(options: SummarizerOptions): Promise<AISummarizer | null> {
    try {
      if (typeof Summarizer === 'undefined') {
        console.error('[Summarizer] API not available');
        return null;
      }

      console.log('[Summarizer] Creating summarizer with options:', options);
      const summarizer = await Summarizer.create(options);
      console.log('[Summarizer] Summarizer created successfully');
      return summarizer;
    } catch (error) {
      console.error('[Summarizer] Error creating summarizer:', error);
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
      console.log('[Summarizer] Starting summary generation for:', title);

      // Get user's preferred output language
      const outputLanguage = await getOutputLanguage();
      console.log('[Summarizer] Using output language:', outputLanguage);

      // Create tldr summarizer for quick summary
      const tldrSummarizer = await this.createSummarizer({
        type: 'tldr',
        format: 'markdown',
        length: 'long',
        sharedContext: `Research paper: ${title}`,
        expectedInputLanguages: ['en'],
        outputLanguage: outputLanguage
      });

      if (!tldrSummarizer) {
        console.warn('[Summarizer] Failed to create tldr summarizer');
        return null;
      }

      // Create key-points summarizer for key points
      const keyPointsSummarizer = await this.createSummarizer({
        type: 'key-points',
        format: 'markdown',
        length: 'long',
        sharedContext: `Research paper: ${title}`,
        expectedInputLanguages: ['en'],
        outputLanguage: outputLanguage
      });

      if (!keyPointsSummarizer) {
        console.warn('[Summarizer] Failed to create key-points summarizer');
        tldrSummarizer.destroy();
        return null;
      }

      // Generate both summaries in parallel
      console.log('[Summarizer] Generating summaries...');
      const [tldrResult, keyPointsResult] = await Promise.all([
        tldrSummarizer.summarize(abstract, { context: title }),
        keyPointsSummarizer.summarize(abstract, { context: title })
      ]);

      console.log('[Summarizer] tldr result:', tldrResult);
      console.log('[Summarizer] key-points result:', keyPointsResult);

      // Clean up summarizers
      tldrSummarizer.destroy();
      keyPointsSummarizer.destroy();

      // Parse key points from markdown bullet list
      const keyPoints = keyPointsResult
        .split('\n')
        .filter(line => line.trim().startsWith('-') || line.trim().startsWith('*'))
        .map(line => line.replace(/^[-*]\s*/, '').trim())
        .filter(point => point.length > 0);

      console.log('[Summarizer] ✓ Summary generated successfully using Summarizer API');
      console.log('[Summarizer] Summary:', tldrResult);
      console.log('[Summarizer] Key points:', keyPoints);

      return {
        summary: tldrResult,
        keyPoints: keyPoints.length > 0 ? keyPoints : ['No key points extracted'],
        timestamp: Date.now(),
        generatedBy: 'summarizer-api'
      };
    } catch (error) {
      console.error('[Summarizer] Error generating summary:', error);
      return null;
    }
  }

  /**
   * Get or create a session for a specific context (tab)
   * Creates a fresh session for each operation
   * Converts deprecated systemPrompt to initialPrompts format
   */
  async getOrCreateSession(contextId: string, options?: AISessionOptions): Promise<AILanguageModelSession> {
    // Always create a new session - simpler and more reliable
    try {
      if (typeof LanguageModel === 'undefined') {
        throw new Error('Prompt API not available');
      }

      console.log(`[AI] Creating new session for context: ${contextId}`);

      // Convert systemPrompt to initialPrompts if present (new API format)
      let sessionOptions = options;
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

      const session = await LanguageModel.create(sessionOptions);

      this.sessions.set(contextId, session);
      console.log(`[AI] Session created successfully. Total sessions: ${this.sessions.size}`);
      return session;
    } catch (error) {
      console.error(`[AI] Error creating session for context ${contextId}:`, error);
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
        console.log(`[AI] Session destroyed for context: ${contextId}`);
      } catch (error) {
        console.error(`[AI] Error destroying session for context ${contextId}:`, error);
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
  async createSession(options?: AISessionOptions): Promise<boolean> {
    try {
      // Use a default context for legacy calls
      await this.getOrCreateSession('default', options);
      return true;
    } catch (error) {
      console.error('Error creating AI session:', error);
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

      const fits = actualUsage <= available;

      console.log(`[Prompt Validation] Actual usage: ${actualUsage}, Available: ${available}/${quota}, Fits: ${fits}`);

      return {
        fits,
        actualUsage,
        quota,
        available
      };
    } catch (error) {
      console.error('[Prompt Validation] Error measuring input usage:', error);

      // Fallback: estimate if measureInputUsage() fails
      const estimatedUsage = Math.ceil(prompt.length / 4);
      const quota = session.inputQuota ?? 0;
      const currentUsage = session.inputUsage ?? 0;
      const available = quota - currentUsage;

      return {
        fits: estimatedUsage <= available,
        actualUsage: estimatedUsage,
        quota,
        available,
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
  ): Promise<string> {
    try {
      console.log('[Prompt] contextId:', contextId);
      console.log('[Prompt] expectedOutputs:', JSON.stringify(expectedOutputs));

      // Get or create session for this context
      const session = await this.getOrCreateSession(contextId, { systemPrompt, expectedInputs, expectedOutputs });

      // Create abort controller for this request
      const abortController = new AbortController();

      // Cancel any existing request for this context
      const existingController = this.activeRequests.get(contextId);
      if (existingController) {
        console.log(`[AI] Cancelling existing request for context: ${contextId}`);
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
          console.log(`[AI] Request aborted for context: ${contextId}`);
          throw new Error('AI request was cancelled');
        }

        throw error;
      }
    } catch (error) {
      console.error(`[AI] Error prompting AI for context ${contextId}:`, error);
      throw error;
    }
  }

  /**
   * Fix malformed JSON by asking AI to correct it
   * Used when initial JSON parsing fails
   */
  async fixMalformedJSON(malformedJson: string, contextId: string = 'default'): Promise<string> {
    const systemPrompt = `You are a JSON validator and fixer. Your job is to take malformed JSON and return valid, properly escaped JSON.`;

    const input = `The following JSON has syntax errors (likely improperly escaped strings). Fix it and return ONLY valid JSON with properly escaped strings:

${malformedJson}

Important:
- Escape all quotes in strings with \\"
- Escape all newlines as \\n
- Escape all backslashes as \\\\
- Return ONLY the corrected JSON, no explanations or markdown`;

    try {
      const response = await this.prompt(input, systemPrompt, undefined, contextId);
      return response.trim();
    } catch (error) {
      console.error('Failed to fix malformed JSON:', error);
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
    console.log('[ExplainAbstract] Output language:', outputLanguage);

    // Get language name for instructions
    const languageNames: { [key: string]: string } = {
      'en': 'English',
      'es': 'Spanish',
      'ja': 'Japanese'
    };
    const languageName = languageNames[outputLanguage] || 'English';

    const systemPrompt = `You are a helpful research assistant that explains complex academic papers in simple terms.
Your goal is to make research papers accessible to people without specialized knowledge.
Break down technical jargon, use analogies when helpful, and focus on the key insights.
Use markdown formatting to enhance readability (bold for key terms, bullet points for lists, etc.).
When mathematical expressions, equations, or formulas are needed:
- Use $expression$ for inline math (e.g., $E = mc^2$)
- Use $$expression$$ for display equations on separate lines
- Alternative: \\(expression\\) for inline, \\[expression\\] for display
- Ensure proper LaTeX syntax (e.g., \\frac{a}{b}, \\sum_{i=1}^{n}, \\alpha, \\beta)
IMPORTANT: Respond in ${languageName}. Your entire explanation must be in ${languageName}.`;

    // If hierarchical summary is provided, use it for richer context
    let input: string;
    if (hierarchicalSummary) {
      console.log('[Explain] Using hierarchical summary for comprehensive explanation');
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
### What are the key assumptions orp remises of the approach?
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
      console.log('[Explain] Using abstract only (standard approach)');
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
      [{ type: "text", languages: ["en"] }],  // expectedInputs
      [{ type: "text", languages: [outputLanguage] }]  // expectedOutputs
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
      console.log('[Summary] Checking Summarizer API availability...');
      const summarizerCapabilities = await this.checkSummarizerAvailability();

      if (summarizerCapabilities.available) {
        console.log('[Summary] Summarizer API available, using it for summary generation');
        const summarizerResult = await this.generateSummaryWithSummarizer(title, abstract, contextId);

        if (summarizerResult) {
          console.log('[Summary] ✓ Successfully generated summary with Summarizer API');
          return summarizerResult;
        } else {
          console.warn('[Summary] Summarizer API failed, falling back to Prompt API');
        }
      } else {
        console.log(`[Summary] Summarizer API not available (${summarizerCapabilities.availability}), using Prompt API`);
      }
    } else {
      console.log('[Summary] Using Prompt API for hierarchical summary (better for full paper analysis)');
    }

    // Fall back to Prompt API
    console.log('[Summary] Using Prompt API for summary generation');
    const systemPrompt = `You are a research assistant that creates concise summaries of academic papers.
Extract the most important information and present it clearly.
Use markdown formatting to enhance readability.
For mathematical expressions: use $expression$ for inline math, $$expression$$ for display equations, or \\(expression\\)/\\[expression\\]. Use proper LaTeX syntax (\\frac{a}{b}, \\sum, \\alpha, etc.).`;

    // If hierarchical summary is provided, use it for comprehensive summary
    let input: string;
    if (hierarchicalSummary) {
      console.log('[Summary] Using hierarchical summary for comprehensive key points');
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
      console.log('[Summary] Using abstract only (standard approach)');
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

    console.log('[Summary] ✓ Successfully generated summary with Prompt API');
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
    const systemPrompt = `You are a helpful assistant that explains technical and scientific terms in simple language.`;

    const input = context
      ? `Explain the term "${term}" in the context of: ${context}`
      : `Explain the term "${term}" in simple terms`;

    return await this.prompt(input, systemPrompt, undefined, contextId);
  }

  /**
   * Simplify a section of text
   */
  async simplifyText(text: string, contextId: string = 'default'): Promise<string> {
    const systemPrompt = `You are a helpful assistant that rewrites complex academic text in simple, clear language
while preserving the original meaning.
For mathematical expressions: use $expression$ for inline math, $$expression$$ for display equations. Use proper LaTeX syntax (\\frac{a}{b}, \\alpha, \\sum, etc.).`;

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
      console.log(`⚠️ AI extraction skipped: AI status is "${capabilities.availability}"`);

      if (capabilities.availability === 'downloadable') {
        console.log('💡 Tip: Click "Initialize AI" button in the extension popup to download the AI model (one-time setup)');
      } else if (capabilities.availability === 'downloading') {
        console.log('⏳ AI model is currently downloading. AI extraction will work automatically once download completes.');
      } else if (capabilities.availability === 'unavailable') {
        console.log('❌ Chrome AI has crashed. Open extension popup for recovery instructions.');
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
      console.warn(`AI extraction failed after ${maxRetries} attempts for ${url}`);
      this.extractionRetries.delete(url); // Reset for next time
      return null;
    }

    // If this is a retry, apply exponential backoff
    if (currentRetries > 0) {
      const delay = baseDelay * Math.pow(2, currentRetries - 1);
      console.log(`Retry ${currentRetries}/${maxRetries} - waiting ${delay}ms before retry...`);
      await sleep(delay);
    }

    // Increment retry count
    this.extractionRetries.set(url, currentRetries + 1);

    // Check content length and warn if too large
    if (content.length > 10000) {
      console.warn(`[AI] Content is very large (${content.length} chars). Consider pre-cleaning or truncating before calling AI.`);
    }

    // Truncate content to ~2000 tokens max to stay within context limits
    const maxChars = 8000; // ~2000 tokens
    const truncatedContent = content.slice(0, maxChars);

    const systemPrompt = `You are a research paper metadata extraction expert.
Extract structured information from academic papers and return it as valid JSON.
Be accurate and only extract information that is clearly present in the text.`;

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
      console.log(`Attempting AI extraction (attempt ${currentRetries + 1}/${maxRetries})...`);
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
        console.warn('JSON parse failed, asking AI to fix...', parseError);

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
          console.log('✓ AI successfully fixed malformed JSON');
        } catch (fixError) {
          // Both attempts failed
          console.error('AI could not fix malformed JSON:', fixError);
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
      console.log('AI extraction successful!');

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
      console.error(`AI extraction attempt ${currentRetries + 1} failed:`, error);

      // If we haven't hit max retries, try again
      if (currentRetries + 1 < maxRetries) {
        console.log(`Will retry with exponential backoff...`);
        return await this.extractPaperMetadata(content, contextId);
      }

      // Max retries exceeded
      console.error(`AI extraction failed after ${maxRetries} attempts`);
      this.extractionRetries.delete(url); // Reset for next time
      return null;
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
      console.log('Initializing AI...');

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
      const created = await this.createSession({
        systemPrompt: 'You are a helpful research assistant.',
      });

      if (created) {
        console.log('✓ AI initialized successfully!');
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
      console.error('Error initializing AI:', error);
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
      console.log('[AI Reset] Attempting to reset crashed AI...');

      // Step 1: Destroy all existing sessions
      this.destroyAllSessions();
      console.log('[AI Reset] ✓ Destroyed all sessions');

      // Step 2: Clear all retry counts
      this.clearRetries();
      console.log('[AI Reset] ✓ Cleared retry counts');

      // Step 3: Clear cached capabilities
      this.capabilities = null;
      console.log('[AI Reset] ✓ Cleared capabilities cache');

      // Step 4: Check current AI availability
      const capabilities = await this.checkAvailability();
      console.log(`[AI Reset] AI availability after reset: ${capabilities.availability}`);

      if (capabilities.availability === 'available') {
        // AI is now available - try to create a session
        const created = await this.createSession({
          systemPrompt: 'You are a helpful research assistant.',
        });

        if (created) {
          console.log('[AI Reset] ✓ AI reset successful!');
          return {
            success: true,
            message: 'AI reset successful! Kuma is back and ready to help.',
          };
        } else {
          console.log('[AI Reset] ⚠️ AI available but session creation failed');
          return {
            success: false,
            message: 'AI is available but session creation failed. Try again.',
          };
        }
      } else if (capabilities.availability === 'downloadable') {
        console.log('[AI Reset] AI needs to be downloaded');
        return {
          success: true,
          message: 'AI reset complete. Click "Wake Kuma up" to initialize.',
        };
      } else if (capabilities.availability === 'downloading') {
        console.log('[AI Reset] AI is downloading');
        return {
          success: true,
          message: 'AI reset complete. Model is downloading...',
        };
      } else if (capabilities.availability === 'unavailable') {
        console.log('[AI Reset] ❌ AI still unavailable after reset');
        return {
          success: false,
          message: 'AI is still crashed. Chrome restart may be required.',
        };
      } else {
        console.log('[AI Reset] ❌ AI not supported on this device');
        return {
          success: false,
          message: 'Chrome AI is not available on this device.',
        };
      }
    } catch (error) {
      console.error('[AI Reset] Error during reset:', error);
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

    // Get language name for instructions
    const languageNames: { [key: string]: string } = {
      'en': 'English',
      'es': 'Spanish',
      'ja': 'Japanese'
    };
    const languageName = languageNames[outputLanguage] || 'English';

    const systemPrompt = `You are a research methodology expert. Analyze research papers for their study design, methods, and rigor.
For mathematical expressions: use $expression$ for inline math, $$expression$$ for display equations. Use proper LaTeX syntax (\\frac{a}{b}, \\sum, \\alpha, etc.).
IMPORTANT: Respond in ${languageName}. All your analysis must be in ${languageName}.`;

    try {
      // Import RAG function (semantic search with keyword fallback)
      const { getRelevantChunksByTopicSemantic } = await import('./dbService.ts');

      // Find relevant chunks for methodology using semantic search (adaptive limit)
      const topics = ['methodology', 'methods', 'design', 'procedure', 'participants', 'sample', 'statistical'];
      const chunkLimit = await getOptimalRAGChunkCount('analysis');
      const relevantChunks = await getRelevantChunksByTopicSemantic(paperId, topics, chunkLimit);

      // Combine hierarchical summary + relevant chunks
      const chunksText = relevantChunks.map(chunk => chunk.content).join('\n\n---\n\n');

      const context = `FULL PAPER SUMMARY:
${hierarchicalSummary}

DETAILED METHODOLOGY SECTIONS:
${chunksText}`;

      const input = `IMPORTANT: You must respond entirely in ${languageName}. All analysis must be in ${languageName}.

Analyze the methodology of this research paper using the full paper summary and detailed methodology sections below.

${context}

Provide a comprehensive analysis of the study design, methods, and rigor.`;

      console.log('[Methodology Analysis] Using', relevantChunks.length, 'chunks + hierarchical summary');

      // Include language in context ID to ensure separate sessions per language
      const languageContextId = `${contextId}-${outputLanguage}`;

      // Get schema with language-appropriate descriptions
      const schema = getSchemaForLanguage('methodology', outputLanguage as 'en' | 'es' | 'ja');

      const response = await this.prompt(
        input,
        systemPrompt,
        schema,
        languageContextId,
        [{ type: "text", languages: ["en"] }],  // expectedInputs
        [{ type: "text", languages: [outputLanguage] }]  // expectedOutputs
      );
      return JSON.parse(response);
    } catch (error) {
      console.error('Methodology analysis failed:', error);
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

    // Get language name for instructions
    const languageNames: { [key: string]: string } = {
      'en': 'English',
      'es': 'Spanish',
      'ja': 'Japanese'
    };
    const languageName = languageNames[outputLanguage] || 'English';

    const systemPrompt = `You are a research quality expert specializing in identifying biases and confounding variables.
For mathematical expressions: use $expression$ for inline math, $$expression$$ for display equations. Use proper LaTeX syntax (\\frac{a}{b}, \\sum, \\alpha, etc.).
IMPORTANT: Respond in ${languageName}. All your analysis must be in ${languageName}.`;

    try {
      // Import RAG function (semantic search with keyword fallback)
      const { getRelevantChunksByTopicSemantic } = await import('./dbService.ts');

      // Find relevant chunks for confounders/biases using semantic search (adaptive limit)
      const topics = ['bias', 'confound', 'limitation', 'control', 'random', 'blinding', 'selection'];
      const chunkLimit = await getOptimalRAGChunkCount('analysis');
      const relevantChunks = await getRelevantChunksByTopicSemantic(paperId, topics, chunkLimit);

      // Combine hierarchical summary + relevant chunks
      const chunksText = relevantChunks.map(chunk => chunk.content).join('\n\n---\n\n');

      const context = `FULL PAPER SUMMARY:
${hierarchicalSummary}

DETAILED SECTIONS (Methods, Limitations, Discussion):
${chunksText}`;

      const input = `IMPORTANT: You must respond entirely in ${languageName}. All analysis must be in ${languageName}.

Identify potential confounders and biases in this research paper using the full paper summary and detailed sections below.

${context}

Provide a comprehensive analysis of confounders, biases, and control measures.`;

      console.log('[Confounder Analysis] Using', relevantChunks.length, 'chunks + hierarchical summary');

      // Include language in context ID to ensure separate sessions per language
      const languageContextId = `${contextId}-${outputLanguage}`;

      // Get schema with language-appropriate descriptions
      const schema = getSchemaForLanguage('confounder', outputLanguage as 'en' | 'es' | 'ja');

      const response = await this.prompt(
        input,
        systemPrompt,
        schema,
        languageContextId,
        [{ type: "text", languages: ["en"] }],  // expectedInputs
        [{ type: "text", languages: [outputLanguage] }]  // expectedOutputs
      );
      return JSON.parse(response);
    } catch (error) {
      console.error('Confounder analysis failed:', error);
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

    // Get language name for instructions
    const languageNames: { [key: string]: string } = {
      'en': 'English',
      'es': 'Spanish',
      'ja': 'Japanese'
    };
    const languageName = languageNames[outputLanguage] || 'English';

    const systemPrompt = `You are a research impact expert who identifies practical applications and significance of research.
For mathematical expressions: use $expression$ for inline math, $$expression$$ for display equations. Use proper LaTeX syntax (\\frac{a}{b}, \\sum, \\alpha, etc.).
IMPORTANT: Respond in ${languageName}. All your analysis must be in ${languageName}.`;

    try {
      // Import RAG function (semantic search with keyword fallback)
      const { getRelevantChunksByTopicSemantic } = await import('./dbService.ts');

      // Find relevant chunks for implications using semantic search (adaptive limit)
      const topics = ['implication', 'application', 'significance', 'discussion', 'conclusion', 'impact', 'future'];
      const chunkLimit = await getOptimalRAGChunkCount('analysis');
      const relevantChunks = await getRelevantChunksByTopicSemantic(paperId, topics, chunkLimit);

      // Combine hierarchical summary + relevant chunks
      const chunksText = relevantChunks.map(chunk => chunk.content).join('\n\n---\n\n');

      const context = `FULL PAPER SUMMARY:
${hierarchicalSummary}

DETAILED SECTIONS (Results, Discussion, Conclusions):
${chunksText}`;

      const input = `IMPORTANT: You must respond entirely in ${languageName}. All analysis must be in ${languageName}.

Analyze the implications of this research paper using the full paper summary and detailed sections below.

${context}

Provide a comprehensive analysis of real-world applications, significance, and future research directions.`;

      console.log('[Implications Analysis] Using', relevantChunks.length, 'chunks + hierarchical summary');

      // Include language in context ID to ensure separate sessions per language
      const languageContextId = `${contextId}-${outputLanguage}`;

      // Get schema with language-appropriate descriptions
      const schema = getSchemaForLanguage('implication', outputLanguage as 'en' | 'es' | 'ja');

      const response = await this.prompt(
        input,
        systemPrompt,
        schema,
        languageContextId,
        [{ type: "text", languages: ["en"] }],  // expectedInputs
        [{ type: "text", languages: [outputLanguage] }]  // expectedOutputs
      );
      return JSON.parse(response);
    } catch (error) {
      console.error('Implications analysis failed:', error);
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

    // Get language name for instructions
    const languageNames: { [key: string]: string } = {
      'en': 'English',
      'es': 'Spanish',
      'ja': 'Japanese'
    };
    const languageName = languageNames[outputLanguage] || 'English';

    const systemPrompt = `You are a research critique expert who identifies limitations and constraints in studies.
For mathematical expressions: use $expression$ for inline math, $$expression$$ for display equations. Use proper LaTeX syntax (\\frac{a}{b}, \\sum, \\alpha, etc.).
IMPORTANT: Respond in ${languageName}. All your analysis must be in ${languageName}.`;

    try {
      // Import RAG function (semantic search with keyword fallback)
      const { getRelevantChunksByTopicSemantic } = await import('./dbService.ts');

      // Find relevant chunks for limitations using semantic search (adaptive limit)
      const topics = ['limitation', 'constraint', 'weakness', 'generalizability', 'caveat', 'shortcoming'];
      const chunkLimit = await getOptimalRAGChunkCount('analysis');
      const relevantChunks = await getRelevantChunksByTopicSemantic(paperId, topics, chunkLimit);

      // Combine hierarchical summary + relevant chunks
      const chunksText = relevantChunks.map(chunk => chunk.content).join('\n\n---\n\n');

      const context = `FULL PAPER SUMMARY:
${hierarchicalSummary}

DETAILED SECTIONS (Limitations, Discussion):
${chunksText}`;

      const input = `IMPORTANT: You must respond entirely in ${languageName}. All analysis must be in ${languageName}.

Identify the limitations of this research paper using the full paper summary and detailed sections below.

${context}

Provide a comprehensive analysis of study limitations and generalizability.`;

      console.log('[Limitations Analysis] Using', relevantChunks.length, 'chunks + hierarchical summary');

      // Include language in context ID to ensure separate sessions per language
      const languageContextId = `${contextId}-${outputLanguage}`;

      // Get schema with language-appropriate descriptions
      const schema = getSchemaForLanguage('limitation', outputLanguage as 'en' | 'es' | 'ja');

      const response = await this.prompt(
        input,
        systemPrompt,
        schema,
        languageContextId,
        [{ type: "text", languages: ["en"] }],  // expectedInputs
        [{ type: "text", languages: [outputLanguage] }]  // expectedOutputs
      );
      return JSON.parse(response);
    } catch (error) {
      console.error('Limitations analysis failed:', error);
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
    contextId: string = 'analysis'
  ): Promise<PaperAnalysisResult> {
    console.log('Starting comprehensive paper analysis with hierarchical summary + RAG...');

    // Run all analyses in parallel with unique sub-contexts
    const [methodology, confounders, implications, limitations] = await Promise.all([
      this.analyzeMethodology(paperId, hierarchicalSummary, `${contextId}-methodology`),
      this.identifyConfounders(paperId, hierarchicalSummary, `${contextId}-confounders`),
      this.analyzeImplications(paperId, hierarchicalSummary, `${contextId}-implications`),
      this.identifyLimitations(paperId, hierarchicalSummary, `${contextId}-limitations`),
    ]);

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
    console.log('Answering question using RAG...');

    // Get user's preferred output language
    const outputLanguage = await getOutputLanguage();

    // Get language name for instructions
    const languageNames: { [key: string]: string } = {
      'en': 'English',
      'es': 'Spanish',
      'ja': 'Japanese'
    };
    const languageName = languageNames[outputLanguage] || 'English';

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

    const systemPrompt = `You are Kuma, a helpful research assistant. Answer questions about research papers based ONLY on the provided context.
Be accurate, cite which sections you used, and if the context doesn't contain enough information to answer, say so clearly.
Use markdown formatting to make your answers more readable and well-structured.
When mathematical expressions, equations, or formulas are needed:
- Use $expression$ for inline math (e.g., $E = mc^2$, $p < 0.05$)
- Use $$expression$$ for display equations on separate lines
- Alternative: \\(expression\\) for inline, \\[expression\\] for display
- Ensure proper LaTeX syntax (e.g., \\frac{a}{b}, \\sum_{i=1}^{n}, Greek letters like \\alpha, \\beta)
IMPORTANT: Respond in ${languageName}. Your entire answer must be in ${languageName}.`;

    // Include language in context ID to ensure separate sessions per language
    const languageContextId = `${contextId}-${outputLanguage}`;

    // Create session first for validation
    const session = await this.getOrCreateSession(languageContextId, {
      systemPrompt,
      expectedInputs: [{ type: "text", languages: ["en"] }],
      expectedOutputs: [{ type: "text", languages: [outputLanguage] }]
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
        console.log(`[Q&A] ✓ Prompt validation passed on attempt ${attempt} (${validation.actualUsage} tokens)`);
        break;
      }

      // Prompt too large - try trimming more chunks
      console.warn(`[Q&A] Prompt too large (${validation.actualUsage} > ${validation.available}), trimming chunks... (attempt ${attempt}/${MAX_RETRIES})`);

      if (attempt >= MAX_RETRIES) {
        // Last attempt - use minimal chunks (just 1-2 most relevant)
        console.error(`[Q&A] Max retries reached, using minimal chunks`);
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
        [{ type: "text", languages: ["en"] }],  // expectedInputs
        [{ type: "text", languages: [outputLanguage] }]  // expectedOutputs
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
      console.error('Question answering failed:', error);
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
    console.log('[TermExtraction] Extracting terms from', text.length, 'chars of text');

    // Truncate to ~10k characters
    const truncatedText = text.slice(0, 10000);

    // Get user's preferred output language
    const outputLanguage = await getOutputLanguage();
    const languageNames: { [key: string]: string } = {
      'en': 'English',
      'es': 'Spanish',
      'ja': 'Japanese'
    };
    const languageName = languageNames[outputLanguage] || 'English';

    const systemPrompt = `You are a research paper expert who identifies important technical terms and acronyms for glossaries.
IMPORTANT: Return your response in ${languageName}.`;

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
      console.log('[TermExtraction] Sending text to Gemini Nano for term extraction...');

      const response = await this.prompt(
        input,
        systemPrompt,
        undefined, // No schema - simple text response
        contextId,
        [{ type: "text", languages: ["en"] }],
        [{ type: "text", languages: [outputLanguage] }]
      );

      // Parse comma-separated list
      const extractedTerms = response
        .split(',')
        .map(term => term.trim())
        .filter(term => term.length > 0 && term.length < 100); // Sanity check

      console.log('[TermExtraction] ✓ Extracted', extractedTerms.length, 'terms');
      console.log('[TermExtraction] Sample terms:', extractedTerms.slice(0, 10).join(', '));

      return extractedTerms;
    } catch (error) {
      console.error('[TermExtraction] Failed to extract terms:', error);
      return [];
    }
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
    console.log('[Definition] Generating definition for keyword:', keyword);

    try {
      // Step 1: Find relevant chunks
      // Import getPaperChunks for fallback
      const { getPaperChunks } = await import('./dbService.ts');
      const allChunks = await getPaperChunks(paperId);

      if (allChunks.length === 0) {
        console.warn('[Definition] No chunks found for paper:', paperId);
        return null;
      }

      let relevantChunks = [];

      // Get adaptive chunk limit based on paper's chunk size
      const { getAdaptiveChunkLimit, trimChunksByTokenBudget } = await import('./adaptiveRAGService.ts');
      const adaptiveLimit = await getAdaptiveChunkLimit(paperId, 'definition');

      // If useKeywordOnly is true, skip semantic search and go straight to keyword search
      // This is faster for exact term matching (e.g., when we already know the exact terms)
      if (useKeywordOnly) {
        console.log('[Definition] Using keyword-only search for:', keyword);
        const { getRelevantChunks } = await import('./dbService.ts');
        relevantChunks = await getRelevantChunks(paperId, keyword, adaptiveLimit);
      } else {
        // Try semantic search via offscreen document if embeddings are available
        const hasEmbeddings = allChunks.some(chunk => chunk.embedding !== undefined);

        if (hasEmbeddings) {
          try {
            console.log('[Definition] Attempting semantic search via offscreen document for keyword:', keyword);

            // Use offscreen service for semantic search (isolates embedding code from background)
            const { searchSemanticOffscreen } = await import('../background/services/offscreenService.ts');
            const searchResult = await searchSemanticOffscreen(paperId, keyword, adaptiveLimit);

            if (searchResult.success && searchResult.chunkIds && searchResult.chunkIds.length > 0) {
              // Map chunk IDs back to chunks
              relevantChunks = searchResult.chunkIds
                .map(chunkId => allChunks.find(c => c.id === chunkId))
                .filter(c => c !== undefined) as any[];

              console.log('[Definition] Found', relevantChunks.length, 'relevant chunks via semantic search');
            } else {
              console.log('[Definition] Semantic search returned no results, falling back to keyword search');
            }
          } catch (error) {
            console.warn('[Definition] Semantic search failed, falling back to keyword search:', error);
          }
        }

        // Fallback to keyword search if semantic search didn't work
        if (relevantChunks.length === 0) {
          console.log('[Definition] Using keyword search for:', keyword);
          const { getRelevantChunks } = await import('./dbService.ts');
          relevantChunks = await getRelevantChunks(paperId, keyword, adaptiveLimit);
        }
      }

      // Trim chunks to fit within token budget
      const trimmedChunks = await trimChunksByTokenBudget(relevantChunks, 'definition');

      if (trimmedChunks.length === 0) {
        console.warn('[Definition] No relevant chunks found for keyword:', keyword);
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
      const languageNames: { [key: string]: string } = {
        'en': 'English',
        'es': 'Spanish',
        'ja': 'Japanese'
      };
      const languageName = languageNames[outputLanguage] || 'English';

      // Step 3: Generate definition using GeminiNano
      const systemPrompt = `You are a research paper terminology expert who provides clear, accurate definitions for technical terms and acronyms.
When mathematical expressions, equations, or formulas are needed in definitions or contexts:
- Use $expression$ for inline math (e.g., $E = mc^2$, $\\alpha$)
- Use $$expression$$ for display equations on separate lines
- Alternative: \\(expression\\) for inline, \\[expression\\] for display
- Ensure proper LaTeX syntax (e.g., \\frac{a}{b}, \\sum_{i=1}^{n}, Greek letters)
IMPORTANT: All definitions, contexts, and analogies must be in ${languageName}. Keep the term/acronym in its original form, but explain it in ${languageName}.`;

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
        [{ type: "text", languages: ["en"] }],
        [{ type: "text", languages: [outputLanguage] }]
      );

      const term = JSON.parse(response) as GlossaryTerm;
      console.log('[Definition] ✓ Definition generated for:', keyword);

      return term;
    } catch (error) {
      console.error('[Definition] Error generating definition for keyword:', keyword, error);
      return null;
    }
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
    useKeywordOnly: boolean = false
  ): Promise<(GlossaryTerm | null)[]> {
    console.log(`[DefinitionBatch] Generating definitions for ${keywords.length} terms in single prompt call`);

    try {
      // Step 1: Gather RAG context for each keyword (in parallel)
      const { getPaperChunks } = await import('./dbService.ts');
      const allChunks = await getPaperChunks(paperId);

      console.log('[DefinitionBatch] Gathering RAG context for all keywords...');

      // Get adaptive chunk limit (shared across all keywords in this batch)
      const { getAdaptiveChunkLimit, trimChunksByTokenBudget } = await import('./adaptiveRAGService.ts');
      const adaptiveLimit = await getAdaptiveChunkLimit(paperId, 'definition');

      const keywordContexts = await Promise.all(
        keywords.map(async (keyword) => {
          let relevantChunks = [];

          // Use keyword-only search if specified
          if (useKeywordOnly) {
            const { getRelevantChunks } = await import('./dbService.ts');
            relevantChunks = await getRelevantChunks(paperId, keyword, adaptiveLimit);
          } else {
            // Try semantic search
            const hasEmbeddings = allChunks.some(chunk => chunk.embedding !== undefined);

            if (hasEmbeddings) {
              try {
                const { searchSemanticOffscreen } = await import('../background/services/offscreenService.ts');
                const searchResult = await searchSemanticOffscreen(paperId, keyword, adaptiveLimit);

                if (searchResult.success && searchResult.chunkIds && searchResult.chunkIds.length > 0) {
                  relevantChunks = searchResult.chunkIds
                    .map(chunkId => allChunks.find(c => c.id === chunkId))
                    .filter(c => c !== undefined) as any[];
                }
              } catch (error) {
                console.warn('[DefinitionBatch] Semantic search failed for', keyword);
              }
            }

            // Fallback to keyword search
            if (relevantChunks.length === 0) {
              const { getRelevantChunks } = await import('./dbService.ts');
              relevantChunks = await getRelevantChunks(paperId, keyword, adaptiveLimit);
            }
          }

          // Trim chunks to fit within token budget
          const trimmedChunks = await trimChunksByTokenBudget(relevantChunks, 'definition');

          // Truncate context to avoid token limits (max ~500 chars per term)
          const contextText = trimmedChunks
            .map((chunk, i) => {
              const content = chunk.content;
              // Truncate each chunk to max 250 chars to keep batch size manageable
              return content.length > 250 ? content.substring(0, 250) + '...' : content;
            })
            .join('\n');

          return {
            keyword,
            context: contextText || 'No relevant context found'
          };
        })
      );

      console.log('[DefinitionBatch] ✓ RAG context gathered for all keywords');

      // Step 2: Construct single prompt with all keywords and their contexts
      const outputLanguage = await getOutputLanguage();
      const languageNames: { [key: string]: string } = {
        'en': 'English',
        'es': 'Spanish',
        'ja': 'Japanese'
      };
      const languageName = languageNames[outputLanguage] || 'English';

      const systemPrompt = `You are a research paper terminology expert who provides clear, accurate definitions for technical terms and acronyms.
When mathematical expressions, equations, or formulas are needed in definitions or contexts:
- Use $expression$ for inline math (e.g., $E = mc^2$, $\\alpha$)
- Use $$expression$$ for display equations on separate lines
- Alternative: \\(expression\\) for inline, \\[expression\\] for display
- Ensure proper LaTeX syntax (e.g., \\frac{a}{b}, \\sum_{i=1}^{n}, Greek letters)
IMPORTANT: All definitions, contexts, and analogies must be in ${languageName}. Keep the term/acronym in its original form, but explain it in ${languageName}.`;

      // Build the input with all keywords
      const keywordSections = keywordContexts.map((kc, idx) => {
        return `
TERM ${idx + 1}: "${kc.keyword}"
Relevant excerpts from paper:
${kc.context}
`;
      }).join('\n---\n');

      const input = `IMPORTANT: All definitions, study contexts, and analogies must be in ${languageName}. Keep the term/acronym in its original form, but explain it in ${languageName}.

Paper Title: ${paperTitle}

Define the following ${keywords.length} terms/acronyms based on how they are used in this research paper:

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
Return an array with ${keywords.length} term definitions in the same order as listed above.

For mathematical expressions in definitions, contexts, or analogies:
- Use $expression$ for inline math (e.g., $\\alpha$, $n=100$)
- Use $$expression$$ for display equations
- Alternatively use \\(expression\\) for inline, \\[expression\\] for display`;

      // Step 3: Use batch schema (array of terms)
      const schema = getSchemaForLanguage('glossary', outputLanguage as 'en' | 'es' | 'ja');

      const languageContextId = `${contextId}-${outputLanguage}`;
      const response = await this.prompt(
        input,
        systemPrompt,
        schema,
        languageContextId,
        [{ type: "text", languages: ["en"] }],
        [{ type: "text", languages: [outputLanguage] }]
      );

      // Step 4: Parse response
      const parsed = JSON.parse(response);
      const terms = parsed.terms as GlossaryTerm[];

      console.log(`[DefinitionBatch] ✓ Generated ${terms.length} definitions in single call`);

      return terms;
    } catch (error) {
      console.error('[DefinitionBatch] Error generating batch definitions:', error);
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
    console.log('[TermDedupe] Deduplicating', terms.length, 'terms, target:', targetCount);

    // Get user's preferred output language
    const outputLanguage = await getOutputLanguage();
    const languageNames: { [key: string]: string } = {
      'en': 'English',
      'es': 'Spanish',
      'ja': 'Japanese'
    };
    const languageName = languageNames[outputLanguage] || 'English';

    // Prepare term list
    const termList = terms.join(', ');

    const systemPrompt = `You are a research paper glossary expert who deduplicates and selects technical terms.
Your task is to remove duplicates and select the TOP ${targetCount} most important unique terms.
IMPORTANT: Return your response in ${languageName}.`;

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
      console.log('[TermDedupe] Sending terms to Gemini Nano for deduplication...');

      const response = await this.prompt(
        input,
        systemPrompt,
        undefined, // No schema - simple text response
        contextId,
        [{ type: "text", languages: ["en"] }],
        [{ type: "text", languages: [outputLanguage] }]
      );

      // Parse comma-separated list
      const deduplicatedTerms = response
        .split(',')
        .map(term => term.trim())
        .filter(term => term.length > 0 && term.length < 100); // Sanity check

      console.log('[TermDedupe] ✓ Deduplicated to', deduplicatedTerms.length, 'unique terms');
      console.log('[TermDedupe] Sample:', deduplicatedTerms.slice(0, 10).join(', '));

      return deduplicatedTerms;
    } catch (error) {
      console.error('[TermDedupe] Error deduplicating terms:', error);
      // Fallback: return unique terms (basic dedup)
      console.warn('[TermDedupe] Falling back to basic deduplication');
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
    console.log('[Hierarchical Summary] Starting hierarchical summarization...');
    console.log('[Hierarchical Summary] Document length:', fullText.length, 'chars');

    // Import chunking utility
    const { chunkContent } = await import('./contentExtractor.ts');

    // Step 1: Split into chunks (5000 chars, 1000 char overlap for speed and context)
    const chunks = chunkContent(fullText, 5000, 1000);
    console.log('[Hierarchical Summary] Split into', chunks.length, 'chunks');

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
      console.log('[Hierarchical Summary] Document is small, creating single summary with terms');
      const input = `Summarize this research paper content concisely, capturing all important points. Also extract the 5-10 most important technical terms and acronyms:\n\n${fullText.slice(0, 6000)}`;
      const response = await this.prompt(input, chunkSummarySystemPrompt, chunkSchema, contextId);
      const parsed = JSON.parse(response);
      console.log('[Hierarchical Summary] Single summary created:', parsed.summary.length, 'chars,', parsed.terms.length, 'terms');
      return { summary: parsed.summary, chunkTerms: [parsed.terms] };
    }

    // Step 2: Summarize each chunk in parallel with progress tracking AND extract terms
    console.log('[Hierarchical Summary] Summarizing chunks in parallel and extracting terms...');

    // Report initial progress
    if (onProgress) {
      onProgress(0, chunks.length);
    }

    let completedCount = 0;

    // Create promises for all chunk summaries with terms (starts parallel execution)
    const chunkPromises = chunks.map(async (chunk, index) => {
      const input = `Summarize this section of a research paper, capturing all important points. Also extract the 5-10 most important technical terms and acronyms:\n\n${chunk.content}`;

      try {
        const response = await this.prompt(input, chunkSummarySystemPrompt, chunkSchema, `${contextId}-chunk-${index}`);
        const parsed = JSON.parse(response);
        console.log(`[Hierarchical Summary] Chunk ${index + 1}/${chunks.length} summarized:`, parsed.summary.length, 'chars,', parsed.terms.length, 'terms');

        // Report progress after this chunk completes
        completedCount++;
        if (onProgress) {
          onProgress(completedCount, chunks.length);
        }

        return { summary: parsed.summary, terms: parsed.terms };
      } catch (error) {
        console.error(`[Hierarchical Summary] Failed to summarize chunk ${index}:`, error);

        // Still count as completed even if failed
        completedCount++;
        if (onProgress) {
          onProgress(completedCount, chunks.length);
        }

        // Return original chunk content truncated if summary fails, with empty terms
        return { summary: chunk.content.slice(0, 500), terms: [] };
      }
    });

    const chunkResults = await Promise.all(chunkPromises);
    console.log('[Hierarchical Summary] All chunks summarized and terms extracted');

    // Separate summaries and terms
    const chunkSummaries = chunkResults.map(result => result.summary);
    const chunkTerms = chunkResults.map(result => result.terms);
    console.log('[Hierarchical Summary] Extracted', chunkTerms.flat().length, 'total terms from all chunks');

    // Step 3: Combine chunk summaries
    const combinedSummaries = chunkSummaries.join('\n\n');
    console.log('[Hierarchical Summary] Combined summaries length:', combinedSummaries.length, 'chars');

    // Step 4: Create final meta-summary
    // If combined summaries are small enough, return as-is with terms
    if (combinedSummaries.length <= 8000) {
      console.log('[Hierarchical Summary] Combined summaries already compact');
      return { summary: combinedSummaries, chunkTerms };
    }

    // Otherwise, create a meta-summary
    console.log('[Hierarchical Summary] Creating meta-summary from', chunkSummaries.length, 'chunk summaries...');
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
      console.log('[Hierarchical Summary] ✓ Meta-summary created:', finalSummary.length, 'chars');
      return { summary: finalSummary, chunkTerms };
    } catch (error) {
      console.error('[Hierarchical Summary] Meta-summary failed, returning truncated combined summaries:', error);
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
      console.log('[Conversation Summarizer] Starting summarization of', messages.length, 'messages');

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
        console.warn('[Conversation Summarizer] Failed to create summarizer');
        return null;
      }

      // Generate summary
      const summary = await summarizer.summarize(conversationText);
      summarizer.destroy();

      console.log('[Conversation Summarizer] ✓ Summary created:', summary.length, 'chars');
      return summary;
    } catch (error) {
      console.error('[Conversation Summarizer] Error summarizing conversation:', error);
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
        console.warn(`[Session Metadata] No session found for context: ${contextId}`);
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
        console.warn('[Session Metadata] Could not access session usage properties:', propertyError);
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

      console.log(`[Session Metadata] ${contextId}:`, {
        usage: inputUsage,
        quota: inputQuota,
        percentage: usagePercentage.toFixed(2) + '%',
        needsSummarization,
      });

      return metadata;
    } catch (error) {
      console.error('[Session Metadata] Error getting session metadata:', error);
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
    console.log('[Session Clone] Cloning session for', contextId);
    console.log('[Session Clone] Conversation state:', {
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

    console.log('[Session Clone] Creating new session with', initialPrompts.length, 'initial prompts');

    // Destroy old session
    const oldSession = this.sessions.get(contextId);
    if (oldSession) {
      try {
        oldSession.destroy();
      } catch (error) {
        console.warn('[Session Clone] Error destroying old session:', error);
      }
    }

    // Create new session with conversation history
    const newSession = await LanguageModel.create({
      ...options,
      initialPrompts,
    });

    // Update session map
    this.sessions.set(contextId, newSession);

    // Reset metadata
    this.sessionMetadata.delete(contextId);

    console.log('[Session Clone] ✓ Session cloned successfully');
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
