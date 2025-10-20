import { useState, useEffect, useRef } from 'preact/hooks';
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

  // Ref to track current paper URL (avoids stale closure in listener)
  const currentPaperUrlRef = useRef<string | null>(null);

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

  // Update ref when storedPaper changes (for listener to use latest value)
  useEffect(() => {
    currentPaperUrlRef.current = storedPaper?.url || null;
  }, [storedPaper]);

  useEffect(() => {
    loadExplanation();

    // Create operation state listener for OPERATION_STATE_CHANGED broadcasts
    const messageListener = StorageService.createOperationStateListener(async (state) => {
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

        // Reload paper from IndexedDB when operations complete
        // This keeps all papers in the sidepanel synchronized
        try {
          const freshPaper = await ChromeService.getPaperByUrl(paperUrl);

          if (freshPaper) {
            // Update in allPapers array
            paperNavigation.setAllPapers(prevPapers =>
              prevPapers.map(p => p.url === paperUrl ? freshPaper : p)
            );

            // If this is the currently viewed paper, update display states
            // Call setState functions sequentially (not nested) to avoid timing issues
            // Use ref to avoid stale closure bug
            const isCurrentPaper = currentPaperUrlRef.current === paperUrl;

            if (isCurrentPaper) {
              // Update stored paper reference
              setStoredPaper(freshPaper);

              // Update data (explanation/summary)
              if (freshPaper.explanation && freshPaper.summary) {
                setData({
                  paper: freshPaper,
                  explanation: freshPaper.explanation,
                  summary: freshPaper.summary,
                });
              }

              // Update analysis
              if (freshPaper.analysis) {
                setAnalysis(freshPaper.analysis);
              }

              // Update glossary
              if (freshPaper.glossary) {
                setGlossary(freshPaper.glossary);
              }
            }
          }
        } catch (error) {
          console.error('[Sidepanel] Error reloading paper on operation update:', error);
        }
      }
    });

    // Register message listener and get cleanup function
    chrome.runtime.onMessage.addListener(messageListener);

    return () => {
      chrome.runtime.onMessage.removeListener(messageListener);
    };
  }, []);

  // Use checkForStoredPaper from hook
  const { checkForStoredPaper } = paperData;

  async function collectDebugInfo() {
    const debugData: any = {
      timestamp: new Date().toLocaleString(),
      sidepanelState: {
        viewState,
        hasData: !!data,
        dataUrl: data?.paper?.url || 'N/A',
        hasStoredPaper: !!storedPaper,
        storedPaperId: storedPaper?.id || 'N/A',
        storedPaperUrl: storedPaper?.url || 'N/A',
        storedPaperTitle: storedPaper?.title || 'N/A',
        storedPaperChunkCount: storedPaper?.chunkCount || 0,
        hasAnalysis: !!analysis,
        hasGlossary: !!glossary,
        isAnalyzingCurrentPaper: storedPaper?.url ? operationState.isAnalyzing(storedPaper.url) : false,
        isCheckingStorage,
      },
    };

    // Try to get paper from IndexedDB
    if (storedPaper?.url) {
      try {
        const stored = await ChromeService.getPaperByUrl(storedPaper.url);
        debugData.indexedDB = {
          queryUrl: storedPaper.url,
          found: !!stored,
          storedPaperId: stored?.id || 'N/A',
          storedPaperTitle: stored?.title || 'N/A',
          chunkCount: stored?.chunkCount || 0,
          hasExplanation: !!stored?.explanation,
          hasSummary: !!stored?.summary,
          hasAnalysis: !!stored?.analysis,
          hasGlossary: !!stored?.glossary,
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

      // Get current tab URL
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const currentUrl = tab?.url;

      // Query current operation state from background
      try {
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

      // Collect debug info
      await collectDebugInfo();

      // Query IndexedDB for paper matching current tab URL (single source of truth)
      if (!currentUrl) {
        console.log('[Sidepanel] No current URL, showing empty state');
        setViewState('empty');
        return;
      }

      console.log('[Sidepanel] Checking IndexedDB for paper at URL:', currentUrl);
      setIsCheckingStorage(true);

      try {
        const stored = await checkForStoredPaper(currentUrl);

        if (stored) {
          setStoredPaper(stored);
          setQaHistory(stored.qaHistory || []);

          // Load all data from stored paper
          if (stored.explanation && stored.summary) {
            setData({
              paper: stored,
              explanation: stored.explanation,
              summary: stored.summary,
            });
            setViewState('content');
          } else {
            setData({
              paper: stored,
              explanation: { originalText: '', explanation: '', timestamp: 0 },
              summary: { summary: '', keyPoints: [], timestamp: 0 }
            });
            setViewState('stored-only');
          }

          // Load analysis from IndexedDB
          if (stored.analysis) {
            console.log('[Sidepanel] Loading analysis from IndexedDB');
            setAnalysis(stored.analysis);
          } else {
            console.log('[Sidepanel] No analysis found for this paper');
            setAnalysis(null);
          }

          // Load glossary from IndexedDB
          if (stored.glossary) {
            console.log('[Sidepanel] Loading glossary from IndexedDB');
            setGlossary(stored.glossary);
          } else {
            console.log('[Sidepanel] No glossary found for this paper');
            setGlossary(null);
          }
        } else {
          console.log('[Sidepanel] No paper found for current URL');
          setViewState('empty');
        }
      } catch (dbError) {
        console.error('[Sidepanel] Error loading from IndexedDB:', dbError);
        setViewState('empty');
      } finally {
        setIsCheckingStorage(false);
      }
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
      if (!storedPaper) {
        alert('No paper found. Please detect a paper first.');
        return;
      }

      setIsRegenerating(true);
      setViewState('loading');

      const response = await ChromeService.explainPaper(storedPaper);

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

    // Load explanation and summary from IndexedDB (single source of truth)
    if (paperToUse.explanation && paperToUse.summary) {
      console.log('[Sidepanel] Loading explanation from IndexedDB');
      setData({
        paper: paperToUse,
        explanation: paperToUse.explanation,
        summary: paperToUse.summary,
      });
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

    // Load analysis from IndexedDB (single source of truth)
    if (paperToUse.analysis) {
      console.log('[Sidepanel] Loading analysis from IndexedDB');
      setAnalysis(paperToUse.analysis);
    } else {
      // Paper switching should NOT auto-trigger analysis (prevents retrigger bug)
      // Analysis is only auto-triggered during initial load in loadExplanation()
      console.log('[Sidepanel] No analysis for this paper');
      setAnalysis(null);
    }

    // Load glossary from IndexedDB (single source of truth)
    if (paperToUse.glossary) {
      console.log('[Sidepanel] Loading glossary from IndexedDB');
      setGlossary(paperToUse.glossary);
    } else {
      // Paper switching should NOT auto-trigger glossary generation (prevents retrigger bug)
      // Glossary is only auto-triggered during initial load in loadExplanation()
      console.log('[Sidepanel] No glossary for this paper');
      setGlossary(null);
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
    if (!confirm('Reset sidepanel state? This will reload all data from IndexedDB.')) {
      return;
    }

    try {
      console.log('[Sidepanel] Resetting sidepanel state...');

      // Reset all component state
      setData(null);
      setAnalysis(null);
      setGlossary(null);
      setQaHistory([]);
      setStoredPaper(null);
      setViewState('empty');

      // Reload from IndexedDB (single source of truth)
      await loadExplanation();

      console.log('[Sidepanel] ✓ Sidepanel state reset and reloaded from IndexedDB');
    } catch (error) {
      console.error('[Sidepanel] Error resetting state:', error);
      alert('Failed to reset state. Please try again.');
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
