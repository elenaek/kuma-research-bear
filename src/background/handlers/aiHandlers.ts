import { MessageType, ResearchPaper, PaperAnalysisResult, QuestionAnswer, GlossaryTerm } from '../../types/index.ts';
import { aiService } from '../../utils/aiService.ts';
import { getPaperByUrl, getPaperChunks, getRelevantChunks, getRelevantChunksSemantic } from '../../utils/dbService.ts';
import * as operationStateService from '../services/operationStateService.ts';
import * as requestDeduplicationService from '../services/requestDeduplicationService.ts';
import * as paperStatusService from '../services/paperStatusService.ts';
import { getOptimalRAGChunkCount } from '../../utils/adaptiveRAGService.ts';

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
  // Generate context ID based on tab ID if available
  const contextId = tabId ? `tab-${tabId}-explain` : 'default-explain';

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

    // Get stored paper to check for hierarchical summary
    const storedPaper = await getPaperByUrl(paper.url);
    if (!storedPaper) {
      throw new Error('Paper not found in storage. Cannot generate explanation.');
    }

    // Determine if we should use hierarchical summary (for large papers)
    const THRESHOLD = 6000; // Use hierarchical summary if paper exceeds this
    const shouldUseHierarchicalSummary =
      storedPaper.hierarchicalSummary &&
      storedPaper.fullText.length > THRESHOLD;

    if (shouldUseHierarchicalSummary) {
      console.log(`[AIHandlers] Paper is large (${storedPaper.fullText.length} chars), using hierarchical summary for comprehensive explanation`);
    } else {
      console.log(`[AIHandlers] Paper is small (${storedPaper.fullText.length} chars), using abstract-only approach`);
    }

    // Generate explanation and summary (with hierarchical summary for large papers)
    const explanation = await aiService.explainAbstract(
      paper.abstract,
      contextId,
      shouldUseHierarchicalSummary ? storedPaper.hierarchicalSummary : undefined
    );
    const summary = await aiService.generateSummary(
      paper.title,
      paper.abstract,
      contextId,
      shouldUseHierarchicalSummary ? storedPaper.hierarchicalSummary : undefined
    );

    // Update operation state to show completion
    if (tabId) {
      const state = operationStateService.updateState(tabId, {
        isExplaining: false,
        explanationProgress: '🐻 Kuma has finished explaining the research paper!',
        error: null,
      });
      broadcastStateChange(state);
    }

    // Get output language for metadata
    const { getOutputLanguage } = await import('../../utils/settingsService.ts');
    const outputLanguage = await getOutputLanguage();

    const { updatePaperExplanation } = await import('../../utils/dbService.ts');
    await updatePaperExplanation(storedPaper.id, explanation, summary, outputLanguage);
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
  } finally {
    // Always destroy the session when done, whether success or failure
    aiService.destroySessionForContext(contextId);
  }
}

/**
 * Explain a paper manually (URL-based, for manual triggering from UI)
 */
