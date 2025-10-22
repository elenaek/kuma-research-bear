import {
  AICapabilities,
  AILanguageModelSession,
  AISessionOptions,
  ExplanationResult,
  SummaryResult,
  AIAvailability,
  SummarizerCapabilities,
  PaperAnalysisResult,
  MethodologyAnalysis,
  ConfounderAnalysis,
  ImplicationAnalysis,
  LimitationAnalysis,
  QuestionAnswer,
  GlossaryResult,
  GlossaryTerm,
  StudyContext
} from '../types/index.ts';
import { JSONSchema } from '../utils/typeToSchema.ts';
import { getSchemaForLanguage } from '../schemas/analysisSchemas.multilang.ts';
import { getOutputLanguage } from './settingsService.ts';

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
   */
  async getOrCreateSession(contextId: string, options?: AISessionOptions): Promise<AILanguageModelSession> {
    // Always create a new session - simpler and more reliable
    try {
      if (typeof LanguageModel === 'undefined') {
        throw new Error('Prompt API not available');
      }

      console.log(`[AI] Creating new session for context: ${contextId}`);
      const session = await LanguageModel.create(options);

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
IMPORTANT: Respond in ${languageName}. Your entire explanation must be in ${languageName}.`;

    // If hierarchical summary is provided, use it for richer context
    let input: string;
    if (hierarchicalSummary) {
      console.log('[Explain] Using hierarchical summary for comprehensive explanation');
      input = `IMPORTANT: You must respond entirely in ${languageName}. Do not use any other language.

Please explain this research paper in simple terms that anyone can understand.
Use the full paper summary below to provide a comprehensive explanation that covers the entire study, not just the abstract.

OUTPUT FORMAT:
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

**Fields/Subject Areas:** Field(s) or subfields this paper belongs in

FULL PAPER SUMMARY:
${hierarchicalSummary}

ABSTRACT:
${abstract}

Use markdown formatting for better readability:
- Use **bold** for important concepts or key terms
- Use bullet points or numbered lists where appropriate
- Use *italic* for emphasis
- Keep paragraphs concise
- Cover the key findings, methodology, and conclusions from the full paper`;
    } else {
      console.log('[Explain] Using abstract only (standard approach)');
      input = `IMPORTANT: You must respond entirely in ${languageName}. Do not use any other language.

Please explain this research paper abstract in simple terms that anyone can understand.
Use markdown formatting for better readability:
- Use **bold** for important concepts or key terms
- Use bullet points or numbered lists where appropriate
- Use *italic* for emphasis
- Keep paragraphs concise

OUTPUT FORMAT:
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

**Fields/Subject Areas:** Field(s) or subfields this paper belongs in

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
Use markdown formatting to enhance readability.`;

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
while preserving the original meaning.`;

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
IMPORTANT: Respond in ${languageName}. All your analysis must be in ${languageName}.`;

    try {
      // Import RAG function
      const { getRelevantChunksByTopic } = await import('./dbService.ts');

      // Find relevant chunks for methodology
      const topics = ['methodology', 'methods', 'design', 'procedure', 'participants', 'sample', 'statistical'];
      const relevantChunks = await getRelevantChunksByTopic(paperId, topics, 3);

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
IMPORTANT: Respond in ${languageName}. All your analysis must be in ${languageName}.`;

    try {
      // Import RAG function
      const { getRelevantChunksByTopic } = await import('./dbService.ts');

      // Find relevant chunks for confounders/biases
      const topics = ['bias', 'confound', 'limitation', 'control', 'random', 'blinding', 'selection'];
      const relevantChunks = await getRelevantChunksByTopic(paperId, topics, 3);

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
IMPORTANT: Respond in ${languageName}. All your analysis must be in ${languageName}.`;

    try {
      // Import RAG function
      const { getRelevantChunksByTopic } = await import('./dbService.ts');

      // Find relevant chunks for implications
      const topics = ['implication', 'application', 'significance', 'discussion', 'conclusion', 'impact', 'future'];
      const relevantChunks = await getRelevantChunksByTopic(paperId, topics, 3);

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
IMPORTANT: Respond in ${languageName}. All your analysis must be in ${languageName}.`;

    try {
      // Import RAG function
      const { getRelevantChunksByTopic } = await import('./dbService.ts');

      // Find relevant chunks for limitations
      const topics = ['limitation', 'constraint', 'weakness', 'generalizability', 'caveat', 'shortcoming'];
      const relevantChunks = await getRelevantChunksByTopic(paperId, topics, 3);

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
    contextChunks: Array<{ content: string; section?: string }>,
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

    // Combine chunks into context with section markers
    const context = contextChunks
      .map((chunk, idx) => {
        const sectionLabel = chunk.section ? `[${chunk.section}]` : `[Section ${idx + 1}]`;
        return `${sectionLabel}\n${chunk.content}`;
      })
      .join('\n\n---\n\n');

    const systemPrompt = `You are Kuma, a helpful research assistant. Answer questions about research papers based ONLY on the provided context.
Be accurate, cite which sections you used, and if the context doesn't contain enough information to answer, say so clearly.
Use markdown formatting to make your answers more readable and well-structured.
IMPORTANT: Respond in ${languageName}. Your entire answer must be in ${languageName}.`;

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
      // Include language in context ID to ensure separate sessions per language
      const languageContextId = `${contextId}-${outputLanguage}`;
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
   * Generate a glossary of acronyms and technical terms from a research paper
   */
  async generateGlossary(
    paperContent: string,
    paperTitle: string,
    contextId: string = 'glossary'
  ): Promise<GlossaryResult> {
    console.log('Generating glossary of terms and acronyms...');

    // Get user's preferred output language
    const outputLanguage = await getOutputLanguage();

    // Get language name for instructions
    const languageNames: { [key: string]: string } = {
      'en': 'English',
      'es': 'Spanish',
      'ja': 'Japanese'
    };
    const languageName = languageNames[outputLanguage] || 'English';

    const maxChars = 15000; // ~3750tokens
    const truncatedContent = paperContent.slice(0, maxChars);
    const systemPrompt = `You are a research paper terminology expert who creates comprehensive glossaries.
Extract acronyms, initialisms, and key technical terms from research papers.
Provide clear definitions and helpful analogies for each term.
IMPORTANT: All definitions, contexts, and analogies must be in ${languageName}. Keep acronyms in their original form, but explain them in ${languageName}.
`;

    const input = `IMPORTANT: All definitions, study contexts, and analogies must be in ${languageName}. Keep acronyms in their original form, but explain them in ${languageName}.

Extract all UNIQUE acronyms, initialisms, and important technical abbreviations from this research paper and create a glossary.

For each key acronym/initialisms/technical terms, provide:
1. The acronym/initialism/technical term (e.g., "RCT", "CI", "FDA")
2. The full expanded form
3. A clear definition
4. An array of study contexts with sections - for each context, specify:
   - context: describe how the term is used in this paper (string)
   - sections: array of section names where this usage appears (array of strings)
5. A simple analogy to help understand it

If the same context appears in multiple sections, include all sections in the array.
Focus on terms that are critical to understanding the paper.

Paper Title: ${paperTitle}

Paper Content:
${truncatedContent}`;
    try {
      console.log('[Glossary] Attempting to generate glossary with schema validation...');
      // Include language in context ID to ensure separate sessions per language
      const languageContextId = `${contextId}-${outputLanguage}`;

      // Get schema with language-appropriate descriptions
      const schema = getSchemaForLanguage('glossary', outputLanguage as 'en' | 'es' | 'ja');

      const response = await this.prompt(
        input,
        systemPrompt,
        schema,
        languageContextId,
        [{ type: "text", languages: ["en"] }],  // expectedInputs
        [{ type: "text", languages: [outputLanguage] }]  // expectedOutputs
      );
      console.log('[Glossary] AI response received, length:', response.length);
      console.log('[Glossary] Raw response preview:', response.substring(0, 500));

      const glossary = JSON.parse(response);
      console.log('[Glossary] JSON parsed successfully');
      console.log('[Glossary] Glossary object:', glossary);
      console.log('[Glossary] Number of terms:', glossary.terms?.length || 0);

      // Ensure terms array exists
      if (!glossary.terms) {
        console.warn('[Glossary] No terms array in response, initializing empty array');
        glossary.terms = [];
      } else {
        console.log('[Glossary] First term sample:', glossary.terms[0]);
      }

      // Deduplicate terms by acronym (case-insensitive)
      const uniqueTermsMap = new Map<string, GlossaryTerm>();
      for (const term of glossary.terms) {
        const key = term.acronym.toUpperCase().trim();

        if (!uniqueTermsMap.has(key)) {
          // Normalize the acronym (trim whitespace)
          term.acronym = term.acronym.trim();
          uniqueTermsMap.set(key, term);
        } else {
          // Merge study contexts by appending unique ones
          const existing = uniqueTermsMap.get(key)!;
          for (const newContext of term.studyContext) {
            // Check if this context already exists (based on similar context text)
            const existingContext = existing.studyContext.find(
              ec => ec.context.toLowerCase() === newContext.context.toLowerCase()
            );

            if (existingContext) {
              // Merge sections for the same context
              for (const section of newContext.sections) {
                if (!existingContext.sections.includes(section)) {
                  existingContext.sections.push(section);
                }
              }
            } else {
              // Add new context
              existing.studyContext.push(newContext);
            }
          }
        }
      }

      // Convert back to array and sort alphabetically
      const uniqueTerms = Array.from(uniqueTermsMap.values());
      uniqueTerms.sort((a: GlossaryTerm, b: GlossaryTerm) =>
        a.acronym.localeCompare(b.acronym)
      );

      return {
        terms: uniqueTerms,
        timestamp: Date.now(),
      };
    } catch (error) {
      console.error('Glossary generation failed:', error);
      // Return empty glossary on error
      return {
        terms: [],
        timestamp: Date.now(),
      };
    }
  }

  /**
   * Create hierarchical summary of entire document using map-reduce approach
   * This ensures full document coverage without losing information to truncation
   *
   * Process:
   * 1. Split document into ~5000 char chunks (with 1000 char overlap)
   * 2. Summarize each chunk in parallel
   * 3. Combine chunk summaries
   * 4. Create final meta-summary (~8000 chars)
   *
   * This allows us to process papers of any length while staying within token limits
   */
  async createHierarchicalSummary(
    fullText: string,
    contextId: string = 'hierarchical-summary',
    onProgress?: (current: number, total: number) => void
  ): Promise<string> {
    console.log('[Hierarchical Summary] Starting hierarchical summarization...');
    console.log('[Hierarchical Summary] Document length:', fullText.length, 'chars');

    // Import chunking utility
    const { chunkContent } = await import('./contentExtractor.ts');

    // Step 1: Split into chunks (5000 chars, 1000 char overlap for speed and context)
    const chunks = chunkContent(fullText, 5000, 1000);
    console.log('[Hierarchical Summary] Split into', chunks.length, 'chunks');

    const chunkSummarySystemPrompt = `You are a research paper summarizer. Create concise summaries that capture key information.
CRITICAL:
- Preserve ALL acronyms exactly (e.g., "SES", "RCT", "fMRI")
- Keep technical terminology intact - do NOT paraphrase
- Maintain domain-specific language
- Include acronym definitions if present
- Capture key findings, methods, data`;

    // If document is already small enough, just return a single summary
    if (chunks.length === 1) {
      console.log('[Hierarchical Summary] Document is small, creating single summary');
      const input = `Summarize this research paper content concisely, capturing all important points:\n\n${fullText.slice(0, 6000)}`;
      const summary = await this.prompt(input, chunkSummarySystemPrompt, undefined, contextId);
      console.log('[Hierarchical Summary] Single summary created:', summary.length, 'chars');
      return summary;
    }

    // Step 2: Summarize each chunk in parallel with progress tracking
    console.log('[Hierarchical Summary] Summarizing chunks in parallel...');

    // Report initial progress
    if (onProgress) {
      onProgress(0, chunks.length);
    }

    let completedCount = 0;

    // Create promises for all chunk summaries (starts parallel execution)
    const summaryPromises = chunks.map(async (chunk, index) => {
      const input = `Summarize this section of a research paper, capturing all important points:\n\n${chunk.content}`;

      try {
        const summary = await this.prompt(input, chunkSummarySystemPrompt, undefined, `${contextId}-chunk-${index}`);
        console.log(`[Hierarchical Summary] Chunk ${index + 1}/${chunks.length} summarized:`, summary.length, 'chars');

        // Report progress after this chunk completes
        completedCount++;
        if (onProgress) {
          onProgress(completedCount, chunks.length);
        }

        return summary;
      } catch (error) {
        console.error(`[Hierarchical Summary] Failed to summarize chunk ${index}:`, error);

        // Still count as completed even if failed
        completedCount++;
        if (onProgress) {
          onProgress(completedCount, chunks.length);
        }

        // Return original chunk content truncated if summary fails
        return chunk.content.slice(0, 500);
      }
    });

    const chunkSummaries = await Promise.all(summaryPromises);
    console.log('[Hierarchical Summary] All chunks summarized');

    // Step 3: Combine chunk summaries
    const combinedSummaries = chunkSummaries.join('\n\n');
    console.log('[Hierarchical Summary] Combined summaries length:', combinedSummaries.length, 'chars');

    // Step 4: Create final meta-summary
    // If combined summaries are small enough, return as-is
    if (combinedSummaries.length <= 8000) {
      console.log('[Hierarchical Summary] Combined summaries already compact');
      return combinedSummaries;
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
`;
    const metaInput = `Create a comprehensive summary of this research paper from these section summaries. Capture all key findings, methodology, results, and conclusions:\n\n${combinedSummaries.slice(0, 20000)}`;

    try {
      const finalSummary = await this.prompt(metaInput, metaSystemPrompt, undefined, `${contextId}-meta`);
      console.log('[Hierarchical Summary] ✓ Meta-summary created:', finalSummary.length, 'chars');
      return finalSummary;
    } catch (error) {
      console.error('[Hierarchical Summary] Meta-summary failed, returning truncated combined summaries:', error);
      // Fallback to truncated combined summaries
      return combinedSummaries.slice(0, 8000) + '...';
    }
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
