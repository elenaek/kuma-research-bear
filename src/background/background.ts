import { MessageType, ResearchPaper, ExplanationResult, PaperAnalysisResult } from '../types/index.ts';
import { aiService } from '../utils/aiService.ts';
import { getPaperByUrl, getPaperChunks } from '../utils/dbService.ts';

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

      case MessageType.OPEN_SIDEPANEL:
        if (sender.tab?.id) {
          await chrome.sidePanel.open({ tabId: sender.tab.id });
          sendResponse({ success: true });
        } else {
          sendResponse({ success: false, error: 'No tab ID available' });
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