export async function handleExplainPaperManual(payload: any, tabId?: number): Promise<any> {
  const paperUrl = payload.url;
  const contextId = tabId ? `tab-${tabId}-explain-manual` : 'default-explain-manual';
  const requestKey = requestDeduplicationService.getRequestKey(tabId, 'explain-manual', paperUrl);

  try {
    // Check for existing active request
    if (requestDeduplicationService.hasRequest(requestKey)) {
      console.log(`[AIHandlers] Reusing existing explanation request for ${requestKey}`);
      const existingExplanation = await requestDeduplicationService.getRequest(requestKey);
      return { success: true, explanation: existingExplanation };
    }

    // Update operation state to show explanation is starting
    if (tabId) {
      const state = operationStateService.updateState(tabId, {
        isExplaining: true,
        explanationProgress: '🐻 Kuma is generating an explanation for the research paper...',
        error: null,
      });
      broadcastStateChange(state);
    }

    // Create new explanation promise
    const explanationPromise = (async () => {
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

      console.log(`[AIHandlers] Generating explanation for paper: ${storedPaper.title} with context: ${contextId}`);

      // Determine if we should use hierarchical summary (for large papers)
      const THRESHOLD = 6000;
      const shouldUseHierarchicalSummary =
        storedPaper.hierarchicalSummary &&
        storedPaper.fullText.length > THRESHOLD;

      if (shouldUseHierarchicalSummary) {
        console.log(`[AIHandlers] Paper is large (${storedPaper.fullText.length} chars), using hierarchical summary for comprehensive explanation`);
      }

      // Generate explanation
      const explanation = await aiService.explainAbstract(
        storedPaper.abstract,
        contextId,
        shouldUseHierarchicalSummary ? storedPaper.hierarchicalSummary : undefined
      );

      return { explanation, storedPaper };
    })();

    // Store the promise for deduplication
    requestDeduplicationService.setRequest(requestKey, explanationPromise);

    try {
      const { explanation, storedPaper } = await explanationPromise;

      // Get output language for metadata
      const { getOutputLanguage } = await import('../../utils/settingsService.ts');
      const outputLanguage = await getOutputLanguage();

      // Update paper with new explanation (preserve existing summary)
      const { updatePaper } = await import('../../utils/dbService.ts');
      await updatePaper(storedPaper.id, {
        explanation,
        explanationLanguage: outputLanguage,
      });
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

      // Update operation state to show completion
      if (tabId) {
        const state = operationStateService.updateState(tabId, {
          isExplaining: false,
          explanationProgress: '🐻 Kuma has finished generating the explanation!',
          error: null,
        });
        broadcastStateChange(state);

        // Clear the progress message after a delay
        setTimeout(() => {
          const state = operationStateService.updateState(tabId, {
            explanationProgress: '',
          });
          broadcastStateChange(state);
        }, 5000);
      }

      console.log('[AIHandlers] ✓ Paper explanation complete');
      return { success: true, explanation };
    } catch (explanationError) {
      console.error('[AIHandlers] Error generating explanation:', explanationError);

      // Update operation state to show error
      if (tabId) {
        const state = operationStateService.updateState(tabId, {
          isExplaining: false,
          explanationProgress: '',
          error: `🐻 Kuma had trouble generating explanation: ${String(explanationError)}`,
        });
        broadcastStateChange(state);
      }

      return {
        success: false,
        error: `Explanation generation failed: ${String(explanationError)}`
      };
    } finally {
      // Clean up the active request
      requestDeduplicationService.deleteRequest(requestKey);
    }
  } catch (error) {
    console.error('[AIHandlers] Error in explanation setup:', error);

    // Update operation state to show error
    if (tabId) {
      const state = operationStateService.updateState(tabId, {
        isExplaining: false,
        explanationProgress: '',
        error: `🐻 Kuma couldn't generate explanation: ${String(error)}`,
      });
      broadcastStateChange(state);
    }

    requestDeduplicationService.deleteRequest(requestKey);
    return {
      success: false,
      error: `Explanation generation failed: ${String(error)}`
    };
  } finally {
    // Always destroy the session when done
    aiService.destroySessionForContext(contextId);
  }
}

/**
 * Explain a text section
 */
export async function handleExplainSection(payload: any, tabId?: number): Promise<any> {
  const sectionContextId = tabId ? `tab-${tabId}-section` : 'default-section';
  try {
    const sectionText = payload.text;
    const simplified = await aiService.simplifyText(sectionText, sectionContextId);
    return { success: true, simplified };
  } finally {
    aiService.destroySessionForContext(sectionContextId);
  }
}

/**
 * Explain a technical term
 */
