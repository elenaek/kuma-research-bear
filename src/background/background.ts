import { MessageType, ResearchPaper, ExplanationResult, PaperAnalysisResult, QuestionAnswer, OperationState } from '../types/index.ts';
import { aiService } from '../utils/aiService.ts';
import { getPaperByUrl, getPaperChunks, getRelevantChunks } from '../utils/dbService.ts';

// Persistent operation state tracking (per-tab)
const operationStates = new Map<number, OperationState>();

// Active request tracking for deduplication
// Key format: "tabId-operation-paperUrl" or similar
const activeRequests = new Map<string, Promise<any>>();

// Helper to generate request key for deduplication
function getRequestKey(tabId: number | undefined, operation: string, paperUrl?: string): string {
  const tabKey = tabId || 'default';
  return paperUrl ? `${tabKey}-${operation}-${paperUrl}` : `${tabKey}-${operation}`;
}

// Helper to get or create operation state for a tab
function getOperationState(tabId: number): OperationState {
  if (!operationStates.has(tabId)) {
    operationStates.set(tabId, {
      tabId,
      isDetecting: false,
      isExplaining: false,
      isAnalyzing: false,
      currentPaper: null,
      isPaperStored: false,
      error: null,
      detectionProgress: '',
      explanationProgress: '',
      analysisProgress: '',
      lastUpdated: Date.now(),
      activeAIRequests: [],
      isUsingCachedRequest: false,
    });
  }
  return operationStates.get(tabId)!;
}

// Icon paths configuration - paths must be absolute from extension root
const ICON_PATHS = {
  default: {
    16: '/icons/icon16.png',
    32: '/icons/icon32.png',
    48: '/icons/icon48.png',
    128: '/icons/icon128.png',
  },
  detecting: {
    16: '/icons/icon-detecting-16.png',
    32: '/icons/icon-detecting-32.png',
    48: '/icons/icon-detecting-48.png',
    128: '/icons/icon-detecting-128.png',
  },
  explaining: {
    16: '/icons/icon-explaining-16.png',
    32: '/icons/icon-explaining-32.png',
    48: '/icons/icon-explaining-48.png',
    128: '/icons/icon-explaining-128.png',
  },
  analyzing: {
    16: '/icons/icon-analyzing-16.png',
    32: '/icons/icon-analyzing-32.png',
    48: '/icons/icon-analyzing-48.png',
    128: '/icons/icon-analyzing-128.png',
  },
  stored: {
    16: '/icons/icon-stored-16.png',
    32: '/icons/icon-stored-32.png',
    48: '/icons/icon-stored-48.png',
    128: '/icons/icon-stored-128.png',
  },
};

// Helper function to update icon based on operation state
async function updateIconForTab(tabId: number, state: OperationState) {
  try {
    let iconType = 'default';

    // Priority: analyzing > explaining > detecting > stored > default
    if (state.isAnalyzing) {
      iconType = 'analyzing';
    } else if (state.isExplaining) {
      iconType = 'explaining';
    } else if (state.isDetecting) {
      iconType = 'detecting';
    } else if (state.isPaperStored && state.currentPaper) {
      iconType = 'stored';
    }

    console.log(`[Background] Updating icon for tab ${tabId}: ${iconType}, state:`, {
      isDetecting: state.isDetecting,
      isExplaining: state.isExplaining,
      isAnalyzing: state.isAnalyzing,
      isPaperStored: state.isPaperStored
    });

    const iconPaths = ICON_PATHS[iconType as keyof typeof ICON_PATHS];

    // Update the extension icon for this specific tab
    await chrome.action.setIcon({
      path: iconPaths,
      tabId: tabId,
    });

    // Also update the tooltip to show the current operation
    let title = 'Kuma the Research Bear';
    if (state.isAnalyzing) {
      title += ' - Analyzing paper...';
    } else if (state.isExplaining) {
      title += ' - Explaining paper...';
    } else if (state.isDetecting) {
      title += ' - Detecting paper...';
    } else if (state.isPaperStored && state.currentPaper) {
      title += ' - Paper saved';
    }

    await chrome.action.setTitle({
      title: title,
      tabId: tabId,
    });

    console.log(`[Background] Icon updated successfully for tab ${tabId}: ${iconType}`);
  } catch (error) {
    console.error(`[Background] Failed to update icon for tab ${tabId}:`, error);
    // Fallback to default icon on error
    try {
      await chrome.action.setIcon({
        path: ICON_PATHS.default,
        tabId: tabId,
      });
    } catch (fallbackError) {
      console.error('[Background] Failed to set default icon:', fallbackError);
    }
  }
}

