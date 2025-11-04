import { PromptExecutor } from '../core/PromptExecutor.ts';
import { AISessionManager } from '../core/AISessionManager.ts';
import { getSchemaForLanguage } from '../../../shared/schemas/analysisSchemas.multilang.ts';
import {
  buildDefinitionPrompt,
  buildExtractTermsPrompt,
  buildExtractChunkTermsPrompt,
  buildDeduplicateTermsPrompt,
} from '../../../shared/prompts/templates/glossary.ts';
import { getOutputLanguage } from '../../../shared/utils/settingsService.ts';
import { getLanguageName } from '../../../shared/prompts/components/language.ts';
import { logger } from '../../../shared/utils/logger.ts';
import type { GlossaryTerm, ContentChunk } from '../../../shared/types/index.ts';
import type { JSONSchema } from '../../../shared/utils/typeToSchema.ts';

/**
 * Keyword context for glossary generation
 */
interface KeywordContext {
  keyword: string;
  chunks: ContentChunk[];
}

/**
 * Glossary context validation result
 */
interface ValidationResult {
  validatedPrompt?: string;
  systemPrompt?: string;
  finalKeywordContexts: KeywordContext[];
  errorMessage?: string;
}

/**
 * GlossaryOrchestrator - Orchestrates glossary/term definition generation
 *
 * Responsibilities:
 * - Generate definitions for multiple terms in batches (efficiency)
 * - Retrieve relevant chunks using RAG (semantic or keyword search)
 * - Perform iterative validation and trimming to fit token quota
 * - Build structured glossary terms with contexts and analogies
 * - Clean up sessions after use
 *
 * Algorithm:
 * 1. For each keyword, get relevant chunks using RAG
 * 2. Build glossary prompt with all keywords + contexts
 * 3. Validate prompt size using actual token measurement
 * 4. If too large, trim chunks progressively until it fits
 * 5. Execute batch definition generation
 * 6. Parse and return glossary terms
 *
 * Features:
 * - Batch processing for efficiency (1 API call for N terms)
 * - Iterative validation with progressive trimming
 * - RAG integration (semantic or keyword search)
 * - LaTeX math expression support
 * - Multi-language support
 * - Automatic session cleanup
 */
export class GlossaryOrchestrator {
  private promptExecutor: PromptExecutor;
  private sessionManager: AISessionManager;

  private readonly MAX_VALIDATION_ATTEMPTS = 50;
  private readonly VALIDATION_SAFETY_THRESHOLD = 0.80; // 80% of available quota

  constructor(sessionManager: AISessionManager, promptExecutor: PromptExecutor) {
    this.sessionManager = sessionManager;
    this.promptExecutor = promptExecutor;
  }