export async function handleExplainTerm(payload: any, tabId?: number): Promise<any> {
  const termContextId = tabId ? `tab-${tabId}-term` : 'default-term';
  try {
    const term = payload.term;
    const context = payload.context;
    const termExplanation = await aiService.explainTerm(term, context, termContextId);
    return { success: true, explanation: termExplanation };
  } finally {
    aiService.destroySessionForContext(termContextId);
  }
}

/**
 * Generate a summary
 */
export async function handleGenerateSummary(payload: any, tabId?: number): Promise<any> {
  const summaryContextId = tabId ? `tab-${tabId}-summary` : 'default-summary';
  try {
    const { title, abstract } = payload;
    const summaryResult = await aiService.generateSummary(title, abstract, summaryContextId);
    return { success: true, summary: summaryResult };
  } finally {
    aiService.destroySessionForContext(summaryContextId);
  }
}

/**
 * Generate summary manually (URL-based, for manual triggering from UI)
 */
export async function handleGenerateSummaryManual(payload: any, tabId?: number): Promise<any> {
  const paperUrl = payload.url;
  const contextId = tabId ? `tab-${tabId}-summary-manual` : 'default-summary-manual';
  const requestKey = requestDeduplicationService.getRequestKey(tabId, 'summary-manual', paperUrl);

  try {
    // Check for existing active request
    if (requestDeduplicationService.hasRequest(requestKey)) {
      console.log(`[AIHandlers] Reusing existing summary request for ${requestKey}`);
      const existingSummary = await requestDeduplicationService.getRequest(requestKey);
      return { success: true, summary: existingSummary };
    }

    // Update operation state to show summary generation is starting
    if (tabId) {
      const state = operationStateService.updateState(tabId, {
        isGeneratingSummary: true,
        summaryProgress: '🐻 Kuma is generating a summary for the research paper...',
        error: null,
      });
      broadcastStateChange(state);
    }

    // Create new summary generation promise
    const summaryPromise = (async () => {
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

      console.log(`[AIHandlers] Generating summary for paper: ${storedPaper.title} with context: ${contextId}`);

      // Determine if we should use hierarchical summary (for large papers)
      const THRESHOLD = 6000;
      const shouldUseHierarchicalSummary =
        storedPaper.hierarchicalSummary &&
        storedPaper.fullText.length > THRESHOLD;

      if (shouldUseHierarchicalSummary) {
        console.log(`[AIHandlers] Paper is large (${storedPaper.fullText.length} chars), using hierarchical summary for comprehensive summary`);
      }

      // Generate summary
      const summary = await aiService.generateSummary(
        storedPaper.title,
        storedPaper.abstract,
        contextId,
        shouldUseHierarchicalSummary ? storedPaper.hierarchicalSummary : undefined
      );

      return { summary, storedPaper };
    })();

    // Store the promise for deduplication
    requestDeduplicationService.setRequest(requestKey, summaryPromise);

    try {
      const { summary, storedPaper } = await summaryPromise;

      // Get output language for metadata
      const { getOutputLanguage } = await import('../../utils/settingsService.ts');
      const outputLanguage = await getOutputLanguage();

      // Update paper with new summary (preserve existing explanation)
      const { updatePaper } = await import('../../utils/dbService.ts');
      await updatePaper(storedPaper.id, {
        summary,
        summaryLanguage: outputLanguage,
      });
      console.log('[AIHandlers] ✓ Summary stored in IndexedDB');

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
          isGeneratingSummary: false,
          summaryProgress: '🐻 Kuma has finished generating the summary!',
          error: null,
        });
        broadcastStateChange(state);

        // Clear the progress message after a delay
        setTimeout(() => {
          const state = operationStateService.updateState(tabId, {
            summaryProgress: '',
          });
          broadcastStateChange(state);
        }, 5000);
      }

      console.log('[AIHandlers] ✓ Paper summary complete');
      return { success: true, summary };
    } catch (summaryError) {
      console.error('[AIHandlers] Error generating summary:', summaryError);

      // Update operation state to show error
      if (tabId) {
        const state = operationStateService.updateState(tabId, {
          isGeneratingSummary: false,
          summaryProgress: '',
          error: `🐻 Kuma had trouble generating summary: ${String(summaryError)}`,
        });
        broadcastStateChange(state);
      }

      return {
        success: false,
        error: `Summary generation failed: ${String(summaryError)}`
      };
    } finally {
      // Clean up the active request
      requestDeduplicationService.deleteRequest(requestKey);
    }
  } catch (error) {
    console.error('[AIHandlers] Error in summary generation setup:', error);

    // Update operation state to show error
    if (tabId) {
      const state = operationStateService.updateState(tabId, {
        isGeneratingSummary: false,
        summaryProgress: '',
        error: `🐻 Kuma couldn't generate summary: ${String(error)}`,
      });
      broadcastStateChange(state);
    }

    requestDeduplicationService.deleteRequest(requestKey);
    return {
      success: false,
      error: `Summary generation failed: ${String(error)}`
    };
  } finally {
    // Always destroy the session when done
    aiService.destroySessionForContext(contextId);
  }
}

