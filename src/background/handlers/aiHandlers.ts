import { MessageType } from '../../shared/types/index.ts';
import { aiService } from '../../shared/utils/aiService.ts';
import { logger } from '../../shared/utils/logger.ts';
import { generateContextId } from '../utils/handlerUtils.ts';
import { ExplainOrchestrator } from '../orchestrators/ExplainOrchestrator.ts';
import { SummaryOrchestrator } from '../orchestrators/SummaryOrchestrator.ts';
import { AnalysisWorkflowOrchestrator } from '../orchestrators/AnalysisWorkflowOrchestrator.ts';
import { GlossaryWorkflowOrchestrator } from '../orchestrators/GlossaryWorkflowOrchestrator.ts';
import { QAOrchestrator } from '../orchestrators/QAOrchestrator.ts';

/**
 * AI Message Handlers
 * Thin delegation layer that routes requests to specialized orchestrators
 */

// Create orchestrator instances
const explainOrchestrator = new ExplainOrchestrator();
const summaryOrchestrator = new SummaryOrchestrator();
const analysisOrchestrator = new AnalysisWorkflowOrchestrator();
const glossaryOrchestrator = new GlossaryWorkflowOrchestrator();
const qaOrchestrator = new QAOrchestrator();

/**
 * Check AI availability status
 */
export async function handleAIStatus(): Promise<any> {
  const capabilities = await aiService.checkAvailability();

  // Include download progress state for popup reinitialization
  const { getDownloadProgressState } = await import('../background.ts');
  const progressState = await getDownloadProgressState();

  return {
    available: capabilities.available,
    capabilities,
    downloadProgress: progressState.downloadProgress,
    currentDownloadingModel: progressState.currentDownloadingModel,
  };
}

/**
 * Initialize AI
 * Triggers initialization in the background without blocking the response.
 * Progress updates will be sent via MODEL_DOWNLOAD_PROGRESS messages.
 */
export async function handleInitializeAI(): Promise<any> {
  // Trigger initialization in background without blocking the response
  aiService
    .initializeAI()
    .then((result) => {
      logger.debug('BACKGROUND_SCRIPT', '[aiHandlers] Initialization completed:', result);
    })
    .catch((error) => {
      logger.error('BACKGROUND_SCRIPT', '[aiHandlers] Initialization failed:', error);
    });

  // Return immediately so popup isn't blocked
  return {
    success: true,
    message: 'AI initialization started. Download progress will appear shortly.',
  };
}

/**
 * Reset AI
 */
export async function handleResetAI(): Promise<any> {
  return await aiService.resetAI();
}

/**
 * Explain a research paper (abstract)
 * Auto mode - triggered during paper storage
 */
export async function handleExplainPaper(payload: any, tabId?: number): Promise<any> {
  const contextId = generateContextId(tabId, 'explain');

  try {
    const paper = payload.paper;
    const { explanation, summary } = await explainOrchestrator.executeAuto(
      paper,
      tabId,
      contextId
    );
    return { success: true, explanation, summary };
  } catch (error) {
    throw error;
  }
}

/**
 * Explain a paper manually (URL-based, for manual triggering from UI)
 */
export async function handleExplainPaperManual(payload: any, tabId?: number): Promise<any> {
  const paperUrl = payload.url;
  const contextId = generateContextId(tabId, 'explain', '-manual');

  try {
    const explanation = await explainOrchestrator.executeManual(paperUrl, tabId, contextId);
    return { success: true, explanation };
  } catch (error) {
    return {
      success: false,
      error: `Explanation generation failed: ${String(error)}`,
    };
  }
}

/**
 * Explain a text section
 */
export async function handleExplainSection(payload: any, tabId?: number): Promise<any> {
  const contextId = generateContextId(tabId, 'section');

  try {
    const sectionText = payload.text;
    const simplified = await aiService.simplifyText(sectionText, contextId);
    return { success: true, simplified };
  } finally {
    await aiService.destroySessionForContext(contextId);
  }
}

/**
 * Explain a technical term
 */
export async function handleExplainTerm(payload: any, tabId?: number): Promise<any> {
  const contextId = generateContextId(tabId, 'term');

  try {
    const term = payload.term;
    const context = payload.context;
    const termExplanation = await aiService.explainTerm(term, context, contextId);
    return { success: true, explanation: termExplanation };
  } finally {
    await aiService.destroySessionForContext(contextId);
  }
}

/**
 * Generate a summary
 */
export async function handleGenerateSummary(payload: any, tabId?: number): Promise<any> {
  const contextId = generateContextId(tabId, 'summary');

  try {
    const { title, abstract } = payload;
    const summaryResult = await summaryOrchestrator.executeSimple(title, abstract, contextId);
    return { success: true, summary: summaryResult };
  } catch (error) {
    throw error;
  }
}

/**
 * Generate summary manually (URL-based, for manual triggering from UI)
 */
export async function handleGenerateSummaryManual(payload: any, tabId?: number): Promise<any> {
  const paperUrl = payload.url;
  const contextId = generateContextId(tabId, 'summary', '-manual');

  try {
    const summary = await summaryOrchestrator.executeManual(paperUrl, tabId, contextId);
    return { success: true, summary };
  } catch (error) {
    return {
      success: false,
      error: `Summary generation failed: ${String(error)}`,
    };
  }
}

/**
 * Analyze a paper in depth
 */
export async function handleAnalyzePaper(payload: any, tabId?: number): Promise<any> {
  const paperUrl = payload.url;
  const contextId = generateContextId(tabId, 'analysis');

  try {
    const analysis = await analysisOrchestrator.execute(paperUrl, tabId, contextId);
    return { success: true, analysis };
  } catch (error) {
    return {
      success: false,
      error: `Analysis failed: ${String(error)}`,
    };
  }
}

/**
 * Generate glossary manually using transformer-based keyword extraction + RAG
 */
export async function handleGenerateGlossaryManual(payload: any, tabId?: number): Promise<any> {
  const paperUrl = payload.url;
  const contextId = generateContextId(tabId, 'glossary', '-manual');

  try {
    const glossary = await glossaryOrchestrator.execute(paperUrl, tabId, contextId);
    return { success: true, glossary };
  } catch (error) {
    return {
      success: false,
      error: `Manual glossary generation failed: ${String(error)}`,
    };
  }
}

/**
 * Answer a question about a paper using RAG
 */
export async function handleAskQuestion(payload: any, tabId?: number): Promise<any> {
  const contextId = generateContextId(tabId, 'qa');

  try {
    const { paperUrl, question } = payload;
    const answer = await qaOrchestrator.execute(paperUrl, question, contextId);
    return { success: true, answer };
  } catch (error) {
    logger.error('BACKGROUND_SCRIPT', '[AIHandlers] Error answering question:', error);
    return {
      success: false,
      error: `Failed to answer question: ${String(error)}`,
    };
  }
}

/**
 * Destroy an AI session by context ID
 * Used for cleanup when closing image chat tabs
 */
export async function handleDestroyAISession(payload: any): Promise<any> {
  try {
    const { contextId } = payload;
    logger.debug('BACKGROUND_SCRIPT', '[AIHandlers] Destroying AI session:', contextId);

    await aiService.destroySessionForContext(contextId);

    logger.debug('BACKGROUND_SCRIPT', '[AIHandlers] ✓ AI session destroyed successfully');
    return { success: true };
  } catch (error) {
    logger.error('BACKGROUND_SCRIPT', '[AIHandlers] Failed to destroy AI session:', error);
    return { success: false, error: String(error) };
  }
}
