import { PromptExecutor } from '../core/PromptExecutor.ts';
import { AISessionManager } from '../core/AISessionManager.ts';
import { getSchemaForLanguage } from '../../../shared/schemas/analysisSchemas.multilang.ts';
import {
  buildMethodologyAnalysisPrompt,
  buildConfounderAnalysisPrompt,
  buildImplicationAnalysisPrompt,
  buildLimitationAnalysisPrompt,
} from '../../../shared/prompts/templates/analysis.ts';
import { getOutputLanguage, getPersona, getPurpose, getVerbosity } from '../../../shared/utils/settingsService.ts';
import { getLanguageName } from '../../../shared/prompts/components/language.ts';
import { logger } from '../../../shared/utils/logger.ts';
import type { MethodologyAnalysis, ConfounderAnalysis, ImplicationAnalysis, LimitationAnalysis } from '../../../shared/types/index.ts';

/**
 * Analysis type enum
 */
export type AnalysisType = 'methodology' | 'confounders' | 'implications' | 'limitations';

/**
 * Analysis configuration for each type
 */
interface AnalysisConfig {
  topics: string[];
  schemaKey: string;
  contextSectionLabel: string;
  promptBuilder: (lang: 'en' | 'es' | 'ja', persona: string, purpose: string, verbosity: string) => string;
  analysisDescription: string;
  defaultFallback: any;
}

/**
 * AnalysisOrchestrator - Orchestrates paper analysis operations
 *
 * Responsibilities:
 * - Coordinate four analysis types (methodology, confounders, implications, limitations)
 * - Retrieve relevant chunks using semantic search (RAG)
 * - Trim chunks by token budget
 * - Combine hierarchical summary + trimmed chunks
 * - Execute analysis with retry logic
 * - Clean up sessions after use
 *
 * Algorithm:
 * 1. Get relevant chunks for analysis type (semantic search with specific topics)
 * 2. Trim chunks by token budget (considering summary + overhead)
 * 3. Build context (hierarchical summary + trimmed chunks)
 * 4. Execute prompt with structured output schema
 * 5. Retry with exponential backoff on failure
 * 6. Clean up session
 *
 * Features:
 * - Unified pattern for all analysis types
 * - RAG integration with token budget management
 * - Exponential backoff retry logic
 * - Automatic session cleanup
 * - Language-aware schemas and prompts
 */
export class AnalysisOrchestrator {
  private promptExecutor: PromptExecutor;
  private sessionManager: AISessionManager;

  private readonly MAX_RETRIES = 3;
  private readonly ESTIMATED_OVERHEAD = 150 + 50 + 100; // system + formatting + schema
  private readonly RESPONSE_BUFFER = 400;

  // Analysis configurations
  private readonly configs: Record<AnalysisType, AnalysisConfig> = {
    methodology: {
      topics: ['methodology', 'methods', 'design', 'procedure', 'participants', 'sample', 'statistical'],
      schemaKey: 'methodology',
      contextSectionLabel: 'DETAILED METHODOLOGY SECTIONS',
      promptBuilder: buildMethodologyAnalysisPrompt,
      analysisDescription: 'Analyze the methodology of this research paper',
      defaultFallback: {
        studyDesign: 'Analysis failed',
        dataCollection: 'Could not analyze',
        sampleSize: 'Unable to determine',
        rigor: 'Assessment unavailable',
      },
    },
    confounders: {
      topics: ['confounder', 'confounding', 'bias', 'control', 'validity', 'threat'],
      schemaKey: 'confounder',
      contextSectionLabel: 'DETAILED SECTIONS (Methods, Discussion, Limitations)',
      promptBuilder: buildConfounderAnalysisPrompt,
      analysisDescription: 'Identify potential confounding variables',
      defaultFallback: {
        confounders: ['Analysis failed'],
        controlMethods: 'Could not analyze',
        residualBiases: ['Unable to determine'],
      },
    },
    implications: {
      topics: ['implication', 'application', 'significance', 'discussion', 'conclusion', 'impact', 'future'],
      schemaKey: 'implication',
      contextSectionLabel: 'DETAILED SECTIONS (Results, Discussion, Conclusions)',
      promptBuilder: buildImplicationAnalysisPrompt,
      analysisDescription: 'Analyze the implications of this research paper',
      defaultFallback: {
        realWorldApplications: ['Analysis failed'],
        significance: 'Could not analyze',
        futureResearch: ['Unable to determine'],
      },
    },
    limitations: {
      topics: ['limitation', 'constraint', 'weakness', 'generalizability', 'caveat', 'shortcoming'],
      schemaKey: 'limitation',
      contextSectionLabel: 'DETAILED SECTIONS (Limitations, Discussion)',
      promptBuilder: buildLimitationAnalysisPrompt,
      analysisDescription: 'Identify and explain study limitations',
      defaultFallback: {
        limitations: ['Analysis failed'],
        impactOnValidity: 'Could not analyze',
        suggestions: ['Unable to determine'],
      },
    },
  };

