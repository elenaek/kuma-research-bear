import { ResearchPaper, PaperAnalysisResult, QuestionAnswer } from '../../types/index.ts';
import { aiService } from '../../utils/aiService.ts';
import { getPaperByUrl, getPaperChunks, getRelevantChunks } from '../../utils/dbService.ts';
import * as operationStateService from '../services/operationStateService.ts';
import * as requestDeduplicationService from '../services/requestDeduplicationService.ts';
import * as paperStatusService from '../services/paperStatusService.ts';

/**
 * AI Message Handlers
 * Handles AI-related operations (explain, analyze, summarize, Q&A, glossary)
 */

/**
 * Broadcast operation state change
 */
function broadcastStateChange(state: any): void {
  chrome.runtime.sendMessage({
    type: 'OPERATION_STATE_CHANGED',
    payload: { state },
  }).catch(() => {
    // No listeners, that's ok
  });
}

/**
 * Check AI availability status
 */
export async function handleAIStatus(): Promise<any> {
  const capabilities = await aiService.checkAvailability();
  return { available: capabilities.available, capabilities };
}

/**
 * Initialize AI
 */
export async function handleInitializeAI(): Promise<any> {
  return await aiService.initializeAI();
}

/**
 * Reset AI
 */
export async function handleResetAI(): Promise<any> {
  return await aiService.resetAI();
}

/**
 * Explain a research paper (abstract)
 */
export async function handleExplainPaper(payload: any, tabId?: number): Promise<any> {
  try {
    const paper: ResearchPaper = payload.paper;

    // Update operation state to show explaining is in progress
    if (tabId) {
      const state = operationStateService.updateState(tabId, {
        isExplaining: true,
        explanationProgress: '🐻 Kuma is thinking of ways to explain the research paper...',
        currentPaper: paper,
        error: null,
      });
      broadcastStateChange(state);
    }

    // Generate context ID based on tab ID if available
    const contextId = tabId ? `tab-${tabId}-explain` : 'default-explain';

    const explanation = await aiService.explainAbstract(paper.abstract, contextId);
    const summary = await aiService.generateSummary(paper.title, paper.abstract, contextId);

    // Update operation state to show completion
    if (tabId) {
      const state = operationStateService.updateState(tabId, {
        isExplaining: false,
        explanationProgress: '🐻 Kuma has finished explaining the research paper!',
        error: null,
      });
      broadcastStateChange(state);
    }

    // Store in IndexedDB per-paper (single source of truth)
    // If storage fails, let the error propagate - we can't mark as "complete" if data isn't saved
    const storedPaper = await getPaperByUrl(paper.url);
    if (!storedPaper) {
      throw new Error('Paper not found in storage. Cannot save explanation.');
    }

    const { updatePaperExplanation } = await import('../../utils/dbService.ts');
    await updatePaperExplanation(storedPaper.id, explanation, summary);
    console.log('[AIHandlers] ✓ Explanation stored in IndexedDB');

    // Update completion tracking in operation state
    if (tabId) {
      const status = await paperStatusService.checkPaperStatus(storedPaper.url);
      operationStateService.updateState(tabId, {
        hasExplanation: status.hasExplanation,
        hasSummary: status.hasSummary,
        hasAnalysis: status.hasAnalysis,
        hasGlossary: status.hasGlossary,
        completionPercentage: status.completionPercentage,
      });
      console.log('[AIHandlers] ✓ Completion status updated:', status.completionPercentage + '%');
    }

    return { success: true, explanation, summary };
  } catch (explainError) {
    // Update operation state to show error
    if (tabId) {
      const state = operationStateService.updateState(tabId, {
        isExplaining: false,
        explanationProgress: '',
        error: `🐻 Kuma had trouble explaining: ${String(explainError)}`,
      });
      broadcastStateChange(state);
    }

    throw explainError;
  }
}

/**
 * Explain a text section
 */
export async function handleExplainSection(payload: any, tabId?: number): Promise<any> {
  const sectionText = payload.text;
  const sectionContextId = tabId ? `tab-${tabId}-section` : 'default-section';
  const simplified = await aiService.simplifyText(sectionText, sectionContextId);
  return { success: true, simplified };
}

/**
 * Explain a technical term
 */
export async function handleExplainTerm(payload: any, tabId?: number): Promise<any> {
  const term = payload.term;
  const context = payload.context;
  const termContextId = tabId ? `tab-${tabId}-term` : 'default-term';
  const termExplanation = await aiService.explainTerm(term, context, termContextId);
  return { success: true, explanation: termExplanation };
}

/**
 * Generate a summary
 */
export async function handleGenerateSummary(payload: any, tabId?: number): Promise<any> {
  const { title, abstract } = payload;
  const summaryContextId = tabId ? `tab-${tabId}-summary` : 'default-summary';
  const summaryResult = await aiService.generateSummary(title, abstract, summaryContextId);
  return { success: true, summary: summaryResult };
}

/**
 * Analyze a paper in depth
 */