// Helper to update state and broadcast changes
function updateOperationState(tabId: number, updates: Partial<OperationState>) {
  const state = getOperationState(tabId);
  Object.assign(state, updates, { lastUpdated: Date.now() });

  // Update the extension icon based on the new state
  updateIconForTab(tabId, state);

  // Broadcast state change to any listeners (sidepanel, popup)
  chrome.runtime.sendMessage({
    type: MessageType.OPERATION_STATE_CHANGED,
    payload: { state },
  }).catch(() => {
    // No listeners, that's ok
  });

  console.log('[Background] Operation state updated:', state);
}

// Handle extension installation
chrome.runtime.onInstalled.addListener(() => {
  console.log('Research Bear extension installed');

  // Set default settings
  chrome.storage.local.set({
    settings: {
      enableAutoDetect: true,
      defaultExplanationLevel: 'simple',
      theme: 'auto',
    },
  });
});

// Handle messages from content scripts and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender, sendResponse);
  return true; // Keep message channel open for async responses
});

async function handleMessage(message: any, sender: chrome.runtime.MessageSender, sendResponse: (response: any) => void) {
  try {
    switch (message.type) {
      case MessageType.AI_STATUS:
        const capabilities = await aiService.checkAvailability();
        sendResponse({ available: capabilities.available, capabilities });
        break;

      case MessageType.INITIALIZE_AI:
        const initResult = await aiService.initializeAI();
        sendResponse(initResult);
        break;

      case MessageType.RESET_AI:
        const resetResult = await aiService.resetAI();
        sendResponse(resetResult);
        break;

      case MessageType.EXPLAIN_PAPER:
        try {
          const paper: ResearchPaper = message.payload.paper;
          const tabId = message.payload.tabId || sender.tab?.id;

          // Update operation state to show explaining is in progress
          if (tabId) {
            updateOperationState(tabId, {
              isExplaining: true,
              explanationProgress: '🐻 Kuma is thinking of ways to explain the research paper...',
              currentPaper: paper,
              error: null,
            });
          }

          // Set flag to indicate explanation is in progress (for backwards compatibility)
          await chrome.storage.local.set({ isExplaining: true });

          // Generate context ID based on tab ID if available
          const contextId = tabId ? `tab-${tabId}-explain` : 'default-explain';

          const explanation = await aiService.explainAbstract(paper.abstract, contextId);
          const summary = await aiService.generateSummary(paper.title, paper.abstract, contextId);

          // Update operation state to show completion
          if (tabId) {
            updateOperationState(tabId, {
              isExplaining: false,
              explanationProgress: '🐻 Kuma has finished explaining the research paper!',
              error: null,
            });
          }

          // Store the explanation in chrome.storage (for quick access/backwards compatibility)
          await chrome.storage.local.set({
            lastExplanation: {
              paper,
              explanation,
              summary,
              timestamp: Date.now(),
            },
            isExplaining: false, // Clear flag when done
          });

          // Also store in IndexedDB per-paper for persistence
          try {
            const storedPaper = await getPaperByUrl(paper.url);
            if (storedPaper) {
              const { updatePaperExplanation } = await import('../utils/dbService.ts');
              await updatePaperExplanation(storedPaper.id, explanation, summary);
              console.log('[Background] ✓ Explanation stored in IndexedDB');
            }
          } catch (dbError) {
            console.warn('[Background] Failed to store explanation in IndexedDB:', dbError);
            // Don't fail the whole operation if IndexedDB update fails
          }

          sendResponse({ success: true, explanation, summary });
        } catch (explainError) {
          // Update operation state to show error
          const tabId = message.payload.tabId || sender.tab?.id;
          if (tabId) {
            updateOperationState(tabId, {
              isExplaining: false,
              explanationProgress: '',
              error: `🐻 Kuma had trouble explaining: ${String(explainError)}`,
            });
          }

          // Clear flag on error
          await chrome.storage.local.set({ isExplaining: false });
          throw explainError;
        }
        break;

      case MessageType.EXPLAIN_SECTION:
        const sectionText = message.payload.text;
        const sectionContextId = sender.tab?.id ? `tab-${sender.tab.id}-section` : 'default-section';
        const simplified = await aiService.simplifyText(sectionText, sectionContextId);
        sendResponse({ success: true, simplified });
        break;

      case MessageType.EXPLAIN_TERM:
        const term = message.payload.term;
        const context = message.payload.context;
        const termContextId = sender.tab?.id ? `tab-${sender.tab.id}-term` : 'default-term';
        const termExplanation = await aiService.explainTerm(term, context, termContextId);
        sendResponse({ success: true, explanation: termExplanation });
        break;

      case MessageType.GENERATE_SUMMARY:
        const { title, abstract } = message.payload;
        const summaryContextId = sender.tab?.id ? `tab-${sender.tab.id}-summary` : 'default-summary';
        const summaryResult = await aiService.generateSummary(title, abstract, summaryContextId);
        sendResponse({ success: true, summary: summaryResult });
        break;

      case MessageType.ANALYZE_PAPER:
        try {
          const paperUrl = message.payload.url;
          // Use tab ID from payload or sender for context
          const tabId = message.payload.tabId || sender.tab?.id;
          const analysisContextId = tabId ? `tab-${tabId}-analysis` : 'default-analysis';

          // Check for existing active request
          const requestKey = getRequestKey(tabId, 'analyze', paperUrl);
          if (activeRequests.has(requestKey)) {
            console.log(`[Background] Reusing existing analysis request for ${requestKey}`);

            // Update operation state to indicate cached request
            if (tabId) {
              updateOperationState(tabId, {
                isUsingCachedRequest: true,
                analysisProgress: 'Using existing analysis in progress...',
              });
            }

            const existingAnalysis = await activeRequests.get(requestKey);
            sendResponse({ success: true, analysis: existingAnalysis });
            break;
          }

          // Update operation state to show analysis is starting
          if (tabId) {
            updateOperationState(tabId, {
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
              updateOperationState(tabId, {
                currentPaper: storedPaper,
              });
            }

            console.log(`Analyzing paper: ${storedPaper.title} with context: ${analysisContextId}`);

            // Get paper chunks for comprehensive analysis
            const chunks = await getPaperChunks(storedPaper.id);

            // Use fullText for analysis (more complete than abstract)
            const paperContent = storedPaper.fullText || storedPaper.abstract;

            // Run comprehensive analysis with context ID
            const analysis: PaperAnalysisResult = await aiService.analyzePaper(paperContent, analysisContextId);

            return analysis;
          })();

          // Store the promise for deduplication
          activeRequests.set(requestKey, analysisPromise);

          try {
            const analysis = await analysisPromise;

            // Get the stored paper for storage operations
            const storedPaper = await getPaperByUrl(paperUrl);

            if (storedPaper) {
              // Store analysis result in chrome.storage (for quick access/backwards compatibility)
              await chrome.storage.local.set({
                lastAnalysis: {
                  paper: storedPaper,
                  analysis,
                  timestamp: Date.now(),
                },
              });

              // Also store in IndexedDB per-paper for persistence
              try {
                const { updatePaperAnalysis } = await import('../utils/dbService.ts');
                await updatePaperAnalysis(storedPaper.id, analysis);
                console.log('[Background] ✓ Analysis stored in IndexedDB');
              } catch (dbError) {
                console.warn('[Background] Failed to store analysis in IndexedDB:', dbError);
                // Don't fail the whole operation if IndexedDB update fails
              }
            }

            // Update operation state to show completion
            if (tabId) {
              updateOperationState(tabId, {
                isAnalyzing: false,
                analysisProgress: '🐻 Kuma has finished analyzing the research paper!',
                error: null,
              });

              // Clear the progress message after a delay
              setTimeout(() => {
                updateOperationState(tabId, {
                  analysisProgress: '',
                });
              }, 5000);
            }

            console.log('✓ Paper analysis complete');
            sendResponse({ success: true, analysis });
          } catch (analysisError) {
            console.error('Error analyzing paper:', analysisError);

            // Update operation state to show error
            if (tabId) {
              updateOperationState(tabId, {
                isAnalyzing: false,
                analysisProgress: '',
                error: `🐻 Kuma had trouble analyzing: ${String(analysisError)}`,
              });
            }

            sendResponse({
              success: false,
              error: `Analysis failed: ${String(analysisError)}`
            });
          } finally {
            // Clean up the active request
            activeRequests.delete(requestKey);
          }
        } catch (error) {
          console.error('Error in analysis setup:', error);

          // Update operation state to show error
          const tabId = message.payload.tabId || sender.tab?.id;
          if (tabId) {
            updateOperationState(tabId, {
              isAnalyzing: false,
              analysisProgress: '',
              error: `🐻 Kuma couldn't analyze: ${String(error)}`,
            });
          }

          const requestKey = getRequestKey(tabId, 'analyze', message.payload.url);
          activeRequests.delete(requestKey);
          sendResponse({
            success: false,
            error: `Analysis failed: ${String(error)}`
          });
        }
        break;

      case MessageType.GENERATE_GLOSSARY:
        try {
          const paperUrl = message.payload.url;
          // Use tab ID from payload or sender for context
          const tabId = message.payload.tabId || sender.tab?.id;
          const glossaryContextId = tabId ? `tab-${tabId}-glossary` : 'default-glossary';

          // Check for existing active request
          const requestKey = getRequestKey(tabId, 'glossary', paperUrl);
          if (activeRequests.has(requestKey)) {
            console.log(`[Background] Reusing existing glossary request for ${requestKey}`);
            const existingGlossary = await activeRequests.get(requestKey);
            sendResponse({ success: true, glossary: existingGlossary });
            break;
          }

          // Create new glossary generation promise
          const glossaryPromise = (async () => {
            // Retrieve paper from IndexedDB
            const storedPaper = await getPaperByUrl(paperUrl);

            if (!storedPaper) {
              throw new Error('Paper not found in storage. Please store the paper first.');
            }

            console.log(`Generating glossary for paper: ${storedPaper.title} with context: ${glossaryContextId}`);

            // Use fullText for glossary generation (more complete than abstract)
            const paperContent = storedPaper.fullText || storedPaper.abstract;

            // Generate glossary with context ID
            const glossary = await aiService.generateGlossary(paperContent, storedPaper.title, glossaryContextId);

            return glossary;
          })();

          // Store the promise for deduplication
          activeRequests.set(requestKey, glossaryPromise);

          try {
            const glossary = await glossaryPromise;

            // Get the stored paper for storage operations
            const storedPaper = await getPaperByUrl(paperUrl);

            if (storedPaper) {
              // Store in IndexedDB with the paper
              try {
                const { updatePaperGlossary } = await import('../utils/dbService.ts');
                await updatePaperGlossary(storedPaper.id, glossary);
                console.log('[Background] ✓ Glossary stored in IndexedDB');
              } catch (dbError) {
                console.warn('[Background] Failed to store glossary in IndexedDB:', dbError);
                // Don't fail the whole operation if IndexedDB update fails
              }
            }

            console.log('✓ Glossary generation complete');
            sendResponse({ success: true, glossary });
          } catch (glossaryError) {
            console.error('Error generating glossary:', glossaryError);
            sendResponse({
              success: false,
              error: `Glossary generation failed: ${String(glossaryError)}`
            });
          } finally {
            // Clean up the active request
            activeRequests.delete(requestKey);
          }
        } catch (error) {
          console.error('Error in glossary generation setup:', error);
          sendResponse({
            success: false,
            error: `Glossary generation failed: ${String(error)}`
          });
        }
        break;

      case MessageType.ASK_QUESTION:
        try {
          const { paperUrl, question } = message.payload;
          // Generate context ID for Q&A
          const qaTabId = message.payload.tabId || sender.tab?.id;
          const qaContextId = qaTabId ? `tab-${qaTabId}-qa` : 'default-qa';

          if (!paperUrl || !question) {
            sendResponse({
              success: false,
              error: 'Paper URL and question are required'
            });
            break;
          }

          console.log(`Answering question about paper: ${paperUrl} with context: ${qaContextId}`);

          // Retrieve paper from IndexedDB
          const storedPaper = await getPaperByUrl(paperUrl);

          if (!storedPaper) {
            sendResponse({
              success: false,
              error: 'Paper not found in storage. Please store the paper first to ask questions.'
            });
            break;
          }

          // Get relevant chunks based on the question (top 5 chunks)
          const relevantChunks = await getRelevantChunks(storedPaper.id, question, 5);

          if (relevantChunks.length === 0) {
            sendResponse({
              success: false,
              error: 'No relevant content found to answer this question.'
            });
            break;
          }

          console.log(`Found ${relevantChunks.length} relevant chunks for question`);

          // Format chunks for AI
          const contextChunks = relevantChunks.map(chunk => ({
            content: chunk.content,
            section: chunk.section,
          }));

          // Use AI to answer the question with context ID
          const qaResult: QuestionAnswer = await aiService.answerQuestion(question, contextChunks, qaContextId);

          console.log('✓ Question answered successfully');
          sendResponse({ success: true, answer: qaResult });
        } catch (qaError) {
          console.error('Error answering question:', qaError);
          sendResponse({
            success: false,
            error: `Failed to answer question: ${String(qaError)}`
          });
        }
        break;

      case MessageType.OPEN_SIDEPANEL:
        if (sender.tab?.id) {
          await chrome.sidePanel.open({ tabId: sender.tab.id });
          sendResponse({ success: true });
        } else {
          sendResponse({ success: false, error: 'No tab ID available' });
        }
        break;

      // IndexedDB operations (centralized in background worker)
      case MessageType.STORE_PAPER_IN_DB:
        try {
          console.log('[Background] Storing paper in IndexedDB:', message.payload.paper.title);
          const storedPaper = await (await import('../utils/dbService.ts')).storePaper(
            message.payload.paper,
            message.payload.fullText
          );
          console.log('[Background] ✓ Paper stored successfully:', storedPaper.id);

          // Update operation state to show paper is stored
          const tabId = message.payload.tabId || sender.tab?.id;
          if (tabId) {
            updateOperationState(tabId, {
              currentPaper: storedPaper,
              isPaperStored: true,
            });
          }

          sendResponse({ success: true, paper: storedPaper });
        } catch (dbError) {
          console.error('[Background] Failed to store paper:', dbError);
          sendResponse({ success: false, error: String(dbError) });
        }
        break;

      case MessageType.GET_PAPER_FROM_DB_BY_URL:
        try {
          console.log('[Background] Getting paper by URL:', message.payload.url);
          const paper = await getPaperByUrl(message.payload.url);
          console.log('[Background] Paper retrieval result:', paper ? 'Found' : 'Not found');
          sendResponse({ success: true, paper });
        } catch (dbError) {
          console.error('[Background] Failed to get paper:', dbError);
          sendResponse({ success: false, error: String(dbError), paper: null });
        }
        break;

      case MessageType.IS_PAPER_STORED_IN_DB:
        try {
          console.log('[Background] Checking if paper is stored:', message.payload.url);
          const isStored = await (await import('../utils/dbService.ts')).isPaperStored(message.payload.url);
          console.log('[Background] Paper stored check result:', isStored);
          sendResponse({ success: true, isStored });
        } catch (dbError) {
          console.error('[Background] Failed to check if paper stored:', dbError);
          sendResponse({ success: false, error: String(dbError), isStored: false });
        }
        break;

      case MessageType.GET_ALL_PAPERS_FROM_DB:
        try {
          console.log('[Background] Getting all papers from IndexedDB');
          const papers = await (await import('../utils/dbService.ts')).getAllPapers();
          console.log('[Background] Retrieved', papers.length, 'papers');
          sendResponse({ success: true, papers });
        } catch (dbError) {
          console.error('[Background] Failed to get all papers:', dbError);
          sendResponse({ success: false, error: String(dbError), papers: [] });
        }
        break;

      case MessageType.DELETE_PAPER_FROM_DB:
        try {
          console.log('[Background] Deleting paper:', message.payload.paperId);
          const deleted = await (await import('../utils/dbService.ts')).deletePaper(message.payload.paperId);
          console.log('[Background] Paper deletion result:', deleted);
          sendResponse({ success: deleted });
        } catch (dbError) {
          console.error('[Background] Failed to delete paper:', dbError);
          sendResponse({ success: false, error: String(dbError) });
        }
        break;

      case MessageType.UPDATE_PAPER_QA_HISTORY:
        try {
          console.log('[Background] Updating Q&A history for paper:', message.payload.paperId);
          const updated = await (await import('../utils/dbService.ts')).updatePaperQAHistory(
            message.payload.paperId,
            message.payload.qaHistory
          );
          console.log('[Background] Q&A history update result:', updated);
          sendResponse({ success: updated });
        } catch (dbError) {
          console.error('[Background] Failed to update Q&A history:', dbError);
          sendResponse({ success: false, error: String(dbError) });
        }
        break;

      case MessageType.GET_OPERATION_STATE:
        try {
          const tabId = message.payload?.tabId || sender.tab?.id;
          if (!tabId) {
            sendResponse({ success: false, error: 'No tab ID provided' });
            break;
          }
          const state = getOperationState(tabId);
          console.log('[Background] Returning operation state for tab', tabId, state);
          sendResponse({ success: true, state });
        } catch (error) {
          console.error('[Background] Error getting operation state:', error);
          sendResponse({ success: false, error: String(error) });
        }
        break;

      case MessageType.START_DETECT_AND_EXPLAIN:
        (async () => {
          const tabId = message.payload?.tabId || sender.tab?.id;
          if (!tabId) {
            sendResponse({ success: false, error: 'No tab ID provided' });
            return;
          }

          try {
            console.log('[Background] Starting detect and explain flow for tab', tabId);

            // Phase 1: Detection
            updateOperationState(tabId, {
              isDetecting: true,
              detectionProgress: '🐻 Kuma is foraging for research papers... (Detecting paper)',
              error: null,
            });

            const detectResponse = await chrome.tabs.sendMessage(tabId, {
              type: MessageType.DETECT_PAPER,
            });

            if (!detectResponse.paper) {
              updateOperationState(tabId, {
                isDetecting: false,
                detectionProgress: '',
                error: '🐻 Kuma didn\'t find any research papers. (No paper detected on this page)',
              });
              sendResponse({ success: false, error: '🐻 Kuma didn\'t find any research papers. (No paper detected)' });
              return;
            }

            // Check if paper is already stored in DB
            let isPaperStored = false;
            if (detectResponse.paper && detectResponse.alreadyStored) {
              isPaperStored = true;
              console.log('[Background] Paper is already stored in DB');
            }

            // Update state with detected paper
            updateOperationState(tabId, {
              isDetecting: true,
              detectionProgress: '🐻 Kuma found a research paper! (Paper detected!)',
              currentPaper: detectResponse.paper,
              isPaperStored: isPaperStored,
            });

            // Phase 2: Explanation
            updateOperationState(tabId, {
              isDetecting: false,
              isExplaining: true,
              explanationProgress: '🐻 Kuma is thinking of ways to explain the research paper... (Generating explanation)',
            });

            // Use tab ID for context
            const explainContextId = `tab-${tabId}-explain`;
            const explanation = await aiService.explainAbstract(detectResponse.paper.abstract, explainContextId);
            const summary = await aiService.generateSummary(detectResponse.paper.title, detectResponse.paper.abstract, explainContextId);

            // Store explanation in chrome.storage (for quick access/backwards compatibility)
            await chrome.storage.local.set({
              lastExplanation: {
                paper: detectResponse.paper,
                explanation,
                summary,
                timestamp: Date.now(),
              },
              currentPaper: detectResponse.paper,
            });

            // Also store in IndexedDB per-paper for persistence
            try {
              const storedPaperForExplanation = await getPaperByUrl(detectResponse.paper.url);
              if (storedPaperForExplanation) {
                const { updatePaperExplanation } = await import('../utils/dbService.ts');
                await updatePaperExplanation(storedPaperForExplanation.id, explanation, summary);
                console.log('[Background] ✓ Explanation stored in IndexedDB');
              }
            } catch (dbError) {
              console.warn('[Background] Failed to store explanation in IndexedDB:', dbError);
              // Don't fail the whole operation if IndexedDB update fails
            }

            updateOperationState(tabId, {
              isDetecting: false,
              isExplaining: true,
              explanationProgress: '🐻 Kuma has finished explaining the research paper! (Explanation complete!)',
            });

            // Phase 3: Analysis (auto-trigger)
            updateOperationState(tabId, {
              isDetecting: false,
              isExplaining: false,
              isAnalyzing: true,
              analysisProgress: '🐻 Kuma is deeply analyzing the research paper... (Analyzing paper)',
            });

            const paperUrl = detectResponse.paper.url;
            const storedPaper = await getPaperByUrl(paperUrl);

            if (storedPaper) {
              // Update state to show paper is stored
              updateOperationState(tabId, {
                isPaperStored: true,
              });

              const paperContent = storedPaper.fullText || storedPaper.abstract;
              const analysisContextId = `tab-${tabId}-analysis`;
              const analysis: PaperAnalysisResult = await aiService.analyzePaper(paperContent, analysisContextId);

              // Store analysis in chrome.storage (for quick access/backwards compatibility)
              await chrome.storage.local.set({
                lastAnalysis: {
                  paper: storedPaper,
                  analysis,
                  timestamp: Date.now(),
                },
              });

              // Also store in IndexedDB per-paper for persistence
              try {
                const { updatePaperAnalysis } = await import('../utils/dbService.ts');
                await updatePaperAnalysis(storedPaper.id, analysis);
                console.log('[Background] ✓ Analysis stored in IndexedDB');
              } catch (dbError) {
                console.warn('[Background] Failed to store analysis in IndexedDB:', dbError);
                // Don't fail the whole operation if IndexedDB update fails
              }

              updateOperationState(tabId, {
                isDetecting: false,
                isExplaining: false,
                isAnalyzing: true,
                analysisProgress: '🐻 Kuma has finished analyzing the research paper! (Analysis complete!)',
              });

              setTimeout(() =>{
                // Get current state to preserve isPaperStored
                const currentState = getOperationState(tabId);
                updateOperationState(tabId, {
                  isDetecting: false,
                  isExplaining: false,
                  isAnalyzing: false,
                  analysisProgress: '',
                  error: null,
                  // Preserve the isPaperStored state
                  isPaperStored: currentState.isPaperStored,
                });
              }, 5000);
            } else {
              updateOperationState(tabId, {
                isDetecting: false,
                isAnalyzing: false,
                isExplaining: false,
                analysisProgress: '',
                error: '🐻 Kuma could not find a research paper to analyze. (Paper not found for analysis)',
              });
            }

            sendResponse({ success: true, paper: detectResponse.paper });
          } catch (flowError) {
            console.error('[Background] Error in detect and explain flow:', flowError);
            updateOperationState(tabId, {
              isDetecting: false,
              isExplaining: false,
              isAnalyzing: false,
              detectionProgress: '',
              explanationProgress: '',
              analysisProgress: '',
              error: String(flowError),
            });
            sendResponse({ success: false, error: String(flowError) });
          }
        })();
        return true; // Keep channel open for async response

      default:
        sendResponse({ success: false, error: 'Unknown message type' });
    }
  } catch (error) {
    console.error('Error handling message:', error);
    sendResponse({ success: false, error: String(error) });
  }
}