  constructor(sessionManager: AISessionManager, promptExecutor: PromptExecutor) {
    this.sessionManager = sessionManager;
    this.promptExecutor = promptExecutor;
  }

  /**
   * Perform analysis of specified type
   *
   * @param type - Analysis type
   * @param paperId - Paper ID for RAG
   * @param hierarchicalSummary - Full paper summary
   * @param contextId - Base context identifier
   * @returns Analysis result
   */
  async analyze<T = any>(
    type: AnalysisType,
    paperId: string,
    hierarchicalSummary: string,
    contextId: string = 'analysis'
  ): Promise<T> {
    const config = this.configs[type];
    logger.debug('ANALYSIS_ORCHESTRATOR', `Starting ${type} analysis`);

    try {
      // Get output language and settings
      const outputLanguage = (await getOutputLanguage()) as 'en' | 'es' | 'ja';
      const languageName = getLanguageName(outputLanguage);
      const persona = await getPersona();
      const purpose = await getPurpose();
      const verbosity = await getVerbosity();

      // Build system prompt
      const systemPrompt = config.promptBuilder(outputLanguage, persona, purpose, verbosity);

      // Get relevant chunks using RAG
      const { trimmedChunks, budgetStatus } = await this.getRelevantChunks(
        paperId,
        config.topics,
        hierarchicalSummary
      );

      logger.debug('ANALYSIS_ORCHESTRATOR', `[${type}] Budget status - Available: ${budgetStatus.availableTokens}, Used: ${budgetStatus.usedTokens}`);
      logger.debug('ANALYSIS_ORCHESTRATOR', `[${type}] Using ${trimmedChunks.length} chunks`);

      // Build context
      const context = this.buildContext(
        hierarchicalSummary,
        trimmedChunks,
        config.contextSectionLabel
      );

      // Build input
      const input = `IMPORTANT: You must respond entirely in ${languageName}. All analysis must be in ${languageName}.

${config.analysisDescription} using the full paper summary and detailed sections below.

${context}

Provide a comprehensive analysis of the study design, methods, and rigor.`;

      // Get schema
      const schema = getSchemaForLanguage(config.schemaKey, outputLanguage);

      // Execute with retry
      const result = await this.executeWithRetry(
        type,
        input,
        systemPrompt,
        schema,
        outputLanguage,
        contextId
      );

      return result as T;
    } catch (error) {
      logger.error('ANALYSIS_ORCHESTRATOR', `${type} analysis failed:`, error);
      return config.defaultFallback as T;
    }
  }

  /**
   * Get relevant chunks using RAG (semantic search + token budget trimming)
   */
  private async getRelevantChunks(
    paperId: string,
    topics: string[],
    hierarchicalSummary: string
  ): Promise<{
    trimmedChunks: any[];
    budgetStatus: { availableTokens: number; usedTokens: number; minTokensFit: boolean };
  }> {
    // Import RAG services
    const { getRelevantChunksByTopicSemantic } = await import('../../../shared/utils/dbService.ts');
    const { trimChunksByTokenBudget, getOptimalRAGChunkCount } = await import('../../../shared/utils/adaptiveRAGService.ts');
    const { inputQuotaService } = await import('../../../shared/utils/inputQuotaService.ts');

    // Pre-flight quota check
    const inputQuota = await inputQuotaService.getInputQuota();
    const summaryTokens = Math.ceil(hierarchicalSummary.length / 4);

    logger.debug('ANALYSIS_ORCHESTRATOR', `Pre-flight check - Quota: ${inputQuota}, Summary: ${summaryTokens} tokens`);

    // Get relevant chunks
    const chunkLimit = await getOptimalRAGChunkCount('analysis');
    const relevantChunks = await getRelevantChunksByTopicSemantic(paperId, topics, chunkLimit);

    // Trim by token budget
    const { chunks: trimmedChunks, budgetStatus } = await trimChunksByTokenBudget(
      relevantChunks,
      'analysis',
      { summary: hierarchicalSummary, recentMessages: [] }
    );

    if (trimmedChunks.length === 0) {
      logger.warn('ANALYSIS_ORCHESTRATOR', 'No chunks fit within quota - using summary only');
    }

    return { trimmedChunks, budgetStatus };
  }