export async function handleAnalyzePaper(payload: any, tabId?: number): Promise<any> {
  try {
    const paperUrl = payload.url;
    const analysisContextId = tabId ? `tab-${tabId}-analysis` : 'default-analysis';

    // Check for existing active request
    const requestKey = requestDeduplicationService.getRequestKey(tabId, 'analyze', paperUrl);
    if (requestDeduplicationService.hasRequest(requestKey)) {
      console.log(`[AIHandlers] Reusing existing analysis request for ${requestKey}`);

      // Update operation state to indicate cached request
      if (tabId) {
        const state = operationStateService.updateState(tabId, {
          isUsingCachedRequest: true,
          analysisProgress: 'Using existing analysis in progress...',
        });
        broadcastStateChange(state);
      }

      const existingAnalysis = await requestDeduplicationService.getRequest(requestKey);
      return { success: true, analysis: existingAnalysis };
    }

    // Update operation state to show analysis is starting
    if (tabId) {
      const state = operationStateService.updateState(tabId, {
        isAnalyzing: true,
        analysisProgress: '🐻 Kuma is deeply analyzing the research paper...',
        error: null,
      });
      broadcastStateChange(state);
    }

    // Create new analysis promise
    const analysisPromise = (async () => {
      // Retrieve paper from IndexedDB
      const storedPaper = await getPaperByUrl(paperUrl);

      if (!storedPaper) {
        throw new Error('Paper not found in storage. Please store the paper first.');
      }

      // Update state with current paper
      if (tabId) {
        const state = operationStateService.updateState(tabId, {
          currentPaper: storedPaper,
        });
        broadcastStateChange(state);
      }

      console.log(`[AIHandlers] Analyzing paper: ${storedPaper.title} with context: ${analysisContextId}`);

      // Get paper chunks for comprehensive analysis
      const chunks = await getPaperChunks(storedPaper.id);

      // Use fullText for analysis (more complete than abstract)
      const paperContent = storedPaper.fullText || storedPaper.abstract;

      // Run comprehensive analysis with context ID
      const analysis: PaperAnalysisResult = await aiService.analyzePaper(paperContent, analysisContextId);

      return analysis;
    })();

    // Store the promise for deduplication
    requestDeduplicationService.setRequest(requestKey, analysisPromise);

    try {
      const analysis = await analysisPromise;

      // Get the stored paper for storage operations
      const storedPaper = await getPaperByUrl(paperUrl);

      // Store in IndexedDB per-paper (single source of truth)
      // If storage fails, let the error propagate - we can't mark as "complete" if data isn't saved
      if (!storedPaper) {
        throw new Error('Paper not found in storage. Cannot save analysis.');
      }

      const { updatePaperAnalysis } = await import('../../utils/dbService.ts');
      await updatePaperAnalysis(storedPaper.id, analysis);
      console.log('[AIHandlers] ✓ Analysis stored in IndexedDB');

      // Update completion tracking in operation state
      if (tabId) {
        const status = await paperStatusService.checkPaperStatus(storedPaper.url);
        operationStateService.updateState(tabId, {
          hasExplanation: status.hasExplanation,
          hasSummary: status.hasSummary,
          hasAnalysis: status.hasAnalysis,
          hasGlossary: status.hasGlossary,
          completionPercentage: status.completionPercentage,
        });
        console.log('[AIHandlers] ✓ Completion status updated:', status.completionPercentage + '%');
      }

      // Update operation state to show completion
      if (tabId) {
        const state = operationStateService.updateState(tabId, {
          isAnalyzing: false,
          analysisProgress: '🐻 Kuma has finished analyzing the research paper!',
          error: null,
        });
        broadcastStateChange(state);

        // Clear the progress message after a delay
        setTimeout(() => {
          const state = operationStateService.updateState(tabId, {
            analysisProgress: '',
          });
          broadcastStateChange(state);
        }, 5000);
      }

      console.log('[AIHandlers] ✓ Paper analysis complete');
      return { success: true, analysis };
    } catch (analysisError) {
      console.error('[AIHandlers] Error analyzing paper:', analysisError);

      // Update operation state to show error
      if (tabId) {
        const state = operationStateService.updateState(tabId, {
          isAnalyzing: false,
          analysisProgress: '',
          error: `🐻 Kuma had trouble analyzing: ${String(analysisError)}`,
        });
        broadcastStateChange(state);
      }

      return {
        success: false,
        error: `Analysis failed: ${String(analysisError)}`
      };
    } finally {
      // Clean up the active request
      requestDeduplicationService.deleteRequest(requestKey);
    }
  } catch (error) {
    console.error('[AIHandlers] Error in analysis setup:', error);

    // Update operation state to show error
    if (tabId) {
      const state = operationStateService.updateState(tabId, {
        isAnalyzing: false,
        analysisProgress: '',
        error: `🐻 Kuma couldn't analyze: ${String(error)}`,
      });
      broadcastStateChange(state);
    }

    const requestKey = requestDeduplicationService.getRequestKey(tabId, 'analyze', payload.url);
    requestDeduplicationService.deleteRequest(requestKey);
    return {
      success: false,
      error: `Analysis failed: ${String(error)}`
    };
  }
}

