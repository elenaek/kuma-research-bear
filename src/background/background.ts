import { MessageType, ResearchPaper, ExplanationResult, PaperAnalysisResult, QuestionAnswer, OperationState } from '../types/index.ts';
import { aiService } from '../utils/aiService.ts';
import { getPaperByUrl, getPaperChunks, getRelevantChunks } from '../utils/dbService.ts';

// Persistent operation state tracking (per-tab)
const operationStates = new Map<number, OperationState>();

// Helper to get or create operation state for a tab
function getOperationState(tabId: number): OperationState {
  if (!operationStates.has(tabId)) {
    operationStates.set(tabId, {
      tabId,
      isDetecting: false,
      isExplaining: false,
      isAnalyzing: false,
      currentPaper: null,
      error: null,
      detectionProgress: '',
      explanationProgress: '',
      analysisProgress: '',
      lastUpdated: Date.now(),
    });
  }
  return operationStates.get(tabId)!;
}

// Helper to update state and broadcast changes
function updateOperationState(tabId: number, updates: Partial<OperationState>) {
  const state = getOperationState(tabId);
  Object.assign(state, updates, { lastUpdated: Date.now() });

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
          // Set flag to indicate explanation is in progress
          await chrome.storage.local.set({ isExplaining: true });

          const paper: ResearchPaper = message.payload.paper;
          const explanation = await aiService.explainAbstract(paper.abstract);
          const summary = await aiService.generateSummary(paper.title, paper.abstract);

          // Store the explanation
          await chrome.storage.local.set({
            lastExplanation: {
              paper,
              explanation,
              summary,
              timestamp: Date.now(),
            },
            isExplaining: false, // Clear flag when done
          });

          sendResponse({ success: true, explanation, summary });
        } catch (explainError) {
          // Clear flag on error
          await chrome.storage.local.set({ isExplaining: false });
          throw explainError;
        }
        break;

      case MessageType.EXPLAIN_SECTION:
        const sectionText = message.payload.text;
        const simplified = await aiService.simplifyText(sectionText);
        sendResponse({ success: true, simplified });
        break;

      case MessageType.EXPLAIN_TERM:
        const term = message.payload.term;
        const context = message.payload.context;
        const termExplanation = await aiService.explainTerm(term, context);
        sendResponse({ success: true, explanation: termExplanation });
        break;

      case MessageType.GENERATE_SUMMARY:
        const { title, abstract } = message.payload;
        const summaryResult = await aiService.generateSummary(title, abstract);
        sendResponse({ success: true, summary: summaryResult });
        break;

      case MessageType.ANALYZE_PAPER:
        try {
          const paperUrl = message.payload.url;

          // Retrieve paper from IndexedDB
          const storedPaper = await getPaperByUrl(paperUrl);

          if (!storedPaper) {
            sendResponse({
              success: false,
              error: 'Paper not found in storage. Please store the paper first.'
            });
            break;
          }

          console.log(`Analyzing paper: ${storedPaper.title}`);

          // Get paper chunks for comprehensive analysis
          const chunks = await getPaperChunks(storedPaper.id);

          // Use fullText for analysis (more complete than abstract)
          const paperContent = storedPaper.fullText || storedPaper.abstract;

          // Run comprehensive analysis
          const analysis: PaperAnalysisResult = await aiService.analyzePaper(paperContent);

          // Store analysis result
          await chrome.storage.local.set({
            lastAnalysis: {
              paper: storedPaper,
              analysis,
              timestamp: Date.now(),
            },
          });

          console.log('✓ Paper analysis complete');
          sendResponse({ success: true, analysis });
        } catch (analysisError) {
          console.error('Error analyzing paper:', analysisError);
          sendResponse({
            success: false,
            error: `Analysis failed: ${String(analysisError)}`
          });
        }
        break;

      case MessageType.ASK_QUESTION:
        try {
          const { paperUrl, question } = message.payload;

          if (!paperUrl || !question) {
            sendResponse({
              success: false,
              error: 'Paper URL and question are required'
            });
            break;
          }

          console.log(`Answering question about paper: ${paperUrl}`);

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

          // Use AI to answer the question
          const qaResult: QuestionAnswer = await aiService.answerQuestion(question, contextChunks);

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
              detectionProgress: 'Detecting paper...',
              error: null,
            });

            const detectResponse = await chrome.tabs.sendMessage(tabId, {
              type: MessageType.DETECT_PAPER,
            });

            if (!detectResponse.paper) {
              updateOperationState(tabId, {
                isDetecting: false,
                detectionProgress: '',
                error: 'No paper detected on this page',
              });
              sendResponse({ success: false, error: 'No paper detected' });
              return;
            }

            // Update state with detected paper
            updateOperationState(tabId, {
              isDetecting: false,
              detectionProgress: 'Paper detected!',
              currentPaper: detectResponse.paper,
            });

            // Phase 2: Explanation
            updateOperationState(tabId, {
              isExplaining: true,
              explanationProgress: 'Generating explanation...',
            });

            const explanation = await aiService.explainAbstract(detectResponse.paper.abstract);
            const summary = await aiService.generateSummary(detectResponse.paper.title, detectResponse.paper.abstract);

            // Store explanation
            await chrome.storage.local.set({
              lastExplanation: {
                paper: detectResponse.paper,
                explanation,
                summary,
                timestamp: Date.now(),
              },
              currentPaper: detectResponse.paper,
            });

            updateOperationState(tabId, {
              isExplaining: false,
              explanationProgress: 'Explanation complete!',
            });

            // Phase 3: Analysis (auto-trigger)
            updateOperationState(tabId, {
              isAnalyzing: true,
              analysisProgress: 'Analyzing paper...',
            });

            const paperUrl = detectResponse.paper.url;
            const storedPaper = await getPaperByUrl(paperUrl);

            if (storedPaper) {
              const paperContent = storedPaper.fullText || storedPaper.abstract;
              const analysis: PaperAnalysisResult = await aiService.analyzePaper(paperContent);

              // Store analysis
              await chrome.storage.local.set({
                lastAnalysis: {
                  paper: storedPaper,
                  analysis,
                  timestamp: Date.now(),
                },
              });

              updateOperationState(tabId, {
                isAnalyzing: false,
                analysisProgress: 'Analysis complete!',
              });
            } else {
              updateOperationState(tabId, {
                isAnalyzing: false,
                analysisProgress: '',
                error: 'Paper not found for analysis',
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

// Handle tab updates to enable/disable extension icon
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    const supportedSites = [
      'arxiv.org',
      'pubmed.ncbi.nlm.nih.gov',
      'ncbi.nlm.nih.gov/pmc',
      'biorxiv.org',
      'medrxiv.org',
      'scholar.google.com',
      'papers.ssrn.com',
    ];

    const isSupported = supportedSites.some(site => tab.url?.includes(site));

    if (isSupported) {
      chrome.action.setBadgeText({ text: '✓', tabId });
      chrome.action.setBadgeBackgroundColor({ color: '#22c55e', tabId });
    } else {
      chrome.action.setBadgeText({ text: '', tabId });
    }
  }
});

console.log('Research Bear background service worker loaded');