/**
 * Analyze a paper in depth
 */
export async function handleAnalyzePaper(payload: any, tabId?: number): Promise<any> {
  const paperUrl = payload.url;
  const analysisContextId = tabId ? `tab-${tabId}-analysis` : 'default-analysis';
  const requestKey = requestDeduplicationService.getRequestKey(tabId, 'analyze', paperUrl);

  try {
    // Check for existing active request
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

      // Check if hierarchical summary exists, if not create it
      let hierarchicalSummary = storedPaper.hierarchicalSummary;
      if (!hierarchicalSummary) {
        console.log('[AIHandlers] No hierarchical summary found, generating one...');
        try {
          const fullText = storedPaper.fullText || storedPaper.abstract;
          const result = await aiService.createHierarchicalSummary(
            fullText,
            `${analysisContextId}-summary`,
            (current, total) => {
              // Update operation state with progress
              if (tabId) {
                operationStateService.updateState(tabId, {
                  analysisProgressStage: 'evaluating',
                  currentAnalysisStep: current,
                  totalAnalysisSteps: total,
                });
              }

              // Send progress update for hierarchical summary generation
              chrome.runtime.sendMessage({
                type: MessageType.ANALYSIS_PROGRESS,
                payload: {
                  stage: 'evaluating',
                  current,
                  total,
                },
              });
            }
          );

          // Extract summary string from result object
          hierarchicalSummary = result.summary;

          // Update stored paper with hierarchical summary for future use
          const { updatePaper } = await import('../../utils/dbService.ts');
          await updatePaper(storedPaper.id, { hierarchicalSummary });
          console.log('[AIHandlers] ✓ Hierarchical summary generated and stored');
        } catch (error) {
          console.error('[AIHandlers] Failed to generate hierarchical summary, using truncated content:', error);
          // Fallback to truncated content
          hierarchicalSummary = (storedPaper.fullText || storedPaper.abstract).slice(0, 2000);
        }
      }

      // Run comprehensive analysis with hierarchical summary + RAG
      const analysis: PaperAnalysisResult = await aiService.analyzePaper(
        storedPaper.id,
        hierarchicalSummary,
        analysisContextId,
        (step, total) => {
          // Update operation state with progress
          if (tabId) {
            operationStateService.updateState(tabId, {
              analysisProgressStage: 'analyzing',
              currentAnalysisStep: step,
              totalAnalysisSteps: total,
            });
          }

          // Send progress update for each analysis step
          chrome.runtime.sendMessage({
            type: MessageType.ANALYSIS_PROGRESS,
            payload: {
              stage: 'analyzing',
              current: step,
              total,
            },
          });
        }
      );

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

      // Get output language for metadata
      const { getOutputLanguage } = await import('../../utils/settingsService.ts');
      const outputLanguage = await getOutputLanguage();

      const { updatePaperAnalysis } = await import('../../utils/dbService.ts');
      await updatePaperAnalysis(storedPaper.id, analysis, outputLanguage);
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
          analysisProgressStage: null,
          currentAnalysisStep: 0,
          totalAnalysisSteps: 0,
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
          analysisProgressStage: null,
          currentAnalysisStep: 0,
          totalAnalysisSteps: 0,
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
        analysisProgressStage: null,
        currentAnalysisStep: 0,
        totalAnalysisSteps: 0,
        error: `🐻 Kuma couldn't analyze: ${String(error)}`,
      });
      broadcastStateChange(state);
    }

    requestDeduplicationService.deleteRequest(requestKey);
    return {
      success: false,
      error: `Analysis failed: ${String(error)}`
    };
  } finally {
    // Always destroy all analysis-related sessions when done
    // Main analysis session
    aiService.destroySessionForContext(analysisContextId);
    // Sub-sessions for individual analyses
    aiService.destroySessionForContext(`${analysisContextId}-methodology`);
    aiService.destroySessionForContext(`${analysisContextId}-confounders`);
    aiService.destroySessionForContext(`${analysisContextId}-implications`);
    aiService.destroySessionForContext(`${analysisContextId}-limitations`);
    // Hierarchical summary session if created
    aiService.destroySessionForContext(`${analysisContextId}-summary`);
  }
}


