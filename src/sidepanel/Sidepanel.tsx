import { useState, useEffect } from 'preact/hooks';
import { Copy, RefreshCw, ExternalLink, FileText, Calendar, BookOpen, Hash, Download, Database, Clock, AlertCircle, CheckCircle, TrendingUp, AlertTriangle, Loader, PawPrint, ChevronLeft, ChevronRight, Trash2, Settings, ChevronDown, ChevronUp } from 'lucide-preact';
import { ResearchPaper, ExplanationResult, SummaryResult, StoredPaper, PaperAnalysisResult, QuestionAnswer, GlossaryResult } from '../types/index.ts';
import { MarkdownRenderer } from '../components/MarkdownRenderer.tsx';
import { Tooltip } from '../components/Tooltip.tsx';
import { GlossaryList } from '../components/GlossaryCard.tsx';
import { useDebounce } from './hooks/useDebounce.ts';
import { usePaperNavigation } from './hooks/usePaperNavigation.ts';
import { useOperationState } from './hooks/useOperationState.ts';
import { usePaperData } from './hooks/usePaperData.ts';
import { QASection } from './components/QASection.tsx';
import { AnalysisSection } from './components/AnalysisSection.tsx';
import { GlossarySection } from './components/GlossarySection.tsx';
import { PaperManagement } from './components/PaperManagement.tsx';
import { OriginalPaperTab } from './components/OriginalPaperTab.tsx';
import { PaperNavigationBar } from './components/ui/PaperNavigationBar.tsx';
import { OperationBanner } from './components/ui/OperationBanner.tsx';
import { TabButton } from './components/ui/TabButton.tsx';
import { EmptyState } from './components/ui/EmptyState.tsx';
import { LoadingButton } from './components/ui/LoadingButton.tsx';
import { DebugPanel } from './components/DebugPanel.tsx';
import { PaperInfoCard } from './components/PaperInfoCard.tsx';
import { AvailableFeaturesCard } from './components/AvailableFeaturesCard.tsx';
import { SummaryTab } from './components/tabs/SummaryTab.tsx';
import { ExplanationTab } from './components/tabs/ExplanationTab.tsx';
import * as ChromeService from '../services/ChromeService.ts';
import * as StorageService from '../services/StorageService.ts';

type ViewState = 'loading' | 'empty' | 'content' | 'stored-only';
type TabType = 'summary' | 'explanation' | 'qa' | 'analysis' | 'glossary' | 'original';

interface ExplanationData {
  paper: ResearchPaper;
  explanation: ExplanationResult;
  summary: SummaryResult;
}