  /**
   * Build analysis context from summary and chunks
   */
  private buildContext(
    hierarchicalSummary: string,
    chunks: any[],
    sectionLabel: string
  ): string {
    if (chunks.length === 0) {
      return `FULL PAPER SUMMARY:
${hierarchicalSummary}

Note: Limited quota - analysis based on summary only.`;
    }

    const chunksText = chunks.map(chunk => chunk.content).join('\n\n---\n\n');

    return `FULL PAPER SUMMARY:
${hierarchicalSummary}

${sectionLabel}:
${chunksText}`;
  }

  /**
   * Execute analysis with retry logic
   */
  private async executeWithRetry(
    type: AnalysisType,
    input: string,
    systemPrompt: string,
    schema: any,
    outputLanguage: string,
    baseContextId: string
  ): Promise<any> {
    const languageContextId = `${baseContextId}-${type}-${outputLanguage}`;

    for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
      try {
        // Create session
        await this.sessionManager.createSession(languageContextId, {
          systemPrompt,
          expectedInputs: [{ type: 'text', languages: ['en', 'es', 'ja'] }],
          expectedOutputs: [{ type: 'text', languages: [outputLanguage || 'en'] }],
          temperature: 0.0,
          topK: 1,
        });

        // Execute prompt
        const response = await this.promptExecutor.executeWithTimeout(
          languageContextId,
          input,
          {
            timeoutMs: 60000,
            maxRetries: 2,
            retryDelayMs: 1000,
            recreateSessionOnTimeout: true,
          },
          { responseConstraint: schema }
        );

        // Clean up session
        await this.sessionManager.destroySession(languageContextId);

        return JSON.parse(response);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const isRetryableError =
          errorMessage.includes('UnknownError') ||
          errorMessage.includes('generic failures') ||
          errorMessage.includes('timeout') ||
          errorMessage.includes('resource');

        if (attempt < this.MAX_RETRIES && isRetryableError) {
          const delay = Math.pow(2, attempt - 1) * 1000; // 1s, 2s, 4s
          logger.warn('ANALYSIS_ORCHESTRATOR', `[${type}] Failed (attempt ${attempt}/${this.MAX_RETRIES}), retrying in ${delay}ms:`, errorMessage);
          await this.sleep(delay);
        } else if (attempt === this.MAX_RETRIES) {
          logger.error('ANALYSIS_ORCHESTRATOR', `[${type}] Failed after ${attempt} attempts:`, error);
          throw error;
        }
      } finally {
        // Ensure cleanup even on error
        try {
          await this.sessionManager.destroySession(languageContextId);
        } catch (cleanupError) {
          logger.warn('ANALYSIS_ORCHESTRATOR', `Failed to cleanup ${type} session:`, cleanupError);
        }
      }
    }

    throw new Error(`${type} analysis failed after ${this.MAX_RETRIES} attempts`);
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Convenience methods for each analysis type
   */

  async analyzeMethodology(
    paperId: string,
    hierarchicalSummary: string,
    contextId?: string
  ): Promise<MethodologyAnalysis> {
    return this.analyze<MethodologyAnalysis>('methodology', paperId, hierarchicalSummary, contextId);
  }

  async identifyConfounders(
    paperId: string,
    hierarchicalSummary: string,
    contextId?: string
  ): Promise<ConfounderAnalysis> {
    return this.analyze<ConfounderAnalysis>('confounders', paperId, hierarchicalSummary, contextId);
  }

  async analyzeImplications(
    paperId: string,
    hierarchicalSummary: string,
    contextId?: string
  ): Promise<ImplicationAnalysis> {
    return this.analyze<ImplicationAnalysis>('implications', paperId, hierarchicalSummary, contextId);
  }

  async identifyLimitations(
    paperId: string,
    hierarchicalSummary: string,
    contextId?: string
  ): Promise<LimitationAnalysis> {
    return this.analyze<LimitationAnalysis>('limitations', paperId, hierarchicalSummary, contextId);
  }
}