/**
 * Generate glossary manually using transformer-based keyword extraction + RAG
 * This is the new improved glossarization flow that:
 * 1. Extracts keywords using KeyBERT-style algorithm (EmbeddingGemma)
 * 2. Generates definitions for each keyword using hybrid RAG + GeminiNano
 * 3. Sends progress updates to UI
 */
export async function handleGenerateGlossaryManual(payload: any, tabId?: number): Promise<any> {
  const paperUrl = payload.url;
  const glossaryContextId = tabId ? `tab-${tabId}-glossary-manual` : 'default-glossary-manual';
  const requestKey = requestDeduplicationService.getRequestKey(tabId, 'glossary-manual', paperUrl);

  // Helper to send progress updates
  const sendProgress = (stage: string, current?: number, total?: number) => {
    if (tabId) {
      // Update operation state with progress information
      const state = operationStateService.updateState(tabId, {
        glossaryProgressStage: stage,
        currentGlossaryTerm: current || 0,
        totalGlossaryTerms: total || 0,
      });

      // Broadcast via runtime messages so sidepanel can receive it
      chrome.runtime.sendMessage({
        type: MessageType.GLOSSARY_PROGRESS,
        payload: {
          stage, // 'extracting' | 'filtering-terms' | 'generating-definitions'
          current, // current term being processed
          total, // total terms to process
        },
      }).catch(() => {
        // No listeners, that's ok
      });

      // Also broadcast state change so operation state listeners are notified
      broadcastStateChange(state);
    }
  };

  try {
    // Check for existing active request
    if (requestDeduplicationService.hasRequest(requestKey)) {
      console.log(`[AIHandlers] Reusing existing manual glossary request for ${requestKey}`);
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

      console.log(`[AIHandlers] Generating glossary manually for paper: ${storedPaper.title}`);

      // Update operation state to show glossary generation is in progress
      if (tabId) {
        const state = operationStateService.updateState(tabId, {
          isGeneratingGlossary: true,
          glossaryProgress: '🐻 Kuma is generating a glossary for the research paper...',
          currentPaper: storedPaper,
          error: null,
        });
        broadcastStateChange(state);
      }

      // Step 1: Aggregate terms from chunks
      sendProgress('extracting');
      console.log('[AIHandlers] Step 1: Aggregating terms from chunks...');

      const { getPaperChunks } = await import('../../utils/dbService.ts');
      const chunks = await getPaperChunks(storedPaper.id);

      // Check if chunks have terms (new papers will, old papers won't)
      const hasTerms = chunks.some(chunk => chunk.terms && chunk.terms.length > 0);

      let deduplicatedTerms: string[];

      if (!hasTerms) {
        // Fallback to Gemini-based extraction for legacy papers without pre-extracted chunk terms
        console.warn('[AIHandlers] Chunks do not have terms. Using Gemini fallback for legacy paper...');
        sendProgress('extracting');

        const paperContent = storedPaper.fullText || storedPaper.abstract;
        const extractedTerms = await aiService.extractTermsFromText(
          paperContent,
          storedPaper.title,
          `${glossaryContextId}-extract-fallback`,
          50
        );

        if (extractedTerms.length === 0) {
          throw new Error('Failed to extract terms via Gemini fallback');
        }

        // Simple deduplication (case-insensitive)
        deduplicatedTerms = Array.from(
          new Map(extractedTerms.map(term => [term.toLowerCase(), term])).values()
        );

        console.log('[AIHandlers] ✓ Gemini fallback extraction complete:', deduplicatedTerms.length, 'terms');
      } else {
        // New approach: Collect all terms from all chunks
        const allTerms: string[] = [];
        chunks.forEach(chunk => {
          if (chunk.terms && chunk.terms.length > 0) {
            allTerms.push(...chunk.terms);
          }
        });

        console.log('[AIHandlers] ✓ Aggregated', allTerms.length, 'terms from', chunks.length, 'chunks');
        console.log('[AIHandlers] Sample terms:', allTerms.slice(0, 10).join(', '));

        if (allTerms.length === 0) {
          throw new Error('No terms found in chunks');
        }

        // Step 2: Batched deduplication (200 terms per batch to avoid context limits)
        sendProgress('filtering-terms');
        console.log('[AIHandlers] Step 2: Deduplicating terms in batches...');

        const batchSize = 200;
        const deduplicatedBatches: string[] = [];

        for (let i = 0; i < allTerms.length; i += batchSize) {
          const batch = allTerms.slice(i, i + batchSize);
          console.log(`[AIHandlers] Deduplicating batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(allTerms.length / batchSize)} (${batch.length} terms)...`);

          try {
            const deduped = await aiService.deduplicateTermsBatch(
              batch,
              storedPaper.title,
              Math.ceil(50 * (batch.length / allTerms.length)), // Proportional target
              `${glossaryContextId}-dedupe-${i}`
            );
            deduplicatedBatches.push(...deduped);
          } catch (error) {
            console.error(`[AIHandlers] Error deduplicating batch:`, error);
            // Continue with next batch
          }
        }

        console.log('[AIHandlers] ✓ After batched deduplication:', deduplicatedBatches.length, 'terms');

        // Final deduplication pass if we have too many terms
        if (deduplicatedBatches.length > 40) {
          console.log('[AIHandlers] Running final deduplication pass...');
          deduplicatedTerms = await aiService.deduplicateTermsBatch(
            deduplicatedBatches,
            storedPaper.title,
            50, // Target 50 final terms
            `${glossaryContextId}-final-dedupe`
          );
        } else {
          deduplicatedTerms = deduplicatedBatches;
        }

        console.log('[AIHandlers] ✓ Final deduplicated terms:', deduplicatedTerms.length);
        console.log('[AIHandlers] Terms:', deduplicatedTerms.slice(0, 10).join(', '));
      }

      // Step 3: Generate definitions for each technical term using RAG + GeminiNano
      sendProgress('generating-definitions', 0, deduplicatedTerms.length);
      console.log('[AIHandlers] Step 3: Generating definitions for technical terms...');

      const glossaryTerms: GlossaryTerm[] = [];
      let successCount = 0;

      // Process definitions in batches (10 at a time to avoid input size limits)
      const batchSize = 10;
      const totalTerms = deduplicatedTerms.length;

      for (let i = 0; i < totalTerms; i += batchSize) {
        const batch = deduplicatedTerms.slice(i, i + batchSize);

        try {
          console.log(`[AIHandlers] Generating ${batch.length} definitions in single prompt call (batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(totalTerms / batchSize)})...`);

          // Generate all definitions in the batch with a SINGLE prompt call
          const batchTerms = await aiService.generateDefinitionsBatchWithRAG(
            batch,
            storedPaper.id,
            storedPaper.title,
            `${glossaryContextId}-batch-${i}`,
            true // Use keyword-only search (faster for exact terms)
          );

          // Collect successful results
          batchTerms.forEach((term, idx) => {
            if (term) {
              glossaryTerms.push(term);
              successCount++;
              console.log(`[AIHandlers] ✓ Definition generated for: ${batch[idx]}`);
            } else {
              console.warn(`[AIHandlers] ✗ Failed to generate definition for: ${batch[idx]}`);
            }
          });

          console.log(`[AIHandlers] Batch complete: ${batchTerms.filter(t => t !== null).length}/${batch.length} successful`);
        } catch (error) {
          console.error(`[AIHandlers] Error generating batch definitions:`, error);
          // Continue to next batch on error
        }

        // Update progress
        sendProgress('generating-definitions', Math.min(i + batchSize, totalTerms), totalTerms);

        // Small delay between batches
        if (i + batchSize < totalTerms) {
          await new Promise(resolve => setTimeout(resolve, 300));
        }
      }

      console.log(`[AIHandlers] Generated ${successCount}/${deduplicatedTerms.length} definitions successfully`);

      // Static deduplication: Remove any duplicate terms by acronym (case-insensitive)
      // This catches duplicates that Gemini Nano missed (e.g., "Dark Energy" appearing 4 times)
      const seenAcronyms = new Map<string, GlossaryTerm>();
      glossaryTerms.forEach(term => {
        const key = term.acronym.toLowerCase();
        if (!seenAcronyms.has(key)) {
          seenAcronyms.set(key, term);
        } else {
          console.log(`[AIHandlers] Removing duplicate term: ${term.acronym}`);
        }
      });
      const finalGlossaryTerms = Array.from(seenAcronyms.values());
      console.log(`[AIHandlers] After static deduplication: ${finalGlossaryTerms.length} unique terms (removed ${glossaryTerms.length - finalGlossaryTerms.length} duplicates)`);

      // Sort terms alphabetically
      finalGlossaryTerms.sort((a, b) => a.acronym.localeCompare(b.acronym));

      return {
        terms: finalGlossaryTerms,
        timestamp: Date.now(),
      };
    })();

    // Store the promise for deduplication
    requestDeduplicationService.setRequest(requestKey, glossaryPromise);

    try {
      const glossary = await glossaryPromise;

      // Get the stored paper for storage operations
      const storedPaper = await getPaperByUrl(paperUrl);

      // Store in IndexedDB with the paper
      if (!storedPaper) {
        throw new Error('Paper not found in storage. Cannot save glossary.');
      }

      // Get output language for metadata
      const { getOutputLanguage } = await import('../../utils/settingsService.ts');
      const outputLanguage = await getOutputLanguage();

      const { updatePaperGlossary } = await import('../../utils/dbService.ts');
      await updatePaperGlossary(storedPaper.id, glossary, outputLanguage);
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

      // Update operation state to show completion
      if (tabId) {
        const state = operationStateService.updateState(tabId, {
          isGeneratingGlossary: false,
          glossaryProgress: '🐻 Kuma has finished generating the glossary!',
          glossaryProgressStage: null,
          currentGlossaryTerm: 0,
          totalGlossaryTerms: 0,
          error: null,
        });
        broadcastStateChange(state);

        // Clear the progress message after a delay
        setTimeout(() => {
          const state = operationStateService.updateState(tabId, {
            glossaryProgress: '',
            glossaryProgressStage: null,
            currentGlossaryTerm: 0,
            totalGlossaryTerms: 0,
          });
          broadcastStateChange(state);
        }, 5000);
      }

      console.log('[AIHandlers] ✓ Manual glossary generation complete');
      return { success: true, glossary };
    } catch (glossaryError) {
      console.error('[AIHandlers] Error generating manual glossary:', glossaryError);

      // Update operation state to show error
      if (tabId) {
        const state = operationStateService.updateState(tabId, {
          isGeneratingGlossary: false,
          glossaryProgress: '',
          glossaryProgressStage: null,
          currentGlossaryTerm: 0,
          totalGlossaryTerms: 0,
          error: `🐻 Kuma had trouble generating glossary: ${String(glossaryError)}`,
        });
        broadcastStateChange(state);
      }

      return {
        success: false,
        error: `Manual glossary generation failed: ${String(glossaryError)}`
      };
    } finally {
      // Clean up the active request
      requestDeduplicationService.deleteRequest(requestKey);
    }
  } catch (error) {
    console.error('[AIHandlers] Error in manual glossary generation setup:', error);

    // Update operation state to show error
    if (tabId) {
      const state = operationStateService.updateState(tabId, {
        isGeneratingGlossary: false,
        glossaryProgress: '',
        glossaryProgressStage: null,
        currentGlossaryTerm: 0,
        totalGlossaryTerms: 0,
        error: `🐻 Kuma couldn't generate glossary: ${String(error)}`,
      });
      broadcastStateChange(state);
    }

    return {
      success: false,
      error: `Manual glossary generation failed: ${String(error)}`
    };
  } finally {
    // Always destroy all glossary sessions when done
    // Clean up all context IDs used during generation
    aiService.destroySessionForContext(glossaryContextId);
  }
}