/**
 * Generate glossary for a paper
 */
export async function handleGenerateGlossary(payload: any, tabId?: number): Promise<any> {
  try {
    const paperUrl = payload.url;
    const glossaryContextId = tabId ? `tab-${tabId}-glossary` : 'default-glossary';

    // Check for existing active request
    const requestKey = requestDeduplicationService.getRequestKey(tabId, 'glossary', paperUrl);
    if (requestDeduplicationService.hasRequest(requestKey)) {
      console.log(`[AIHandlers] Reusing existing glossary request for ${requestKey}`);
      const existingGlossary = await requestDeduplicationService.getRequest(requestKey);
      return { success: true, glossary: existingGlossary };
    }

    // Create new glossary generation promise
    const glossaryPromise = (async () => {
      // Retrieve paper from IndexedDB
      const storedPaper = await getPaperByUrl(paperUrl);

      if (!storedPaper) {
        throw new Error('Paper not found in storage. Please store the paper first.');
      }

      console.log(`[AIHandlers] Generating glossary for paper: ${storedPaper.title} with context: ${glossaryContextId}`);

      // Use fullText for glossary generation (more complete than abstract)
      const paperContent = storedPaper.fullText || storedPaper.abstract;

      // Generate glossary with context ID
      const glossary = await aiService.generateGlossary(paperContent, storedPaper.title, glossaryContextId);

      return glossary;
    })();

    // Store the promise for deduplication
    requestDeduplicationService.setRequest(requestKey, glossaryPromise);

    try {
      const glossary = await glossaryPromise;

      // Get the stored paper for storage operations
      const storedPaper = await getPaperByUrl(paperUrl);

      // Store in IndexedDB with the paper
      // If storage fails, let the error propagate - we can't mark as "complete" if data isn't saved
      if (!storedPaper) {
        throw new Error('Paper not found in storage. Cannot save glossary.');
      }

      const { updatePaperGlossary } = await import('../../utils/dbService.ts');
      await updatePaperGlossary(storedPaper.id, glossary);
      console.log('[AIHandlers] ✓ Glossary stored in IndexedDB');

      // Update completion tracking in operation state
      if (tabId) {
        const status = await paperStatusService.checkPaperStatus(storedPaper.url);
        operationStateService.updateState(tabId, {
          hasExplanation: status.hasExplanation,
          hasSummary: status.hasSummary,
          hasAnalysis: status.hasAnalysis,
          hasGlossary: status.hasGlossary,
          completionPercentage: status.completionPercentage,
        });
        console.log('[AIHandlers] ✓ Completion status updated:', status.completionPercentage + '%');
      }

      console.log('[AIHandlers] ✓ Glossary generation complete');
      return { success: true, glossary };
    } catch (glossaryError) {
      console.error('[AIHandlers] Error generating glossary:', glossaryError);
      return {
        success: false,
        error: `Glossary generation failed: ${String(glossaryError)}`
      };
    } finally {
      // Clean up the active request
      requestDeduplicationService.deleteRequest(requestKey);
    }
  } catch (error) {
    console.error('[AIHandlers] Error in glossary generation setup:', error);
    return {
      success: false,
      error: `Glossary generation failed: ${String(error)}`
    };
  }
}

/**
 * Answer a question about a paper using RAG
 */
export async function handleAskQuestion(payload: any, tabId?: number): Promise<any> {
  try {
    const { paperUrl, question } = payload;
    // Generate context ID for Q&A
    const qaContextId = tabId ? `tab-${tabId}-qa` : 'default-qa';

    if (!paperUrl || !question) {
      return {
        success: false,
        error: 'Paper URL and question are required'
      };
    }

    console.log(`[AIHandlers] Answering question about paper: ${paperUrl} with context: ${qaContextId}`);

    // Retrieve paper from IndexedDB
    const storedPaper = await getPaperByUrl(paperUrl);

    if (!storedPaper) {
      return {
        success: false,
        error: 'Paper not found in storage. Please store the paper first to ask questions.'
      };
    }

    // Get relevant chunks based on the question (top 5 chunks)
    const relevantChunks = await getRelevantChunks(storedPaper.id, question, 5);

    if (relevantChunks.length === 0) {
      return {
        success: false,
        error: 'No relevant content found to answer this question.'
      };
    }

    console.log(`[AIHandlers] Found ${relevantChunks.length} relevant chunks for question`);

    // Format chunks for AI
    const contextChunks = relevantChunks.map(chunk => ({
      content: chunk.content,
      section: chunk.section,
    }));

    // Use AI to answer the question with context ID
    const qaResult: QuestionAnswer = await aiService.answerQuestion(question, contextChunks, qaContextId);

    console.log('[AIHandlers] ✓ Question answered successfully');
    return { success: true, answer: qaResult };
  } catch (qaError) {
    console.error('[AIHandlers] Error answering question:', qaError);
    return {
      success: false,
      error: `Failed to answer question: ${String(qaError)}`
    };
  }
}