// Handle tab updates - removed site restrictions to allow extension on any site
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    // Extension now works on ALL sites - no restrictions
    // The badge has been removed in favor of dynamic icon changes
    // Icons will change based on operation state (detecting/explaining/analyzing)

    // Clear any existing badge to avoid conflicts with icon changes
    chrome.action.setBadgeText({ text: '', tabId });
  }
});

// Handle tab activation to update icon based on current tab's state
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const { tabId } = activeInfo;

  // Check if we have an operation state for this tab
  if (operationStates.has(tabId)) {
    const state = operationStates.get(tabId)!;
    await updateIconForTab(tabId, state);
    console.log(`[Background] Tab ${tabId} activated, icon updated based on current state`);
  } else {
    // Reset to default icon if no state exists
    try {
      await chrome.action.setIcon({
        path: ICON_PATHS.default,
        tabId: tabId,
      });
      await chrome.action.setTitle({
        title: 'Kuma the Research Bear',
        tabId: tabId,
      });
    } catch (error) {
      console.error(`[Background] Failed to reset icon for tab ${tabId}:`, error);
    }
  }
});

// Clean up AI sessions when tabs are closed
chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  console.log(`[Background] Tab ${tabId} closed, cleaning up AI sessions...`);

  // Clean up all session contexts for this tab
  const contextPrefixes = [
    `tab-${tabId}-explain`,
    `tab-${tabId}-section`,
    `tab-${tabId}-term`,
    `tab-${tabId}-summary`,
    `tab-${tabId}-analysis`,
    `tab-${tabId}-qa`,
    `tab-${tabId}-extraction`,
  ];

  for (const contextId of contextPrefixes) {
    aiService.destroySessionForContext(contextId);
  }

  // Clean up active requests for this tab
  const requestsToDelete: string[] = [];
  for (const [key] of activeRequests) {
    if (key.startsWith(`${tabId}-`) || key.startsWith(`tab-${tabId}-`)) {
      requestsToDelete.push(key);
    }
  }

  for (const key of requestsToDelete) {
    activeRequests.delete(key);
    console.log(`[Background] Cleaned up active request: ${key}`);
  }

  // Also clean up operation state for this tab
  if (operationStates.has(tabId)) {
    operationStates.delete(tabId);
    console.log(`[Background] Cleaned up operation state for tab ${tabId}`);
  }

  // Reset icon to default (cleanup any custom icons)
  // Note: Icon is automatically cleaned up when tab is closed, but this is for consistency
});

console.log('Research Bear background service worker loaded');