  /**
   * Generate definitions for multiple terms in batch
   *
   * @param keywords - Terms to define
   * @param paperId - Paper ID for RAG
   * @param paperTitle - Paper title for context
   * @param contextId - Base context identifier
   * @param useKeywordOnly - Use keyword search instead of semantic
   * @returns Array of glossary terms (null for failed definitions)
   */
  async generateDefinitionsBatch(
    keywords: string[],
    paperId: string,
    paperTitle: string,
    contextId: string = 'definition-batch',
    useKeywordOnly: boolean = false
  ): Promise<(GlossaryTerm | null)[]> {
    logger.debug('GLOSSARY_ORCHESTRATOR', `Generating definitions for ${keywords.length} terms in batch`);

    try {
      // Get output language
      const outputLanguage = (await getOutputLanguage()) as 'en' | 'es' | 'ja';
      const languageName = getLanguageName(outputLanguage);
      const languageContextId = `${contextId}-${outputLanguage}`;

      // Create session for validation and execution
      await this.sessionManager.createSession(languageContextId, {
        expectedInputs: [{ type: 'text', languages: ['en', 'es', 'ja'] }],
        expectedOutputs: [{ type: 'text', languages: [outputLanguage || 'en'] }],
        temperature: 0.0,
        topK: 1,
      });

      // Get session for validation
      const session = this.sessionManager.getSession(languageContextId);
      if (!session) {
        logger.error('GLOSSARY_ORCHESTRATOR', 'Failed to create session');
        return keywords.map(() => null);
      }

      // Get relevant chunks for each keyword using RAG
      const keywordContexts = await this.getKeywordContexts(
        keywords,
        paperId,
        useKeywordOnly
      );

      // Get schema
      const schema = getSchemaForLanguage('glossary', outputLanguage);

      // Validate and trim context until it fits
      const { validatedPrompt, systemPrompt, errorMessage } = await this.validateAndTrimContext(
        session,
        keywordContexts,
        schema,
        paperTitle,
        languageName
      );

      if (errorMessage || !validatedPrompt || !systemPrompt) {
        logger.error('GLOSSARY_ORCHESTRATOR', 'Context validation failed:', errorMessage);
        return keywords.map(() => null);
      }

      // Update session system prompt
      // Note: Session already created, this would need session recreation in real implementation
      // For now, we'll execute with current session

      // Execute batch definition generation
      const response = await this.promptExecutor.executeWithTimeout(
        languageContextId,
        validatedPrompt,
        {
          timeoutMs: 60000, // 60 seconds for batch glossary
          maxRetries: 2,
          retryDelayMs: 1000,
          recreateSessionOnTimeout: true,
        },
        { responseConstraint: schema }
      );

      // Parse response
      const result = JSON.parse(response);
      const terms = result.terms as GlossaryTerm[];

      logger.debug('GLOSSARY_ORCHESTRATOR', `✓ Generated ${terms.length} definitions`);

      return terms;
    } catch (error) {
      logger.error('GLOSSARY_ORCHESTRATOR', 'Batch definition generation failed:', error);
      return keywords.map(() => null);
    } finally {
      // Cleanup session
      try {
        const outputLanguage = await getOutputLanguage();
        const languageContextId = `${contextId}-${outputLanguage}`;
        await this.sessionManager.destroySession(languageContextId);
      } catch (cleanupError) {
        logger.warn('GLOSSARY_ORCHESTRATOR', 'Failed to cleanup session:', cleanupError);
      }
    }
  }

