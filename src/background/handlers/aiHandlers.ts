import { MessageType, ResearchPaper, PaperAnalysisResult, QuestionAnswer, GlossaryTerm } from '../../types/index.ts';
import { aiService } from '../../utils/aiService.ts';
import { getPaperByUrl, getPaperChunks, getRelevantChunks, getRelevantChunksSemantic } from '../../utils/dbService.ts';
import * as operationStateService from '../services/operationStateService.ts';
import * as requestDeduplicationService from '../services/requestDeduplicationService.ts';
import * as paperStatusService from '../services/paperStatusService.ts';
import { getOptimalRAGChunkCount } from '../../utils/adaptiveRAGService.ts';
import { logger } from '../../utils/logger.ts';

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

  // Include download progress state for popup reinitialization
  const { getDownloadProgressState } = await import('../background.ts');
  const progressState = await getDownloadProgressState();

  return {
    available: capabilities.available,
    capabilities,
    downloadProgress: progressState.downloadProgress,
    currentDownloadingModel: progressState.currentDownloadingModel
  };
}

/**
 * Initialize AI
 * Triggers initialization in the background without blocking the response.
 * Progress updates will be sent via MODEL_DOWNLOAD_PROGRESS messages.
 */
export async function handleInitializeAI(): Promise<any> {
  // Trigger initialization in background without blocking the response
  aiService.initializeAI().then((result) => {
    logger.debug('BACKGROUND_SCRIPT', '[aiHandlers] Initialization completed:', result);
  }).catch((error) => {
    logger.error('BACKGROUND_SCRIPT', '[aiHandlers] Initialization failed:', error);
  });

  // Return immediately so popup isn't blocked
  return {
    success: true,
    message: 'AI initialization started. Download progress will appear shortly.'
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
 */
export async function handleExplainPaper(payload: any, tabId?: number): Promise<any> {
  // Generate context ID based on tab ID if available
  const contextId = tabId ? `tab-${tabId}-explain` : 'default-explain';

  try {
    const paper: ResearchPaper = payload.paper;

    // Update operation state to show explaining is in progress
    if (tabId) {
      await operationStateService.updateStateAndBroadcast(tabId, {
        isExplaining: true,
        explanationProgress: '🐻 Kuma is thinking of ways to explain the research paper...',
        currentPaper: paper,
        error: null,
      });
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
      logger.debug('BACKGROUND_SCRIPT', `[AIHandlers] Paper is large (${storedPaper.fullText.length} chars), using hierarchical summary for comprehensive explanation`);
    } else {
      logger.debug('BACKGROUND_SCRIPT', `[AIHandlers] Paper is small (${storedPaper.fullText.length} chars), using abstract-only approach`);
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
      await operationStateService.updateStateAndBroadcast(tabId, {
        isExplaining: false,
        explanationProgress: '🐻 Kuma has finished explaining the research paper!',
        error: null,
      });
    }

    // Get output language for metadata
    const { getOutputLanguage } = await import('../../utils/settingsService.ts');
    const outputLanguage = await getOutputLanguage();

    const { updatePaperExplanation } = await import('../../utils/dbService.ts');
    await updatePaperExplanation(storedPaper.id, explanation, summary, outputLanguage);
    logger.debug('BACKGROUND_SCRIPT', '[AIHandlers] ✓ Explanation stored in IndexedDB');

    // Update completion tracking in operation state
    if (tabId) {
      const status = await paperStatusService.checkPaperStatus(storedPaper.url);
      await operationStateService.updateStateAndBroadcast(tabId, {
        hasExplanation: status.hasExplanation,
        hasSummary: status.hasSummary,
        hasAnalysis: status.hasAnalysis,
        hasGlossary: status.hasGlossary,
        completionPercentage: status.completionPercentage,
      });
      logger.debug('BACKGROUND_SCRIPT', '[AIHandlers] ✓ Completion status updated:', status.completionPercentage + '%');
    }

    return { success: true, explanation, summary };
  } catch (explainError) {
    // Update operation state to show error
    if (tabId) {
      await operationStateService.updateStateAndBroadcast(tabId, {
        isExplaining: false,
        explanationProgress: '',
        error: `🐻 Kuma had trouble explaining: ${String(explainError)}`,
      });
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
      logger.debug('BACKGROUND_SCRIPT', `[AIHandlers] Reusing existing explanation request for ${requestKey}`);
      const existingExplanation = await requestDeduplicationService.getRequest(requestKey);
      return { success: true, explanation: existingExplanation };
    }

    // Update operation state to show explanation is starting
    if (tabId) {
      await operationStateService.updateStateAndBroadcast(tabId, {
        isExplaining: true,
        explanationProgress: '🐻 Kuma is generating an explanation for the research paper...',
        error: null,
      });
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
        await operationStateService.updateStateAndBroadcast(tabId, {
          currentPaper: storedPaper,
        });
      }

      logger.debug('BACKGROUND_SCRIPT', `[AIHandlers] Generating explanation for paper: ${storedPaper.title} with context: ${contextId}`);

      // Determine if we should use hierarchical summary (for large papers)
      const THRESHOLD = 6000;
      const shouldUseHierarchicalSummary =
        storedPaper.hierarchicalSummary &&
        storedPaper.fullText.length > THRESHOLD;

      if (shouldUseHierarchicalSummary) {
        logger.debug('BACKGROUND_SCRIPT', `[AIHandlers] Paper is large (${storedPaper.fullText.length} chars), using hierarchical summary for comprehensive explanation`);
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
      logger.debug('BACKGROUND_SCRIPT', '[AIHandlers] ✓ Explanation stored in IndexedDB');

      // Update completion tracking in operation state
      if (tabId) {
        const status = await paperStatusService.checkPaperStatus(storedPaper.url);
        await operationStateService.updateStateAndBroadcast(tabId, {
          hasExplanation: status.hasExplanation,
          hasSummary: status.hasSummary,
          hasAnalysis: status.hasAnalysis,
          hasGlossary: status.hasGlossary,
          completionPercentage: status.completionPercentage,
        });
        logger.debug('BACKGROUND_SCRIPT', '[AIHandlers] ✓ Completion status updated:', status.completionPercentage + '%');
      }

      // Update operation state to show completion
      if (tabId) {
        await operationStateService.updateStateAndBroadcast(tabId, {
          isExplaining: false,
          explanationProgress: '🐻 Kuma has finished generating the explanation!',
          error: null,
        });

        // Clear the progress message after a delay
        setTimeout(async () => {
          await operationStateService.updateStateAndBroadcast(tabId, {
            explanationProgress: '',
          });
        }, 5000);
      }

      logger.debug('BACKGROUND_SCRIPT', '[AIHandlers] ✓ Paper explanation complete');
      return { success: true, explanation };
    } catch (explanationError) {
      logger.error('BACKGROUND_SCRIPT', '[AIHandlers] Error generating explanation:', explanationError);

      // Update operation state to show error
      if (tabId) {
        await operationStateService.updateStateAndBroadcast(tabId, {
          isExplaining: false,
          explanationProgress: '',
          error: `🐻 Kuma had trouble generating explanation: ${String(explanationError)}`,
        });
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
    logger.error('BACKGROUND_SCRIPT', '[AIHandlers] Error in explanation setup:', error);

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
      logger.debug('BACKGROUND_SCRIPT', `[AIHandlers] Reusing existing summary request for ${requestKey}`);
      const existingSummary = await requestDeduplicationService.getRequest(requestKey);
      return { success: true, summary: existingSummary };
    }

    // Update operation state to show summary generation is starting
    if (tabId) {
      await operationStateService.updateStateAndBroadcast(tabId, {
        isGeneratingSummary: true,
        summaryProgress: '🐻 Kuma is generating a summary for the research paper...',
        error: null,
      });
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
        await operationStateService.updateStateAndBroadcast(tabId, {
          currentPaper: storedPaper,
        });
      }

      logger.debug('BACKGROUND_SCRIPT', `[AIHandlers] Generating summary for paper: ${storedPaper.title} with context: ${contextId}`);

      // Determine if we should use hierarchical summary (for large papers)
      const THRESHOLD = 6000;
      const shouldUseHierarchicalSummary =
        storedPaper.hierarchicalSummary &&
        storedPaper.fullText.length > THRESHOLD;

      if (shouldUseHierarchicalSummary) {
        logger.debug('BACKGROUND_SCRIPT', `[AIHandlers] Paper is large (${storedPaper.fullText.length} chars), using hierarchical summary for comprehensive summary`);
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
      logger.debug('BACKGROUND_SCRIPT', '[AIHandlers] ✓ Summary stored in IndexedDB');

      // Update completion tracking in operation state
      if (tabId) {
        const status = await paperStatusService.checkPaperStatus(storedPaper.url);
        await operationStateService.updateStateAndBroadcast(tabId, {
          hasExplanation: status.hasExplanation,
          hasSummary: status.hasSummary,
          hasAnalysis: status.hasAnalysis,
          hasGlossary: status.hasGlossary,
          completionPercentage: status.completionPercentage,
        });
        logger.debug('BACKGROUND_SCRIPT', '[AIHandlers] ✓ Completion status updated:', status.completionPercentage + '%');
      }

      // Update operation state to show completion
      if (tabId) {
        await operationStateService.updateStateAndBroadcast(tabId, {
          isGeneratingSummary: false,
          summaryProgress: '🐻 Kuma has finished generating the summary!',
          error: null,
        });

        // Clear the progress message after a delay
        setTimeout(async () => {
          await operationStateService.updateStateAndBroadcast(tabId, {
            summaryProgress: '',
          });
        }, 5000);
      }

      logger.debug('BACKGROUND_SCRIPT', '[AIHandlers] ✓ Paper summary complete');
      return { success: true, summary };
    } catch (summaryError) {
      logger.error('BACKGROUND_SCRIPT', '[AIHandlers] Error generating summary:', summaryError);

      // Update operation state to show error
      if (tabId) {
        await operationStateService.updateStateAndBroadcast(tabId, {
          isGeneratingSummary: false,
          summaryProgress: '',
          error: `🐻 Kuma had trouble generating summary: ${String(summaryError)}`,
        });
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
    logger.error('BACKGROUND_SCRIPT', '[AIHandlers] Error in summary generation setup:', error);

    // Update operation state to show error
    if (tabId) {
      await operationStateService.updateStateAndBroadcast(tabId, {
        isGeneratingSummary: false,
        summaryProgress: '',
        error: `🐻 Kuma couldn't generate summary: ${String(error)}`,
      });
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
      logger.debug('BACKGROUND_SCRIPT', `[AIHandlers] Reusing existing analysis request for ${requestKey}`);

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
      await operationStateService.updateStateAndBroadcast(tabId, {
        isAnalyzing: true,
        analysisProgress: '🐻 Kuma is deeply analyzing the research paper...',
        error: null,
      });
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
        await operationStateService.updateStateAndBroadcast(tabId, {
          currentPaper: storedPaper,
        });
      }

      logger.debug('BACKGROUND_SCRIPT', `[AIHandlers] Analyzing paper: ${storedPaper.title} with context: ${analysisContextId}`);

      // Check if hierarchical summary exists, if not create it
      let hierarchicalSummary = storedPaper.hierarchicalSummary;
      if (!hierarchicalSummary) {
        logger.debug('BACKGROUND_SCRIPT', '[AIHandlers] No hierarchical summary found, generating one...');
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
          const { updatePaper, getPaperChunks, updateChunkTerms } = await import('../../utils/dbService.ts');
          await updatePaper(storedPaper.id, { hierarchicalSummary });
          logger.debug('BACKGROUND_SCRIPT', '[AIHandlers] ✓ Hierarchical summary generated and stored');

          // Store chunk terms for future use (glossarization, etc.)
          if (result.chunkTerms && result.chunkTerms.length > 0) {
            try {
              const chunks = await getPaperChunks(storedPaper.id);

              // Map chunkTerms array indices to actual chunk IDs
              const chunkTermsWithIds = result.chunkTerms
                .map((terms, index) => ({
                  chunkId: chunks[index]?.id,
                  terms: terms || []
                }))
                .filter(item => item.chunkId); // Only include valid chunk IDs

              if (chunkTermsWithIds.length > 0) {
                await updateChunkTerms(storedPaper.id, chunkTermsWithIds);
                logger.debug('BACKGROUND_SCRIPT', `[AIHandlers] ✓ Stored ${chunkTermsWithIds.length} chunk term arrays from hierarchical summarization`);
              }
            } catch (error) {
              logger.error('BACKGROUND_SCRIPT', '[AIHandlers] Failed to store chunk terms from hierarchical summarization:', error);
              // Non-critical error, continue with analysis
            }
          }
        } catch (error) {
          logger.error('BACKGROUND_SCRIPT', '[AIHandlers] Failed to generate hierarchical summary, using truncated content:', error);
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
        },
        async (section, result) => {
          // Section completion handler - broadcast partial results
          logger.debug('BACKGROUND_SCRIPT', `[Analysis] Section complete: ${section}`);

          // Broadcast section completion to sidepanel
          chrome.runtime.sendMessage({
            type: MessageType.ANALYSIS_SECTION_COMPLETE,
            payload: {
              paperUrl: storedPaper.url,
              section,
              result,
            },
          }).catch((error) => {
            logger.warn('BACKGROUND_SCRIPT', '[Analysis] Failed to broadcast section completion:', error);
          });

          // Update partial analysis in IndexedDB
          try {
            const { updatePartialPaperAnalysis } = await import('../../utils/dbService.ts');
            const { getOutputLanguage } = await import('../../utils/settingsService.ts');
            const outputLanguage = await getOutputLanguage();
            await updatePartialPaperAnalysis(storedPaper.id, section, result, outputLanguage);
          } catch (error) {
            logger.warn('BACKGROUND_SCRIPT', `[Analysis] Failed to store partial ${section} analysis:`, error);
          }
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
      logger.debug('BACKGROUND_SCRIPT', '[AIHandlers] ✓ Analysis stored in IndexedDB');

      // Update completion tracking in operation state
      if (tabId) {
        const status = await paperStatusService.checkPaperStatus(storedPaper.url);
        await operationStateService.updateStateAndBroadcast(tabId, {
          hasExplanation: status.hasExplanation,
          hasSummary: status.hasSummary,
          hasAnalysis: status.hasAnalysis,
          hasGlossary: status.hasGlossary,
          completionPercentage: status.completionPercentage,
        });
        logger.debug('BACKGROUND_SCRIPT', '[AIHandlers] ✓ Completion status updated:', status.completionPercentage + '%');
      }

      // Update operation state to show completion
      if (tabId) {
        await operationStateService.updateStateAndBroadcast(tabId, {
          isAnalyzing: false,
          analysisProgress: '🐻 Kuma has finished analyzing the research paper!',
          analysisProgressStage: null,
          currentAnalysisStep: 0,
          totalAnalysisSteps: 0,
          error: null,
        });

        // Clear the progress message after a delay
        setTimeout(async () => {
          await operationStateService.updateStateAndBroadcast(tabId, {
            analysisProgress: '',
          });
        }, 5000);
      }

      logger.debug('BACKGROUND_SCRIPT', '[AIHandlers] ✓ Paper analysis complete');
      return { success: true, analysis };
    } catch (analysisError) {
      logger.error('BACKGROUND_SCRIPT', '[AIHandlers] Error analyzing paper:', analysisError);

      // Update operation state to show error
      if (tabId) {
        await operationStateService.updateStateAndBroadcast(tabId, {
          isAnalyzing: false,
          analysisProgress: '',
          analysisProgressStage: null,
          currentAnalysisStep: 0,
          totalAnalysisSteps: 0,
          error: `🐻 Kuma had trouble analyzing: ${String(analysisError)}`,
        });
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
    logger.error('BACKGROUND_SCRIPT', '[AIHandlers] Error in analysis setup:', error);

    // Update operation state to show error
    if (tabId) {
      await operationStateService.updateStateAndBroadcast(tabId, {
        isAnalyzing: false,
        analysisProgress: '',
        analysisProgressStage: null,
        currentAnalysisStep: 0,
        totalAnalysisSteps: 0,
        error: `🐻 Kuma couldn't analyze: ${String(error)}`,
      });
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
      logger.debug('BACKGROUND_SCRIPT', `[AIHandlers] Reusing existing manual glossary request for ${requestKey}`);
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

      logger.debug('BACKGROUND_SCRIPT', `[AIHandlers] Generating glossary manually for paper: ${storedPaper.title}`);

      // Update operation state to show glossary generation is in progress
      if (tabId) {
        await operationStateService.updateStateAndBroadcast(tabId, {
          isGeneratingGlossary: true,
          glossaryProgress: '🐻 Kuma is generating a glossary for the research paper...',
          currentPaper: storedPaper,
          error: null,
        });
      }

      // Step 1: Extract terms from text chunks (same chunking as hierarchical summarization)
      sendProgress('extracting');
      logger.debug('BACKGROUND_SCRIPT', '[AIHandlers] Step 1: Extracting terms from text chunks...');

      // Use same chunking method as hierarchical summarization (5000 chars, 1000 overlap)
      const { chunkContent } = await import('../../utils/contentExtractor.ts');
      const fullText = storedPaper.fullText || storedPaper.abstract;
      const textChunks = chunkContent(fullText, 5000, 1000);

      // Transform to ContentChunk format for consistency with downstream code
      const chunks = textChunks.map((chunk, index) => ({
        id: `chunk_${storedPaper.id}_${index}`,
        paperId: storedPaper.id,
        content: chunk.content,
        index,
        section: chunk.heading,
        startChar: chunk.startIndex,
        endChar: chunk.endIndex,
        tokenCount: Math.ceil(chunk.content.length / 4),
      }));

      logger.debug('BACKGROUND_SCRIPT', '[AIHandlers] Created', chunks.length, 'text chunks (5000 chars, 1000 overlap)');

      // Extract terms from each chunk (10 terms per chunk, same as hierarchical summarization)
      logger.debug('BACKGROUND_SCRIPT', '[AIHandlers] Extracting terms from text chunks...');

      // Report initial progress
      sendProgress('extracting-terms-from-chunks', 0, chunks.length);

      // Extract terms from each chunk SEQUENTIALLY (Chrome's built-in AI can only process 1 task at a time)
      const chunkTermsResults = [];
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        logger.debug('BACKGROUND_SCRIPT', `[AIHandlers] Extracting terms from chunk ${i + 1}/${chunks.length}...`);

        const terms = await aiService.extractTermsFromChunk(
          chunk.content,
          storedPaper.title,
          `${glossaryContextId}-extract-chunk-${i}`,
          10 // Extract 10 terms per chunk
        );

        chunkTermsResults.push({ chunkId: chunk.id, terms });

        // Update progress after each chunk
        sendProgress('extracting-terms-from-chunks', i + 1, chunks.length);
        logger.debug('BACKGROUND_SCRIPT', `[AIHandlers] ✓ Chunk ${i + 1}/${chunks.length} complete, extracted ${terms.length} terms`);

        // Small delay between chunks to prevent resource contention
        if (i < chunks.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 150));
        }
      }

      logger.debug('BACKGROUND_SCRIPT', '[AIHandlers] ✓ Extracted terms from all', chunks.length, 'chunks');

      // Note: Terms extracted from text chunks (not stored in database)
      // Database chunks may have different boundaries (paragraph-based vs sentence-based)
      logger.debug('BACKGROUND_SCRIPT', '[AIHandlers] Terms extracted from text chunks (5000/1000), matching hierarchical summarization');

      // Aggregate all terms from chunks
      const allTerms = chunkTermsResults.flatMap(r => r.terms);
      logger.debug('BACKGROUND_SCRIPT', '[AIHandlers] ✓ Aggregated', allTerms.length, 'terms from chunks');

      if (allTerms.length === 0) {
        throw new Error('No terms extracted from chunks');
      }

      // Step 2: Batched deduplication (200 terms per batch to avoid context limits)
      sendProgress('filtering-terms');
      logger.debug('BACKGROUND_SCRIPT', '[AIHandlers] Step 2: Deduplicating terms in batches...');

      const dedupeBatchSize = 200;
      const deduplicatedBatches: string[] = [];

      for (let i = 0; i < allTerms.length; i += dedupeBatchSize) {
        const batch = allTerms.slice(i, i + dedupeBatchSize);
        logger.debug('BACKGROUND_SCRIPT', `[AIHandlers] Deduplicating batch ${Math.floor(i / dedupeBatchSize) + 1}/${Math.ceil(allTerms.length / dedupeBatchSize)} (${batch.length} terms)...`);

        try {
          const deduped = await aiService.deduplicateTermsBatch(
            batch,
            storedPaper.title,
            Math.ceil(50 * (batch.length / allTerms.length)), // Proportional target
            `${glossaryContextId}-dedupe-${i}`
          );
          deduplicatedBatches.push(...deduped);
        } catch (error) {
          logger.error('BACKGROUND_SCRIPT', `[AIHandlers] Error deduplicating batch:`, error);
          // Continue with next batch
        }
      }

      logger.debug('BACKGROUND_SCRIPT', '[AIHandlers] ✓ After batched deduplication:', deduplicatedBatches.length, 'terms');

      // Final deduplication pass if we have too many terms
      let deduplicatedTerms: string[];
      if (deduplicatedBatches.length > 60) {
        logger.debug('BACKGROUND_SCRIPT', '[AIHandlers] Final deduplication pass to reach target of ~50 terms...');
        deduplicatedTerms = await aiService.deduplicateTermsBatch(
          deduplicatedBatches,
          storedPaper.title,
          50,
          `${glossaryContextId}-dedupe-final`
        );
      } else {
        deduplicatedTerms = deduplicatedBatches;
      }

      logger.debug('BACKGROUND_SCRIPT', '[AIHandlers] ✓ Final deduplicated terms:', deduplicatedTerms.length);

      // Step 3: Generate definitions for each technical term using RAG + GeminiNano
      sendProgress('generating-definitions', 0, deduplicatedTerms.length);
      logger.debug('BACKGROUND_SCRIPT', '[AIHandlers] Step 3: Generating definitions for technical terms...');

      const glossaryTerms: GlossaryTerm[] = [];
      let successCount = 0;

      // Process definitions in batches (10 at a time to avoid input size limits)
      const definitionBatchSize = 10;
      const totalTerms = deduplicatedTerms.length;

      for (let i = 0; i < totalTerms; i += definitionBatchSize) {
        const batch = deduplicatedTerms.slice(i, i + definitionBatchSize);

        try {
          logger.debug('BACKGROUND_SCRIPT', `[AIHandlers] Generating ${batch.length} definitions in single prompt call (batch ${Math.floor(i / definitionBatchSize) + 1}/${Math.ceil(totalTerms / definitionBatchSize)})...`);

          // Generate all definitions in the batch with a SINGLE prompt call
          const batchTerms = await aiService.generateDefinitionsBatchWithRAG(
            batch,
            storedPaper.id,
            storedPaper.title,
            `${glossaryContextId}-batch-${i}`,
            true, // Use keyword-only search (faster for exact terms)
            { recentMessages: [] } // Conversation context for budget calculation
          );

          // Collect successful results
          batchTerms.forEach((term, idx) => {
            if (term) {
              glossaryTerms.push(term);
              successCount++;
              logger.debug('BACKGROUND_SCRIPT', `[AIHandlers] ✓ Definition generated for: ${batch[idx]}`);
            } else {
              logger.warn('BACKGROUND_SCRIPT', `[AIHandlers] ✗ Failed to generate definition for: ${batch[idx]}`);
            }
          });

          logger.debug('BACKGROUND_SCRIPT', `[AIHandlers] Batch complete: ${batchTerms.filter(t => t !== null).length}/${batch.length} successful`);
        } catch (error) {
          logger.error('BACKGROUND_SCRIPT', `[AIHandlers] Error generating batch definitions:`, error);
          // Continue to next batch on error
        }

        // Update progress
        sendProgress('generating-definitions', Math.min(i + definitionBatchSize, totalTerms), totalTerms);

        // Small delay between batches
        if (i + definitionBatchSize < totalTerms) {
          await new Promise(resolve => setTimeout(resolve, 300));
        }
      }

      logger.debug('BACKGROUND_SCRIPT', `[AIHandlers] Generated ${successCount}/${deduplicatedTerms.length} definitions successfully`);

      // Static deduplication: Remove any duplicate terms by acronym (case-insensitive)
      // This catches duplicates that Gemini Nano missed (e.g., "Dark Energy" appearing 4 times)
      const seenAcronyms = new Map<string, GlossaryTerm>();
      glossaryTerms.forEach(term => {
        const key = term.acronym.toLowerCase();
        if (!seenAcronyms.has(key)) {
          seenAcronyms.set(key, term);
        } else {
          logger.debug('BACKGROUND_SCRIPT', `[AIHandlers] Removing duplicate term: ${term.acronym}`);
        }
      });
      const finalGlossaryTerms = Array.from(seenAcronyms.values());
      logger.debug('BACKGROUND_SCRIPT', `[AIHandlers] After static deduplication: ${finalGlossaryTerms.length} unique terms (removed ${glossaryTerms.length - finalGlossaryTerms.length} duplicates)`);

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
      logger.debug('BACKGROUND_SCRIPT', '[AIHandlers] ✓ Glossary stored in IndexedDB');

      // Update completion tracking in operation state
      if (tabId) {
        const status = await paperStatusService.checkPaperStatus(storedPaper.url);
        await operationStateService.updateStateAndBroadcast(tabId, {
          hasExplanation: status.hasExplanation,
          hasSummary: status.hasSummary,
          hasAnalysis: status.hasAnalysis,
          hasGlossary: status.hasGlossary,
          completionPercentage: status.completionPercentage,
        });
        logger.debug('BACKGROUND_SCRIPT', '[AIHandlers] ✓ Completion status updated:', status.completionPercentage + '%');
      }

      // Update operation state to show completion
      if (tabId) {
        await operationStateService.updateStateAndBroadcast(tabId, {
          isGeneratingGlossary: false,
          glossaryProgress: '🐻 Kuma has finished generating the glossary!',
          glossaryProgressStage: null,
          currentGlossaryTerm: 0,
          totalGlossaryTerms: 0,
          error: null,
        });

        // Clear the progress message after a delay
        setTimeout(async () => {
          await operationStateService.updateStateAndBroadcast(tabId, {
            glossaryProgress: '',
            glossaryProgressStage: null,
            currentGlossaryTerm: 0,
            totalGlossaryTerms: 0,
          });
        }, 5000);
      }

      logger.debug('BACKGROUND_SCRIPT', '[AIHandlers] ✓ Manual glossary generation complete');
      return { success: true, glossary };
    } catch (glossaryError) {
      logger.error('BACKGROUND_SCRIPT', '[AIHandlers] Error generating manual glossary:', glossaryError);

      // Update operation state to show error
      if (tabId) {
        await operationStateService.updateStateAndBroadcast(tabId, {
          isGeneratingGlossary: false,
          glossaryProgress: '',
          glossaryProgressStage: null,
          currentGlossaryTerm: 0,
          totalGlossaryTerms: 0,
          error: `🐻 Kuma had trouble generating glossary: ${String(glossaryError)}`,
        });
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
    logger.error('BACKGROUND_SCRIPT', '[AIHandlers] Error in manual glossary generation setup:', error);

    // Update operation state to show error
    if (tabId) {
      await operationStateService.updateStateAndBroadcast(tabId, {
        isGeneratingGlossary: false,
        glossaryProgress: '',
        glossaryProgressStage: null,
        currentGlossaryTerm: 0,
        totalGlossaryTerms: 0,
        error: `🐻 Kuma couldn't generate glossary: ${String(error)}`,
      });
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

    logger.debug('BACKGROUND_SCRIPT', `[AIHandlers] Answering question about paper: ${paperUrl} with context: ${qaContextId}`);

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
      logger.warn('BACKGROUND_SCRIPT', `[AIHandlers] Insufficient space for minimum RAG chunks - budget: ${budgetStatus.usedTokens}/${budgetStatus.availableTokens} tokens`);
      logger.warn('BACKGROUND_SCRIPT', '[AIHandlers] Consider using a model with larger context window for better results');
    }

    if (trimmedChunks.length === 0) {
      return {
        success: false,
        error: 'No relevant content found to answer this question.'
      };
    }

    logger.debug('BACKGROUND_SCRIPT', `[AIHandlers] Found ${trimmedChunks.length} relevant chunks for question (retrieved ${relevantChunks.length}, trimmed by token budget)`);

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

    logger.debug('BACKGROUND_SCRIPT', '[AIHandlers] ✓ Question answered successfully');
    return { success: true, answer: qaResult };
  } catch (qaError) {
    logger.error('BACKGROUND_SCRIPT', '[AIHandlers] Error answering question:', qaError);
    return {
      success: false,
      error: `Failed to answer question: ${String(qaError)}`
    };
  } finally {
    aiService.destroySessionForContext(qaContextId);
  }
}