export function Sidepanel() {
  // State - define first so hooks can reference them
  const [viewState, setViewState] = useState<ViewState>('loading');
  const [activeTab, setActiveTab] = useState<TabType>('summary');
  const [data, setData] = useState<ExplanationData | null>(null);
  const [copied, setCopied] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [analysis, setAnalysis] = useState<PaperAnalysisResult | null>(null);
  const [glossary, setGlossary] = useState<GlossaryResult | null>(null);
  const [isCheckingStorage, setIsCheckingStorage] = useState(false);
  const [isExplainingInBackground, setIsExplainingInBackground] = useState(false);
  const [storedPaper, setStoredPaper] = useState<StoredPaper | null>(null);

  // Q&A state
  const [question, setQuestion] = useState('');
  const [isAsking, setIsAsking] = useState(false);
  const [qaHistory, setQaHistory] = useState<QuestionAnswer[]>([]);

  // Delete all state
  const [isDeletingAll, setIsDeletingAll] = useState(false);
  const [showDeleteAllConfirm, setShowDeleteAllConfirm] = useState(false);
  const [showManageSection, setShowManageSection] = useState(false);

  // Debug state
  const [showDebug, setShowDebug] = useState(false);
  const [debugInfo, setDebugInfo] = useState<any>(null);

  // Track if operations are queued
  const [hasQueuedOperations, setHasQueuedOperations] = useState(false);
  const [operationQueueMessage, setOperationQueueMessage] = useState('');

  // Custom hooks
  const operationState = useOperationState();
  const paperData = usePaperData();
  const paperNavigation = usePaperNavigation({
    onPaperSwitch: async (paper) => {
      // Update stored paper and load data
      setStoredPaper(paper);
      // Load Q&A history
      setQaHistory(paper.qaHistory || []);
    },
    onPaperDelete: () => {
      // Clean up generation state for deleted paper
      const deletedPaperUrl = storedPaper?.url;
      if (deletedPaperUrl) {
        operationState.clearAnalyzingPaper(deletedPaperUrl);
        operationState.clearGlossaryGeneratingPaper(deletedPaperUrl);
      }
    },
    onAllPapersDeleted: () => {
      // No papers left
      setStoredPaper(null);
      setViewState('empty');
      setQaHistory([]);
    },
  });

  // Create debounced version of loadExplanation to prevent rapid re-triggers
  const debouncedLoadExplanation = useDebounce(() => {
    loadExplanation();
  }, 300); // 300ms debounce delay

  useEffect(() => {
    loadExplanation();

    // Create storage listener using StorageService
    const storageListener = StorageService.createStorageListener(
      (isExplaining) => setIsExplainingInBackground(isExplaining),
      () => debouncedLoadExplanation()
    );

    // Create operation state listener using StorageService
    const messageListener = StorageService.createOperationStateListener((state) => {
      // Update banner states
      setIsExplainingInBackground(state.isExplaining);

      // Update paper-specific generation states
      const paperUrl = state.currentPaper?.url;
      if (paperUrl) {
        // Update analyzing papers Set
        if (state.isAnalyzing) {
          operationState.addAnalyzingPaper(paperUrl);
        } else {
          operationState.removeAnalyzingPaper(paperUrl);
        }

        // Update glossary generating papers Set
        if (state.isGeneratingGlossary) {
          operationState.addGlossaryGeneratingPaper(paperUrl);
        } else {
          operationState.removeGlossaryGeneratingPaper(paperUrl);
        }
      }
    });

    // Register listeners and get cleanup function
    const cleanup = StorageService.registerListeners(storageListener, messageListener);

    return cleanup;
  }, []);

  // Use checkForStoredPaper from hook
  const { checkForStoredPaper } = paperData;

  async function collectDebugInfo() {
    const result = await chrome.storage.local.get(['lastExplanation', 'lastAnalysis', 'currentPaper']);
    const debugData: any = {
      timestamp: new Date().toLocaleString(),
      chromeStorage: {
        hasCurrentPaper: !!result.currentPaper,
        currentPaperUrl: result.currentPaper?.url || 'N/A',
        currentPaperTitle: result.currentPaper?.title || 'N/A',
        hasLastExplanation: !!result.lastExplanation,
        lastExplanationUrl: result.lastExplanation?.paper?.url || 'N/A',
        hasLastAnalysis: !!result.lastAnalysis,
      },
      sidepanelState: {
        viewState,
        hasData: !!data,
        dataUrl: data?.paper?.url || 'N/A',
        hasStoredPaper: !!storedPaper,
        storedPaperId: storedPaper?.id || 'N/A',
        storedPaperChunkCount: storedPaper?.chunkCount || 0,
        hasAnalysis: !!analysis,
        isAnalyzingCurrentPaper: storedPaper?.url ? operationState.isAnalyzing(storedPaper.url) : false,
        isCheckingStorage,
      },
    };

    // Try to get paper from IndexedDB
    if (result.currentPaper?.url) {
      try {
        const stored = await ChromeService.getPaperByUrl(result.currentPaper.url);
        debugData.indexedDB = {
          queryUrl: result.currentPaper.url,
          found: !!stored,
          storedPaperId: stored?.id || 'N/A',
          storedPaperTitle: stored?.title || 'N/A',
          chunkCount: stored?.chunkCount || 0,
        };
      } catch (error) {
        debugData.indexedDB = {
          error: String(error),
        };
      }
    }

    setDebugInfo(debugData);
    return debugData;
  }

  async function loadExplanation() {
    try {
      // Load all papers from IndexedDB
      const papers = await ChromeService.getAllPapers();
      paperNavigation.setAllPapers(papers);
      console.log('[Sidepanel] Loaded', papers.length, 'papers from IndexedDB');

      // Query current operation state from background
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab?.id) {
          const stateResponse = await ChromeService.getOperationState(tab.id);

          if (stateResponse.success && stateResponse.state) {
            const state = stateResponse.state;
            console.log('[Sidepanel] Loaded operation state:', state);

            // Update banner states based on current operation
            setIsExplainingInBackground(state.isExplaining);

            // Update paper-specific generation states
            const paperUrl = state.currentPaper?.url;
            if (paperUrl) {
              if (state.isAnalyzing) {
                operationState.addAnalyzingPaper(paperUrl);
              }
              if (state.isGeneratingGlossary) {
                operationState.addGlossaryGeneratingPaper(paperUrl);
              }
            }
          }
        }
      } catch (stateError) {
        console.warn('[Sidepanel] Could not load operation state:', stateError);
      }

      const result = await chrome.storage.local.get(['lastExplanation', 'lastAnalysis', 'currentPaper', 'isExplaining']);

      // Also check old isExplaining flag for backwards compatibility
      if (result.isExplaining) {
        console.log('[Sidepanel] Explanation in progress (legacy flag)');
        setIsExplainingInBackground(true);
      }

      // Collect debug info
      await collectDebugInfo();

      // NEW: If no explanation but paper was detected, check if it's stored
      if (!result.lastExplanation && result.currentPaper) {
        console.log('[Sidepanel] No explanation yet, checking if paper is stored...');
        setIsCheckingStorage(true);

        try {
          const stored = await checkForStoredPaper(result.currentPaper.url);

          if (stored) {
            console.log('[Sidepanel] Paper is stored! Enabling Analysis and Q&A tabs.');
            setStoredPaper(stored);
            setData({
              paper: result.currentPaper,
              explanation: { originalText: '', explanation: '', timestamp: 0 },
              summary: { summary: '', keyPoints: [], timestamp: 0 }
            });
            setViewState('stored-only');

            // Auto-trigger analysis for stored paper (only if not already analyzing this paper)
            if (!operationState.isAnalyzing(result.currentPaper.url) && (!result.lastAnalysis || result.lastAnalysis.paper?.url !== result.currentPaper.url)) {
              console.log('[Sidepanel] Auto-triggering analysis for stored paper...');
              debouncedTriggerAnalysis(result.currentPaper.url);
            }
          } else {
            console.log('[Sidepanel] Paper not stored yet after retries.');
            setViewState('empty');
          }
        } catch (dbError) {
          console.error('[Sidepanel] Could not check paper storage status:', dbError);
          setViewState('empty');
        } finally {
          setIsCheckingStorage(false);
        }
        return;
      }

      if (!result.lastExplanation) {
        setViewState('empty');
        return;
      }

      // Check if paper is stored in IndexedDB with retry logic
      console.log('[Sidepanel] Checking storage for explained paper...');
      setIsCheckingStorage(true);

      try {
        const stored = await checkForStoredPaper(result.lastExplanation.paper.url);
        setStoredPaper(stored);

        if (stored) {
          console.log('[Sidepanel] ✓ Paper is stored, Q&A enabled');

          // Prioritize loading from StoredPaper fields, fall back to chrome.storage
          const explanationData: ExplanationData = {
            paper: result.lastExplanation.paper,
            explanation: stored.explanation || result.lastExplanation.explanation,
            summary: stored.summary || result.lastExplanation.summary,
          };
          setData(explanationData);

          // Load analysis from StoredPaper or chrome.storage
          if (stored.analysis) {
            console.log('[Sidepanel] Loading analysis from StoredPaper');
            setAnalysis(stored.analysis);
          } else if (result.lastAnalysis) {
            console.log('[Sidepanel] Loading analysis from chrome.storage');
            setAnalysis(result.lastAnalysis.analysis);
          }

          // Load glossary from StoredPaper
          if (stored.glossary) {
            console.log('[Sidepanel] Loading glossary from StoredPaper');
            setGlossary(stored.glossary);
          }

          // Auto-trigger analysis if paper is stored and no analysis exists yet (only if not already analyzing this paper)
          if (!stored.analysis && !operationState.isAnalyzing(result.lastExplanation.paper.url) && (!result.lastAnalysis || result.lastAnalysis.paper?.url !== result.lastExplanation.paper.url)) {
            console.log('[Sidepanel] Paper is stored, triggering automatic analysis...');
            triggerAnalysis(result.lastExplanation.paper.url);
          }

          // Auto-trigger glossary generation if paper is stored and no glossary exists yet (only if not already generating for this paper)
          if (!stored.glossary && !operationState.isGeneratingGlossary(result.lastExplanation.paper.url)) {
            console.log('[Sidepanel] Paper is stored, triggering automatic glossary generation...');
            triggerGlossaryGeneration(result.lastExplanation.paper.url);
          }
        } else {
          console.log('[Sidepanel] Paper not stored, Q&A disabled');

          // Paper not stored, use chrome.storage data
          setData(result.lastExplanation);

          // Load analysis if available
          if (result.lastAnalysis) {
            setAnalysis(result.lastAnalysis.analysis);
          }
        }
      } catch (dbError) {
        console.error('[Sidepanel] Could not check paper storage status:', dbError);
        // Fallback to chrome.storage if IndexedDB check fails
        setData(result.lastExplanation);
        if (result.lastAnalysis) {
          setAnalysis(result.lastAnalysis.analysis);
        }
      } finally {
        setIsCheckingStorage(false);
      }

      setViewState('content');
    } catch (error) {
      console.error('Error loading explanation:', error);
      setViewState('empty');
    }
  }

  async function triggerAnalysis(paperUrl: string) {
    // Guard: Don't retrigger if already analyzing THIS paper
    if (operationState.isAnalyzing(paperUrl)) {
      console.log('[Sidepanel] Analysis already in progress for this paper, skipping');
      setOperationQueueMessage('Analysis already in progress for this paper');
      setHasQueuedOperations(true);
      setTimeout(() => {
        setHasQueuedOperations(false);
        setOperationQueueMessage('');
      }, 3000);
      return;
    }

    try {
      // Add to analyzing papers Set
      operationState.addAnalyzingPaper(paperUrl);
      console.log('Starting paper analysis for:', paperUrl);

      const response = await ChromeService.analyzePaper(paperUrl);

      if (response.success) {
        console.log('✓ Paper analysis completed successfully');
        // Analysis will be loaded automatically via storage change listener
      } else {
        console.error('Analysis failed:', response.error);
        // Show error to user
        setOperationQueueMessage(`Analysis failed: ${response.error}`);
        setHasQueuedOperations(true);
        setTimeout(() => {
          setHasQueuedOperations(false);
          setOperationQueueMessage('');
        }, 5000);
      }
    } catch (error) {
      console.error('Error triggering analysis:', error);
      setOperationQueueMessage('Failed to start analysis');
      setHasQueuedOperations(true);
      setTimeout(() => {
        setHasQueuedOperations(false);
        setOperationQueueMessage('');
      }, 3000);
    } finally {
      // Remove from analyzing papers Set
      operationState.removeAnalyzingPaper(paperUrl);
    }
  }

  async function triggerGlossaryGeneration(paperUrl: string) {
    // Guard: Don't retrigger if already generating for THIS paper
    if (operationState.isGeneratingGlossary(paperUrl)) {
      console.log('[Sidepanel] Glossary generation already in progress for this paper, skipping');
      setOperationQueueMessage('Glossary generation already in progress for this paper');
      setHasQueuedOperations(true);
      setTimeout(() => {
        setHasQueuedOperations(false);
        setOperationQueueMessage('');
      }, 3000);
      return;
    }

    try {
      // Add to glossary generating papers Set
      operationState.addGlossaryGeneratingPaper(paperUrl);
      console.log('Starting glossary generation for:', paperUrl);

      const response = await ChromeService.generateGlossary(paperUrl);

      if (response.success && response.glossary) {
        console.log('✓ Glossary generated successfully');
        setGlossary(response.glossary);

        // Update storedPaper and allPapers to reflect the new glossary
        // This prevents the glossary from being cleared when switchToPaper is called
        if (storedPaper) {
          const updatedPaper = { ...storedPaper, glossary: response.glossary };
          setStoredPaper(updatedPaper);

          // Update the paper in allPapers array
          const updatedAllPapers = [...paperNavigation.allPapers];
          updatedAllPapers[paperNavigation.currentPaperIndex] = updatedPaper;
          paperNavigation.setAllPapers(updatedAllPapers);

          console.log('[Sidepanel] Updated storedPaper and allPapers with new glossary');
        }
      } else {
        console.error('Glossary generation failed:', response.error);
        // Show error to user
        setOperationQueueMessage(`Glossary generation failed: ${response.error}`);
        setHasQueuedOperations(true);
        setTimeout(() => {
          setHasQueuedOperations(false);
          setOperationQueueMessage('');
        }, 5000);
      }
    } catch (error) {
      console.error('Error triggering glossary generation:', error);
      setOperationQueueMessage('Failed to generate glossary');
      setHasQueuedOperations(true);
      setTimeout(() => {
        setHasQueuedOperations(false);
        setOperationQueueMessage('');
      }, 3000);
    } finally {
      // Remove from glossary generating papers Set
      operationState.removeGlossaryGeneratingPaper(paperUrl);
    }
  }

  // Create debounced version of triggerAnalysis
  const debouncedTriggerAnalysis = useDebounce((paperUrl: string) => {
    triggerAnalysis(paperUrl);
  }, 500); // 500ms debounce for analysis

  async function handleAskQuestion() {
    if (!question.trim() || !data?.paper.url) {
      return;
    }

    if (!storedPaper) {
      alert('Paper must be stored before asking questions. Please wait for paper to be stored.');
      return;
    }

    try {
      setIsAsking(true);
      console.log('Asking question:', question);

      const response = await ChromeService.askQuestion(data.paper.url, question.trim());

      if (response.success && response.answer) {
        console.log('✓ Question answered successfully');
        // Add to history
        const newHistory = [response.answer, ...qaHistory];
        setQaHistory(newHistory);
        setQuestion(''); // Clear input

        // Save Q&A history to database
        if (storedPaper) {
          await ChromeService.updatePaperQAHistory(storedPaper.id, newHistory);
        }
      } else {
        console.error('Question answering failed:', response.error);
        alert(`Failed to answer question: ${response.error}`);
      }
    } catch (error) {
      console.error('Error asking question:', error);
      alert('Failed to ask question. Please try again.');
    } finally {
      setIsAsking(false);
    }
  }

  async function handleCopy() {
    if (!data) {
      alert('No explanation to copy');
      return;
    }

    try {
      const { paper, explanation, summary } = data;

      const text = `
${paper.title}
${paper.authors.join(', ')}

SUMMARY:
${summary.summary}

KEY POINTS:
${summary.keyPoints.map(p => `- ${p}`).join('\n')}

EXPLANATION:
${explanation.explanation}

Source: ${paper.url}
      `.trim();

      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Error copying:', error);
      alert('Failed to copy explanation');
    }
  }

  async function handleRegenerate() {
    try {
      const result = await chrome.storage.local.get(['currentPaper']);

      if (!result.currentPaper) {
        alert('No paper found. Please detect a paper first.');
        return;
      }

      setIsRegenerating(true);
      setViewState('loading');

      const response = await ChromeService.explainPaper(result.currentPaper);

      if (response.success) {
        await loadExplanation();
      } else {
        alert('Failed to regenerate explanation');
        setViewState('empty');
      }
    } catch (error) {
      console.error('Error regenerating:', error);
      alert('Failed to regenerate explanation');
      setViewState('empty');
    } finally {
      setIsRegenerating(false);
    }
  }

  async function handleManualRefresh() {
    console.log('[Sidepanel] Manual refresh requested');
    setIsCheckingStorage(true);
    await loadExplanation();
  }

  // Paper navigation and management functions
  async function switchToPaper(index: number, papersArray?: StoredPaper[]) {
    // Use provided array or fall back to hook state
    const papers = papersArray || paperNavigation.allPapers;

    if (index < 0 || index >= papers.length) return;

    console.log(`[Sidepanel] Switching to paper at index ${index}`);

    // Save current paper's Q&A history before switching
    if (storedPaper && qaHistory.length > 0) {
      await ChromeService.updatePaperQAHistory(storedPaper.id, qaHistory);
    }

    // Switch to new paper
    paperNavigation.setCurrentPaperIndex(index);
    const newPaper = papers[index];

    // Fetch fresh paper data from IndexedDB to avoid stale state issues
    const freshPaper = await ChromeService.getPaperByUrl(newPaper.url);
    if (freshPaper) {
      // Update the allPapers array with fresh data to prevent future staleness
      const updatedPapers = [...papers];
      updatedPapers[index] = freshPaper;
      if (!papersArray) {
        // Only update state if using state array (not passed-in array)
        paperNavigation.setAllPapers(updatedPapers);
      }
      setStoredPaper(freshPaper);
    } else {
      setStoredPaper(newPaper);
    }

    // Use fresh paper data if available, otherwise fall back to array data
    const paperToUse = freshPaper || newPaper;

    // Load Q&A history for new paper
    setQaHistory(paperToUse.qaHistory || []);

    // Try to load explanation and analysis for this paper
    const result = await chrome.storage.local.get(['lastExplanation', 'lastAnalysis']);

    // Prioritize loading from StoredPaper fields, fall back to chrome.storage
    if (paperToUse.explanation && paperToUse.summary) {
      console.log('[Sidepanel] Loading explanation from StoredPaper');
      setData({
        paper: paperToUse,
        explanation: paperToUse.explanation,
        summary: paperToUse.summary,
      });
      setActiveTab('summary');
      setViewState('content');
    } else if (result.lastExplanation?.paper?.url === paperToUse.url) {
      console.log('[Sidepanel] Loading explanation from chrome.storage');
      setData(result.lastExplanation);
      setActiveTab('summary');
      setViewState('content');
    } else {
      // No explanation for this paper, show stored-only view
      console.log('[Sidepanel] No explanation found for this paper');
      setData({
        paper: paperToUse,
        explanation: { originalText: '', explanation: '', timestamp: 0 },
        summary: { summary: '', keyPoints: [], timestamp: 0 }
      });
      setActiveTab('analysis');
      setViewState('stored-only');
    }

    // Load analysis from fresh StoredPaper data or chrome.storage
    if (paperToUse.analysis) {
      console.log('[Sidepanel] Loading analysis from StoredPaper (fresh data)');
      setAnalysis(paperToUse.analysis);
    } else if (result.lastAnalysis?.paper?.url === paperToUse.url) {
      console.log('[Sidepanel] Loading analysis from chrome.storage');
      setAnalysis(result.lastAnalysis.analysis);
    } else {
      // Only trigger if not already analyzing this paper
      if (!operationState.isAnalyzing(paperToUse.url)) {
        console.log('[Sidepanel] No analysis found in database, triggering new analysis');
        setAnalysis(null);
        triggerAnalysis(paperToUse.url);
      } else {
        console.log('[Sidepanel] Analysis already in progress for this paper');
        setAnalysis(null);
      }
    }

    // Load glossary from fresh StoredPaper data
    if (paperToUse.glossary) {
      console.log('[Sidepanel] Loading glossary for paper:', paperToUse.title);
      setGlossary(paperToUse.glossary);
    } else {
      // Only trigger if not already generating for this paper
      if (!operationState.isGeneratingGlossary(paperToUse.url)) {
        console.log('[Sidepanel] No glossary found, triggering generation');
        setGlossary(null);
        triggerGlossaryGeneration(paperToUse.url);
      } else {
        console.log('[Sidepanel] Glossary generation already in progress for this paper');
        setGlossary(null);
      }
    }
  }

  async function handleDeletePaper() {
    // Use hook's delete function with current paper and QA history
    await paperNavigation.handleDeletePaper(storedPaper, qaHistory);

    // If papers remain, load the new current paper's data
    if (paperNavigation.allPapers.length > 0) {
      await switchToPaper(paperNavigation.currentPaperIndex, paperNavigation.allPapers);
    }
  }

  function handlePrevPaper() {
    if (paperNavigation.currentPaperIndex > 0) {
      switchToPaper(paperNavigation.currentPaperIndex - 1);
    }
  }

  function handleNextPaper() {
    if (paperNavigation.currentPaperIndex < paperNavigation.allPapers.length - 1) {
      switchToPaper(paperNavigation.currentPaperIndex + 1);
    }
  }

  async function handleDeleteAllPapers() {
    if (!showDeleteAllConfirm) {
      setShowDeleteAllConfirm(true);
      return;
    }

    try {
      setIsDeletingAll(true);
      console.log('[Sidepanel] Deleting all papers:', paperNavigation.allPapers.length);

      // Delete all papers one by one
      let successCount = 0;
      for (const paper of paperNavigation.allPapers) {
        const success = await ChromeService.deletePaper(paper.id);
        if (success) {
          successCount++;
        }
      }

      console.log(`[Sidepanel] Deleted ${successCount}/${paperNavigation.allPapers.length} papers`);

      // Clear all state
      paperNavigation.setAllPapers([]);
      paperNavigation.setCurrentPaperIndex(0);
      setStoredPaper(null);
      setData(null);
      setAnalysis(null);
      setQaHistory([]);
      setViewState('empty');

      // Clear Chrome storage
      await chrome.storage.local.remove(['lastExplanation', 'lastAnalysis', 'currentPaper']);
      console.log('[Sidepanel] Cleared Chrome storage');

      if (successCount < paperNavigation.allPapers.length) {
        alert(`Deleted ${successCount} out of ${paperNavigation.allPapers.length} papers. Some papers could not be deleted.`);
      }
    } catch (error) {
      console.error('[Sidepanel] Error deleting all papers:', error);
      alert('Failed to delete all papers. Please try again.');
    } finally {
      setIsDeletingAll(false);
      setShowDeleteAllConfirm(false);
      setShowManageSection(false);
    }
  }

  async function handleClearAllStorage() {
    if (!confirm('Clear all Chrome storage? This will remove any ghost papers and reset the sidepanel to a clean state.')) {
      return;
    }

    try {
      console.log('[Sidepanel] Clearing all Chrome storage...');

      // Clear Chrome storage
      await chrome.storage.local.remove(['lastExplanation', 'lastAnalysis', 'currentPaper']);
      console.log('[Sidepanel] ✓ Chrome storage cleared');

      // Reset all component state
      setData(null);
      setAnalysis(null);
      setQaHistory([]);
      setStoredPaper(null);
      setViewState('empty');

      // Reload to verify everything is cleared
      await loadExplanation();

      alert('Chrome storage cleared successfully. If you still see ghost papers, try reloading the extension.');
    } catch (error) {
      console.error('[Sidepanel] Error clearing storage:', error);
      alert('Failed to clear storage. Please try again.');
    }
  }

  if (viewState === 'loading') {
    return (
      <div class="h-screen flex items-center justify-center bg-gray-50">
        <div class="text-center">
          <div class="inline-block animate-spin rounded-full h-12 w-12 border-4 border-gray-200 border-t-blue-600 mb-4" />
          {isCheckingStorage ? (
            <div>
              <p class="text-gray-600 font-medium">Kuma is retrieving papers from storage...</p>
              <p class="text-xs text-gray-500 mt-2">Retrying with exponential backoff</p>
            </div>
          ) : (
            <p class="text-gray-600">Loading explanation...</p>
          )}
        </div>
      </div>
    );
  }

  if (viewState === 'empty') {
    return (
      <div class="h-screen flex items-center justify-center bg-gray-50 p-8">
        <EmptyState
          icon={FileText}
          title="No Explanation Yet"
          subtitle='Click "Explain Paper" in the popup to generate an explanation'
        />
      </div>
    );
  }

  if (viewState === 'stored-only') {
    return (
      <div class="h-screen flex flex-col bg-gray-50">
        {/* Header */}
        <header class="bg-white border-b border-gray-200 px-6 py-4">
          <div class="flex items-center justify-between">
            <div>
              <h1 class="text-xl font-bold text-gray-800 flex items-center gap-2"><PawPrint size={20} class="text-gray-400" /> Kuma</h1>
              <p class="text-sm text-gray-600">
                {isCheckingStorage ? '🐻 Kuma is checking paper storage...' : '🐻 Kuma found the paper stored and is ready for analysis'}
              </p>
            </div>
            <button
              onClick={handleManualRefresh}
              disabled={isCheckingStorage}
              class="btn btn-secondary px-3 py-2 text-sm hover:cursor-pointer"
              title="Refresh storage status"
            >
              <RefreshCw size={16} class={isCheckingStorage ? 'animate-spin' : ''} />
            </button>
          </div>
        </header>

        {/* Content */}
        <div class="flex-1 overflow-auto">
          <div class="max-w-4xl mx-auto p-6">
              {/* Paper Navigation Bar */}
              <PaperNavigationBar
                papers={paperNavigation.allPapers}
                currentIndex={paperNavigation.currentPaperIndex}
                currentPaperTitle={storedPaper?.title}
                onPrevious={handlePrevPaper}
                onNext={handleNextPaper}
                onSelect={(index) => switchToPaper(index)}
                onDelete={handleDeletePaper}
                isDeleting={paperNavigation.isDeleting}
                showDeleteConfirm={paperNavigation.showDeleteConfirm}
                onCancelDelete={() => paperNavigation.setShowDeleteConfirm(false)}
              />

            {/* Storage Checking Banner */}
            {isCheckingStorage && (
              <OperationBanner
                status="loading"
                title="🐻 Kuma is checking paper storage..."
                subtitle="Retrying with exponential backoff (up to 5 attempts)"
              />
            )}

            {/* Explanation In Progress Banner */}
            {isExplainingInBackground && (
              <OperationBanner
                status="loading"
                title="🐻 Kuma is thinking of ways to explain the research paper... (Generating explanation)"
                subtitle="Generating summary and simplified explanation. This usually takes 10-20 seconds"
                gradient={true}
              />
            )}

            {/* Paper Info Card */}
            <PaperInfoCard paper={data?.paper || null} storedPaper={storedPaper} />


            {/* Available Features */}
            <AvailableFeaturesCard
              storedPaper={storedPaper}
              isAnalyzing={storedPaper?.url ? operationState.isAnalyzing(storedPaper.url) : false}
            />

            {/* Tabs */}
            <div class="flex gap-2 mb-4 border-b border-gray-200">
              <TabButton
                active={activeTab === 'analysis'}
                onClick={() => setActiveTab('analysis')}
                loading={storedPaper?.url ? operationState.isAnalyzing(storedPaper.url) : false}
              >
                Analysis
              </TabButton>
              <TabButton
                active={activeTab === 'qa'}
                onClick={() => setActiveTab('qa')}
              >
                Q&A
              </TabButton>
              <TabButton
                active={activeTab === 'glossary'}
                onClick={() => setActiveTab('glossary')}
                loading={storedPaper?.url ? operationState.isGeneratingGlossary(storedPaper.url) : false}
              >
                Glossary
              </TabButton>
              <TabButton
                active={activeTab === 'original'}
                onClick={() => setActiveTab('original')}
              >
                Abstract
              </TabButton>
            </div>

            {/* Tab Content */}
            <div class="space-y-4">
              {/* Analysis Tab Content */}
              {activeTab === 'analysis' && (
                <AnalysisSection
                  analysis={analysis}
                  isAnalyzing={storedPaper?.url ? operationState.isAnalyzing(storedPaper.url) : false}
                />
              )}

              {/* Q&A Tab Content */}
              {activeTab === 'qa' && (
                <QASection
                  question={question}
                  setQuestion={setQuestion}
                  isAsking={isAsking}
                  qaHistory={qaHistory}
                  storedPaper={storedPaper}
                  onAskQuestion={handleAskQuestion}
                />
              )}

              {/* Glossary Tab */}
              {activeTab === 'glossary' && (
                <GlossarySection
                  glossary={glossary}
                  isGenerating={storedPaper?.url ? operationState.isGeneratingGlossary(storedPaper.url) : false}
                />
              )}

              {/* Original Tab */}
              {activeTab === 'original' && (
                <OriginalPaperTab paper={data?.paper || null} />
              )}
            </div>

            {/* Manage Papers Section */}
            <PaperManagement
              papers={paperNavigation.allPapers}
              showManageSection={showManageSection}
              onToggleManageSection={() => setShowManageSection(!showManageSection)}
              onDeleteAll={handleDeleteAllPapers}
              isDeletingAll={isDeletingAll}
              showDeleteAllConfirm={showDeleteAllConfirm}
              onCancelDeleteAll={() => setShowDeleteAllConfirm(false)}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div class="h-screen flex flex-col bg-gray-50">
      {/* Header */}
      <header class="bg-white border-b border-gray-200 px-6 py-4">
        <div class="flex items-center justify-between">
          <div>
            <h1 class="text-xl font-bold text-gray-800 flex items-center gap-2"><PawPrint size={20} class="text-gray-400" /> Kuma</h1>
            <p class="text-sm text-gray-600">A bear that helps you understand research papers </p>
          </div>
          <button
            onClick={() => setShowDebug(!showDebug)}
            class="text-xs px-3 py-1 bg-gray-200 hover:bg-gray-300 rounded"
          >
            {showDebug ? 'Hide' : 'Show'} Debug
          </button>
        </div>
      </header>

      {/* Content */}
      <div class="flex-1 overflow-auto">
        <div class="max-w-4xl mx-auto p-6 pt-2">
          {/* Debug Panel */}
          <DebugPanel
            show={showDebug}
            debugInfo={debugInfo}
            onRefresh={collectDebugInfo}
            onClearStorage={handleClearAllStorage}
          />

          {/* Paper Navigation Bar */}
          <PaperNavigationBar
            papers={paperNavigation.allPapers}
            currentIndex={paperNavigation.currentPaperIndex}
            currentPaperTitle={storedPaper?.title}
            onPrevious={handlePrevPaper}
            onNext={handleNextPaper}
            onSelect={(index) => switchToPaper(index)}
            onDelete={handleDeletePaper}
            isDeleting={paperNavigation.isDeleting}
            showDeleteConfirm={paperNavigation.showDeleteConfirm}
            onCancelDelete={() => paperNavigation.setShowDeleteConfirm(false)}
          />

          {/* Manage Papers Section */}
          <PaperManagement
            papers={paperNavigation.allPapers}
            showManageSection={showManageSection}
            onToggleManageSection={() => setShowManageSection(!showManageSection)}
            onDeleteAll={handleDeleteAllPapers}
            isDeletingAll={isDeletingAll}
            showDeleteAllConfirm={showDeleteAllConfirm}
            onCancelDeleteAll={() => setShowDeleteAllConfirm(false)}
          />

          {/* Operation Queue Banner */}
          {hasQueuedOperations && operationQueueMessage && (
            <OperationBanner
              status="warning"
              title={operationQueueMessage}
            />
          )}

          {/* Explanation In Progress Banner */}
          {isExplainingInBackground && (
            <OperationBanner
              status="loading"
              title="🐻 Kuma is explaining the paper..."
              subtitle="Generating summary and simplified explanation. This usually takes 10-20 seconds"
              gradient={true}
            />
          )}

          {/* Paper Info Card */}
          <PaperInfoCard paper={data?.paper || null} storedPaper={storedPaper} />

          {/* Tabs */}
          <div class="flex gap-2 mb-4 border-b border-gray-200">
            <TabButton
              active={activeTab === 'summary'}
              onClick={() => setActiveTab('summary')}
            >
              Summary
            </TabButton>
            <TabButton
              active={activeTab === 'explanation'}
              onClick={() => setActiveTab('explanation')}
            >
              Explanation
            </TabButton>
            <TabButton
              active={activeTab === 'analysis'}
              onClick={() => setActiveTab('analysis')}
              loading={storedPaper?.url ? operationState.isAnalyzing(storedPaper.url) : false}
              disabled={!analysis && !(storedPaper?.url && operationState.isAnalyzing(storedPaper.url))}
              title={(storedPaper?.url && operationState.isAnalyzing(storedPaper.url)) ? 'Analysis in progress...' : !analysis ? 'Analysis will start automatically when paper is stored' : ''}
            >
              Analysis
            </TabButton>
            <TabButton
              active={activeTab === 'qa'}
              onClick={() => setActiveTab('qa')}
              disabled={!storedPaper}
              title={!storedPaper ? 'Paper must be stored to ask questions' : 'Ask questions about this paper'}
            >
              Q&A
            </TabButton>
            <TabButton
              active={activeTab === 'glossary'}
              onClick={() => setActiveTab('glossary')}
              loading={storedPaper?.url ? operationState.isGeneratingGlossary(storedPaper.url) : false}
              disabled={!glossary && !(storedPaper?.url && operationState.isGeneratingGlossary(storedPaper.url))}
              title={(storedPaper?.url && operationState.isGeneratingGlossary(storedPaper.url)) ? 'Glossary being generated...' : !glossary ? 'Glossary will be generated when paper is stored' : ''}
            >
              Glossary
            </TabButton>
            <TabButton
              active={activeTab === 'original'}
              onClick={() => setActiveTab('original')}
            >
              Original
            </TabButton>
          </div>

          {/* Tab Content */}
          <div class="space-y-4">
            {activeTab === 'summary' && <SummaryTab summary={data?.summary || null} />}

            {activeTab === 'explanation' && <ExplanationTab explanation={data?.explanation || null} />}

            {activeTab === 'analysis' && (
              <AnalysisSection
                analysis={analysis}
                isAnalyzing={storedPaper?.url ? operationState.isAnalyzing(storedPaper.url) : false}
              />
            )}

            {activeTab === 'qa' && (
              <QASection
                question={question}
                setQuestion={setQuestion}
                isAsking={isAsking}
                qaHistory={qaHistory}
                storedPaper={storedPaper}
                onAskQuestion={handleAskQuestion}
              />
            )}

            {activeTab === 'glossary' && (
              <GlossarySection
                glossary={glossary}
                isGenerating={storedPaper?.url ? operationState.isGeneratingGlossary(storedPaper.url) : false}
              />
            )}

            {activeTab === 'original' && (
              <OriginalPaperTab paper={data?.paper || null} />
            )}
          </div>

          {/* Actions */}
          <div class="flex gap-3 mt-6">
            <LoadingButton
              onClick={handleCopy}
              loading={false}
              variant="secondary"
              className="flex-1"
            >
              <Copy size={16} />
              {copied ? 'Copied!' : 'Copy Explanation'}
            </LoadingButton>

            <LoadingButton
              onClick={handleRegenerate}
              loading={isRegenerating}
              loadingText="Regenerating..."
              variant="secondary"
              className="flex-1"
            >
              <RefreshCw size={16} />
              Regenerate
            </LoadingButton>
          </div>
        </div>
      </div>
    </div>
  );
}