  /**
   * Generate a definition for a single keyword using RAG + GeminiNano
   * Hybrid approach: retrieves relevant context via search, then generates definition
   *
   * @param keyword - Term to define
   * @param paperId - Paper ID for RAG
   * @param paperTitle - Paper title for context
   * @param contextId - Base context identifier
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
    logger.debug('GLOSSARY_ORCHESTRATOR', '[Definition] Generating definition for keyword:', keyword);

    try {
      // Step 1: Find relevant chunks
      const { getPaperChunks } = await import('../../../shared/utils/dbService.ts');
      const allChunks = await getPaperChunks(paperId);

      if (allChunks.length === 0) {
        logger.warn('GLOSSARY_ORCHESTRATOR', '[Definition] No chunks found for paper:', paperId);
        return null;
      }

      let relevantChunks: ContentChunk[] = [];

      // Get adaptive chunk limit based on paper's chunk size
      const { getAdaptiveChunkLimit, trimChunksByTokenBudget } = await import('../../../shared/utils/adaptiveRAGService.ts');
      const adaptiveLimit = await getAdaptiveChunkLimit(paperId, 'definition');

      // If useKeywordOnly is true, skip semantic search and go straight to keyword search
      if (useKeywordOnly) {
        logger.debug('GLOSSARY_ORCHESTRATOR', '[Definition] Using keyword-only search for:', keyword);
        const { getRelevantChunks } = await import('../../../shared/utils/dbService.ts');
        relevantChunks = await getRelevantChunks(paperId, keyword, adaptiveLimit);
      } else {
        // Try semantic search via offscreen document if embeddings are available
        const hasEmbeddings = allChunks.some(chunk => chunk.embedding !== undefined);

        if (hasEmbeddings) {
          try {
            logger.debug('GLOSSARY_ORCHESTRATOR', '[Definition] Attempting semantic search via offscreen document for keyword:', keyword);

            // Use offscreen service for semantic search
            const { searchSemanticOffscreen } = await import('../../../background/services/offscreenService.ts');
            const searchResult = await searchSemanticOffscreen(paperId, keyword, adaptiveLimit);

            if (searchResult.success && searchResult.chunkIds && searchResult.chunkIds.length > 0) {
              // Map chunk IDs back to chunks
              relevantChunks = searchResult.chunkIds
                .map(chunkId => allChunks.find(c => c.id === chunkId))
                .filter(c => c !== undefined) as ContentChunk[];

              logger.debug('GLOSSARY_ORCHESTRATOR', '[Definition] Found', relevantChunks.length, 'relevant chunks via semantic search');
            } else {
              logger.debug('GLOSSARY_ORCHESTRATOR', '[Definition] Semantic search returned no results, falling back to keyword search');
            }
          } catch (error) {
            logger.warn('GLOSSARY_ORCHESTRATOR', '[Definition] Semantic search failed, falling back to keyword search:', error);
          }
        }

        // Fallback to keyword search if semantic search didn't work
        if (relevantChunks.length === 0) {
          logger.debug('GLOSSARY_ORCHESTRATOR', '[Definition] Using keyword search for:', keyword);
          const { getRelevantChunks } = await import('../../../shared/utils/dbService.ts');
          relevantChunks = await getRelevantChunks(paperId, keyword, adaptiveLimit);
        }
      }

      // Trim chunks to fit within token budget
      const trimmedChunks = await trimChunksByTokenBudget(relevantChunks, 'definition');

      if (trimmedChunks.length === 0) {
        logger.warn('GLOSSARY_ORCHESTRATOR', '[Definition] No relevant chunks found for keyword:', keyword);
        return null;
      }

      // Step 2: Prepare context from relevant chunks with position and hierarchy
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

          // Add paragraph/sentence info if available
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
      const outputLanguage = (await getOutputLanguage()) as 'en' | 'es' | 'ja';
      const languageName = getLanguageName(outputLanguage);

      // Step 3: Generate definition using GeminiNano
      const systemPrompt = buildDefinitionPrompt(outputLanguage);

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
      const schema = getSchemaForLanguage('glossary', outputLanguage);

      // Modify schema to expect a single term instead of array
      const singleTermSchema: JSONSchema = {
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

      // Create session for this definition
      await this.sessionManager.createSession(languageContextId, {
        systemPrompt,
        expectedInputs: [{ type: "text", languages: ["en", "es", "ja"] }],
        expectedOutputs: [{ type: "text", languages: [outputLanguage || "en"] }],
        temperature: 0,
        topK: 1
      });

      const response = await this.promptExecutor.executeWithTimeout(
        languageContextId,
        input,
        {
          timeoutMs: 60000, // 60 seconds for single definition
          maxRetries: 2,
          retryDelayMs: 1000,
          recreateSessionOnTimeout: true,
        },
        { responseConstraint: singleTermSchema }
      );

      const term = JSON.parse(response) as GlossaryTerm;
      logger.debug('GLOSSARY_ORCHESTRATOR', '[Definition] ✓ Definition generated for:', keyword);

      return term;
    } catch (error) {
      logger.error('GLOSSARY_ORCHESTRATOR', '[Definition] Error generating definition for keyword:', keyword, error);
      return null;
    } finally {
      // Cleanup session after definition generation operation
      try {
        const outputLanguage = await getOutputLanguage();
        const languageContextId = `${contextId}-${keyword}-${outputLanguage}`;
        await this.sessionManager.destroySession(languageContextId);
      } catch (cleanupError) {
        logger.warn('GLOSSARY_ORCHESTRATOR', `Failed to cleanup definition session for ${keyword}`, cleanupError);
      }
    }
  }

  /**
   * Extract technical terms from full text using Gemini Nano
   *
   * @param text - Text to extract terms from
   * @param paperTitle - Paper title for context
   * @param contextId - Base context identifier
   * @param targetCount - Number of terms to extract
   * @returns Array of extracted terms
   */
  async extractTermsFromText(
    text: string,
    paperTitle: string,
    contextId: string = 'extract-terms',
    targetCount: number = 50
  ): Promise<string[]> {
    logger.debug('GLOSSARY_ORCHESTRATOR', '[TermExtraction] Extracting terms from', text.length, 'chars of text');

    // Truncate to ~10k characters
    const truncatedText = text.slice(0, 10000);

    // Get user's preferred output language
    const outputLanguage = (await getOutputLanguage()) as 'en' | 'es' | 'ja';
    const languageName = getLanguageName(outputLanguage);

    const systemPrompt = buildExtractTermsPrompt(outputLanguage);

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
      logger.debug('GLOSSARY_ORCHESTRATOR', '[TermExtraction] Sending text to Gemini Nano for term extraction...');

      // Create session for term extraction
      await this.sessionManager.createSession(contextId, {
        systemPrompt,
        expectedInputs: [{ type: "text", languages: ["en", "es", "ja"] }],
        expectedOutputs: [{ type: "text", languages: [outputLanguage || "en"] }],
        temperature: 0.0,
        topK: 1
      });

      const response = await this.promptExecutor.executeWithTimeout(
        contextId,
        input,
        {
          timeoutMs: 60000, // 60 seconds for term extraction
          maxRetries: 2,
          retryDelayMs: 1000,
          recreateSessionOnTimeout: true,
        }
      );

      // Parse comma-separated list
      const extractedTerms = response
        .split(',')
        .map(term => term.trim())
        .filter(term => term.length > 0 && term.length < 100); // Sanity check

      logger.debug('GLOSSARY_ORCHESTRATOR', '[TermExtraction] ✓ Extracted', extractedTerms.length, 'terms');
      logger.debug('GLOSSARY_ORCHESTRATOR', '[TermExtraction] Sample terms:', extractedTerms.slice(0, 10).join(', '));

      return extractedTerms;
    } catch (error) {
      logger.error('GLOSSARY_ORCHESTRATOR', '[TermExtraction] Failed to extract terms:', error);
      return [];
    } finally {
      // Cleanup session after term extraction operation
      try {
        await this.sessionManager.destroySession(contextId);
      } catch (cleanupError) {
        logger.warn('GLOSSARY_ORCHESTRATOR', `Failed to cleanup term extraction session: ${contextId}`, cleanupError);
      }
    }
  }

  /**
   * Extract technical terms from a single chunk using structured schema
   * Used for on-demand term extraction when glossarization is triggered
   *
   * @param chunkContent - Content of the chunk to extract terms from
   * @param paperTitle - Paper title for context
   * @param contextId - Base context identifier
   * @param termCount - Number of terms to extract
   * @returns Array of extracted terms
   */
  async extractTermsFromChunk(
    chunkContent: string,
    paperTitle: string,
    contextId: string = 'extract-chunk-terms',
    termCount: number = 10
  ): Promise<string[]> {
    try {
      logger.debug('GLOSSARY_ORCHESTRATOR', '[ChunkTermExtraction] Extracting', termCount, 'terms from chunk of', chunkContent.length, 'chars');

      // Use the same schema as hierarchical summarization for consistency
      const outputLanguage = (await getOutputLanguage()) as 'en' | 'es' | 'ja';
      const chunkSchema = getSchemaForLanguage('chunk-summary', outputLanguage);

      const systemPrompt = buildExtractChunkTermsPrompt(paperTitle, termCount);

      const input = `Extract the ${termCount} most important technical terms and acronyms from this section. Also provide a brief summary:\n\n${chunkContent}`;

      const maxRetries = 3;
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          // Create session for chunk term extraction
          await this.sessionManager.createSession(contextId, {
            systemPrompt,
            expectedInputs: [{ type: "text", languages: ["en", "es", "ja"] }],
            expectedOutputs: [{ type: "text", languages: [outputLanguage || "en"] }],
            temperature: 0,
            topK: 1
          });

          const response = await this.promptExecutor.executeWithTimeout(
            contextId,
            input,
            {
              timeoutMs: 60000,
              maxRetries: 1,
              retryDelayMs: 1000,
              recreateSessionOnTimeout: true,
            },
            { responseConstraint: chunkSchema }
          );

          const parsed = JSON.parse(response);

          logger.debug('GLOSSARY_ORCHESTRATOR', '[ChunkTermExtraction] ✓ Extracted', parsed.terms.length, 'terms');
          logger.debug('GLOSSARY_ORCHESTRATOR', '[ChunkTermExtraction] Sample terms:', parsed.terms.slice(0, 5).join(', '));

          return parsed.terms || [];
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          const isRetryableError = errorMessage.includes('UnknownError') ||
                                   errorMessage.includes('generic failures') ||
                                   errorMessage.includes('timeout') ||
                                   errorMessage.includes('resource');

          if (attempt < maxRetries && isRetryableError) {
            const delay = Math.pow(2, attempt - 1) * 1000; // 1s, 2s, 4s
            logger.warn('GLOSSARY_ORCHESTRATOR', `[ChunkTermExtraction] Failed (attempt ${attempt}/${maxRetries}), retrying in ${delay}ms:`, errorMessage);
            await new Promise(resolve => setTimeout(resolve, delay));
          } else {
            logger.error('GLOSSARY_ORCHESTRATOR', `[ChunkTermExtraction] Failed after ${attempt} attempts:`, error);
            return []; // Return empty array on failure
          }
        }
      }

      return []; // Fallback
    } finally {
      // Cleanup session after chunk term extraction operation
      try {
        await this.sessionManager.destroySession(contextId);
      } catch (cleanupError) {
        logger.warn('GLOSSARY_ORCHESTRATOR', `Failed to cleanup chunk term extraction session: ${contextId}`, cleanupError);
      }
    }
  }

  /**
   * Deduplicate a batch of terms using Gemini Nano
   * Handles singular/plural, synonyms, abbreviations intelligently
   *
   * @param terms - Array of terms to deduplicate
   * @param paperTitle - Title of the paper for context
   * @param targetCount - Target number of unique terms to return
   * @param contextId - Base context identifier
   * @returns Deduplicated array of technical terms
   */
  async deduplicateTermsBatch(
    terms: string[],
    paperTitle: string,
    targetCount: number = 50,
    contextId: string = 'dedupe-batch'
  ): Promise<string[]> {
    logger.debug('GLOSSARY_ORCHESTRATOR', '[TermDedupe] Deduplicating', terms.length, 'terms, target:', targetCount);

    // Get user's preferred output language
    const outputLanguage = (await getOutputLanguage()) as 'en' | 'es' | 'ja';
    const languageName = getLanguageName(outputLanguage);

    // Prepare term list
    const termList = terms.join(', ');

    const systemPrompt = buildDeduplicateTermsPrompt(outputLanguage, targetCount);

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
      logger.debug('GLOSSARY_ORCHESTRATOR', '[TermDedupe] Sending terms to Gemini Nano for deduplication...');

      // Create session for term deduplication
      await this.sessionManager.createSession(contextId, {
        systemPrompt,
        expectedInputs: [{ type: "text", languages: ["en", "es", "ja"] }],
        expectedOutputs: [{ type: "text", languages: [outputLanguage || "en"] }],
        temperature: 0,
        topK: 1
      });

      const response = await this.promptExecutor.executeWithTimeout(
        contextId,
        input,
        {
          timeoutMs: 60000, // 60 seconds for deduplication
          maxRetries: 2,
          retryDelayMs: 1000,
          recreateSessionOnTimeout: true,
        }
      );

      // Parse comma-separated list
      const deduplicatedTerms = response
        .split(',')
        .map(term => term.trim())
        .filter(term => term.length > 0 && term.length < 100); // Sanity check

      logger.debug('GLOSSARY_ORCHESTRATOR', '[TermDedupe] ✓ Deduplicated to', deduplicatedTerms.length, 'unique terms');
      logger.debug('GLOSSARY_ORCHESTRATOR', '[TermDedupe] Sample:', deduplicatedTerms.slice(0, 10).join(', '));

      return deduplicatedTerms;
    } catch (error) {
      logger.error('GLOSSARY_ORCHESTRATOR', '[TermDedupe] Error deduplicating terms:', error);
      // Fallback: return unique terms (basic dedup)
      logger.warn('GLOSSARY_ORCHESTRATOR', '[TermDedupe] Falling back to basic deduplication');
      const uniqueTerms = Array.from(new Set(terms.map(t => t.toLowerCase())))
        .slice(0, targetCount);
      return uniqueTerms;
    } finally {
      // Cleanup session after term deduplication operation
      try {
        await this.sessionManager.destroySession(contextId);
      } catch (cleanupError) {
        logger.warn('GLOSSARY_ORCHESTRATOR', `Failed to cleanup term deduplication session: ${contextId}`, cleanupError);
      }
    }
  }

  /**
   * Get relevant chunks for each keyword using RAG
   */
  private async getKeywordContexts(
    keywords: string[],
    paperId: string,
    useKeywordOnly: boolean
  ): Promise<KeywordContext[]> {
    // Import RAG service
    const { getRelevantChunksByTopic, getRelevantChunksByTopicSemantic } = await import('../../../shared/utils/dbService.ts');

    const keywordContexts: KeywordContext[] = [];

    for (const keyword of keywords) {
      try {
        const chunks = useKeywordOnly
          ? await getRelevantChunksByTopic(paperId, [keyword], 3)
          : await getRelevantChunksByTopicSemantic(paperId, [keyword], 3);

        keywordContexts.push({
          keyword,
          chunks: chunks || [],
        });

        logger.debug('GLOSSARY_ORCHESTRATOR', `Found ${chunks?.length || 0} chunks for "${keyword}"`);
      } catch (error) {
        logger.error('GLOSSARY_ORCHESTRATOR', `Error getting chunks for "${keyword}":`, error);
        keywordContexts.push({ keyword, chunks: [] });
      }
    }

    return keywordContexts;
  }

  /**
   * Validate and trim context until it fits within token quota
   */
  private async validateAndTrimContext(
    session: any,
    keywordContexts: KeywordContext[],
    schema: JSONSchema,
    paperTitle: string,
    languageName: string
  ): Promise<ValidationResult> {
    if (!session) {
      return {
        finalKeywordContexts: keywordContexts,
        errorMessage: 'Session not initialized',
      };
    }

    let currentKeywordContexts = keywordContexts;

    // Iterative validation loop
    for (let attempt = 1; attempt <= this.MAX_VALIDATION_ATTEMPTS; attempt++) {
      // Build prompt
      const prompt = this.buildGlossaryPrompt(
        currentKeywordContexts,
        paperTitle,
        languageName
      );

      // Validate using actual token measurement
      const validation = await this.validatePromptSize(session, prompt);

      if (validation.fits) {
        logger.debug('GLOSSARY_ORCHESTRATOR', `✓ Validation passed on attempt ${attempt} (${validation.actualUsage} tokens)`);

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
          finalKeywordContexts: currentKeywordContexts,
        };
      }

      // Prompt too large - trim chunks
      logger.warn('GLOSSARY_ORCHESTRATOR', `Prompt too large (${validation.actualUsage} > ${validation.available}) on attempt ${attempt}/${this.MAX_VALIDATION_ATTEMPTS}`);

      if (attempt < this.MAX_VALIDATION_ATTEMPTS) {
        // Remove 1 chunk from each keyword (distributed trimming)
        const totalChunksBefore = currentKeywordContexts.reduce((sum, kc) => sum + kc.chunks.length, 0);

        currentKeywordContexts = currentKeywordContexts.map(kc => ({
          keyword: kc.keyword,
          chunks: kc.chunks.length > 0 ? kc.chunks.slice(0, kc.chunks.length - 1) : [],
        }));

        const totalChunksAfter = currentKeywordContexts.reduce((sum, kc) => sum + kc.chunks.length, 0);

        logger.debug('GLOSSARY_ORCHESTRATOR', `Trimmed ${totalChunksBefore - totalChunksAfter} chunks (${totalChunksBefore} → ${totalChunksAfter})`);

        // Check if we've run out of chunks completely
        if (totalChunksAfter === 0) {
          return {
            finalKeywordContexts: currentKeywordContexts,
            errorMessage: 'Insufficient quota. All chunks trimmed but prompt still too large.',
          };
        }
      } else {
        // Final attempt - use minimal chunks (1 per keyword)
        logger.warn('GLOSSARY_ORCHESTRATOR', 'Max attempts reached, using minimal chunks');
        currentKeywordContexts = currentKeywordContexts.map(kc => ({
          keyword: kc.keyword,
          chunks: kc.chunks.slice(0, Math.min(1, kc.chunks.length)),
        }));
      }
    }

    return {
      finalKeywordContexts: currentKeywordContexts,
      errorMessage: 'Failed to validate context after all attempts',
    };
  }

  /**
   * Build glossary prompt from keyword contexts
   */
  private buildGlossaryPrompt(
    keywordContexts: KeywordContext[],
    paperTitle: string,
    languageName: string
  ): string {
    const keywordContextsFormatted = keywordContexts.map(kc => {
      const contextText = kc.chunks
        .map((chunk, i) => `[Chunk ${i + 1}]\n${chunk.content}`)
        .join('\n\n');

      return {
        keyword: kc.keyword,
        context: contextText || 'No relevant context found',
      };
    });

    const keywordSections = keywordContextsFormatted
      .map(
        (kc, idx) => `
TERM ${idx + 1}: "${kc.keyword}"
Relevant excerpts from paper:
${kc.context}
`
      )
      .join('\n---\n');

    return `IMPORTANT: All definitions, study contexts, and analogies must be in ${languageName}. Keep the term/acronym in its original form, but explain it in ${languageName}.

Paper Title: ${paperTitle}

Define the following ${keywordContexts.length} terms/acronyms based on how they are used in this research paper:

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
Return an array with ${keywordContexts.length} term definitions in the same order as listed above.

For mathematical expressions in definitions, contexts, or analogies:
- Use $expression$ for inline math (e.g., $\\alpha$, $n=100$)
- Use $$expression$$ for display equations
- Alternatively use \\(expression\\) for inline, \\[expression\\] for display`;
  }

  /**
   * Validate prompt size using Chrome AI's measureInputUsage()
   */
  private async validatePromptSize(
    session: any,
    prompt: string
  ): Promise<{
    fits: boolean;
    actualUsage: number;
    quota: number;
    available: number;
  }> {
    try {
      const actualUsage = await session.measureInputUsage(prompt);
      const quota = session.inputQuota ?? 0;
      const currentUsage = session.inputUsage ?? 0;
      const available = quota - currentUsage;

      // Apply safety threshold
      const safeAvailable = Math.floor(available * this.VALIDATION_SAFETY_THRESHOLD);
      const fits = actualUsage <= safeAvailable;

      return { fits, actualUsage, quota, available: safeAvailable };
    } catch (error) {
      logger.error('GLOSSARY_ORCHESTRATOR', 'Error measuring input usage:', error);

      // Fallback: estimate if measureInputUsage() fails
      const estimatedUsage = Math.ceil(prompt.length / 4);
      const quota = session.inputQuota ?? 0;
      const currentUsage = session.inputUsage ?? 0;
      const available = quota - currentUsage;
      const safeAvailable = Math.floor(available * this.VALIDATION_SAFETY_THRESHOLD);

      return { fits: estimatedUsage <= safeAvailable, actualUsage: estimatedUsage, quota, available: safeAvailable };
    }
  }
}