/**
 * Answer a question about a paper using RAG
 */
export async function handleAskQuestion(payload: any, tabId?: number): Promise<any> {
  const qaContextId = tabId ? `tab-${tabId}-qa` : 'default-qa';

  try {
    const { paperUrl, question } = payload;

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

    // Get relevant chunks based on the question (adaptive limit based on inputQuota)
    // Get relevant chunks with adaptive oversampling based on paper's chunk size
    const { getAdaptiveChunkLimit, trimChunksByTokenBudget } = await import('../../utils/adaptiveRAGService.ts');
    const adaptiveLimit = await getAdaptiveChunkLimit(storedPaper.id, 'qa');
    const relevantChunks = await getRelevantChunksSemantic(storedPaper.id, question, adaptiveLimit);

    // Trim chunks to fit within token budget
    const { chunks: trimmedChunks, budgetStatus } = await trimChunksByTokenBudget(relevantChunks, 'qa');

    // Log warning if minimum chunks don't fit (Q&A doesn't have conversation history to summarize)
    if (!budgetStatus.minChunksFit) {
      console.warn(`[AIHandlers] Insufficient space for minimum RAG chunks - budget: ${budgetStatus.usedTokens}/${budgetStatus.availableTokens} tokens`);
      console.warn('[AIHandlers] Consider using a model with larger context window for better results');
    }

    if (trimmedChunks.length === 0) {
      return {
        success: false,
        error: 'No relevant content found to answer this question.'
      };
    }

    console.log(`[AIHandlers] Found ${trimmedChunks.length} relevant chunks for question (retrieved ${relevantChunks.length}, trimmed by token budget)`);

    // Format chunks for AI with position and hierarchy
    const contextChunks = trimmedChunks.map(chunk => ({
      content: chunk.content,
      section: chunk.section,
      index: chunk.index,
      parentSection: chunk.parentSection,
      paragraphIndex: chunk.paragraphIndex,
      sentenceGroupIndex: chunk.sentenceGroupIndex,
    }));

    // Sort chunks by document order (index) for better context
    contextChunks.sort((a, b) => a.index - b.index);

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
  } finally {
    aiService.destroySessionForContext(qaContextId);
  }
}
