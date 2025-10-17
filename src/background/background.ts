import { MessageType, ResearchPaper, ExplanationResult, PaperAnalysisResult, QuestionAnswer } from '../types/index.ts';
import { aiService } from '../utils/aiService.ts';
import { getPaperByUrl, getPaperChunks, getRelevantChunks } from '../utils/dbService.ts';

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
        });

        sendResponse({ success: true, explanation, summary });
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
