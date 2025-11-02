import { useState, useEffect, useRef } from 'preact/hooks';
import {
  Copy,
  RefreshCw,
  FileText,
} from 'lucide-preact';
import { ResearchPaper, ExplanationResult, SummaryResult, StoredPaper, PaperAnalysisResult, QuestionAnswer, GlossaryResult, MessageType } from '../types/index.ts';
import { useDebounce } from './hooks/useDebounce.ts';
import { usePaperNavigation } from './hooks/usePaperNavigation.ts';
import { useOperationState } from './hooks/useOperationState.ts';
import { usePaperData } from './hooks/usePaperData.ts';
import { QASection } from './components/QASection.tsx';
import { AnalysisSection } from './components/AnalysisSection.tsx';
import { GlossarySection } from './components/GlossarySection.tsx';
import { ExplanationSection } from './components/ExplanationSection.tsx';
import { SummarySection } from './components/SummarySection.tsx';
import { OriginalPaperTab } from './components/OriginalPaperTab.tsx';
import { CitationsSection } from './components/CitationsSection.tsx';
import { SettingsTab } from './components/SettingsTab.tsx';
import { OperationBanner } from './components/ui/OperationBanner.tsx';
import { TabButton } from './components/ui/TabButton.tsx';
import { TabDropdown } from './components/ui/TabDropdown.tsx';
import { IntegratedHeader } from './components/ui/IntegratedHeader.tsx';
import { EmptyState } from './components/ui/EmptyState.tsx';
import { LoadingButton } from './components/ui/LoadingButton.tsx';
import { LottiePlayer, LoopPurpose } from '../shared/components/LottiePlayer.tsx';
import { DebugPanel } from './components/DebugPanel.tsx';
import { PaperInfoCard } from './components/PaperInfoCard.tsx';
import { SummaryTab } from './components/tabs/SummaryTab.tsx';
import { normalizeUrl } from '../utils/urlUtils.ts';
import { ExplanationTab } from './components/tabs/ExplanationTab.tsx';
import * as ChromeService from '../services/ChromeService.ts';
import * as StorageService from '../services/StorageService.ts';
import { logger } from '../utils/logger.ts';

type ViewState = 'loading' | 'empty' | 'content' | 'stored-only';
type TabType = 'summary' | 'explanation' | 'qa' | 'analysis' | 'glossary' | 'original';
type TopLevelTab = 'papers' | 'citations' | 'settings';

interface ExplanationData {
  paper: ResearchPaper;
  explanation: ExplanationResult | null;
  summary: SummaryResult | null;
}

export function Sidepanel() {
  // State - define first so hooks can reference them
  const [viewState, setViewState] = useState<ViewState>('loading');
  const [topLevelTab, setTopLevelTab] = useState<TopLevelTab>('papers');
  const [activeTab, setActiveTab] = useState<TabType>('summary');
  const [data, setData] = useState<ExplanationData | null>(null);
  const [copied, setCopied] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [analysis, setAnalysis] = useState<PaperAnalysisResult | null>(null);
  const [glossary, setGlossary] = useState<GlossaryResult | null>(null);
  const [glossaryProgress, setGlossaryProgress] = useState<{
    stage: 'extracting' | 'extracting-terms-from-chunks' | 'filtering-terms' | 'generating-definitions';
    current?: number;
    total?: number;
  } | null>(null);
  const [analysisProgress, setAnalysisProgress] = useState<{
    stage: 'evaluating' | 'analyzing';
    current?: number;
    total?: number;
  } | null>(null);
  const [isCheckingStorage, setIsCheckingStorage] = useState(false);
  const [isExplainingInBackground, setIsExplainingInBackground] = useState(false);
  const [storedPaper, setStoredPaper] = useState<StoredPaper | null>(null);

  // Ref to track current paper URL (avoids stale closure in listener)
  const currentPaperUrlRef = useRef<string | null>(null);

  // Q&A state
  const [question, setQuestion] = useState('');
  const [qaHistory, setQaHistory] = useState<QuestionAnswer[]>([]);
  const [newlyAddedQAIndex, setNewlyAddedQAIndex] = useState<number | null>(null);
  const [draftQuestions, setDraftQuestions] = useState<Map<string, string>>(new Map());

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
      // Load all paper data (synchronized with navigation)
      await loadPaperData(paper);
    },
    onPaperDelete: (deletedPaper) => {
      // Clean up generation state for deleted paper
      const deletedPaperUrl = deletedPaper.url;
      if (deletedPaperUrl) {
        operationState.clearExplainingPaper(deletedPaperUrl);
        operationState.clearSummaryGeneratingPaper(deletedPaperUrl);
        operationState.clearAnalyzingPaper(deletedPaperUrl);
        operationState.clearGlossaryGeneratingPaper(deletedPaperUrl);
        operationState.clearAskingPaper(deletedPaperUrl);
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

  // Reset newly added Q&A index when navigating away from Q&A tab
  useEffect(() => {
    if (activeTab !== 'qa') {
      setNewlyAddedQAIndex(null);
    }
  }, [activeTab]);

  useEffect(() => {
    loadExplanation();

    // Create operation state listener for OPERATION_STATE_CHANGED broadcasts
    const messageListener = StorageService.createOperationStateListener(async (state) => {
      // Update banner states
      setIsExplainingInBackground(state.isExplaining);

      // Update paper-specific generation states
      const paperUrl = state.currentPaper?.url;
      if (paperUrl) {
        // Update explaining papers Set
        if (state.isExplaining) {
          operationState.addExplainingPaper(paperUrl);
        } else {
          operationState.removeExplainingPaper(paperUrl);
        }

        // Update summary generating papers Set
        if (state.isGeneratingSummary) {
          operationState.addSummaryGeneratingPaper(paperUrl);
        } else {
          operationState.removeSummaryGeneratingPaper(paperUrl);
        }

        // Update analyzing papers Set
        if (state.isAnalyzing) {
          operationState.addAnalyzingPaper(paperUrl);

          // Restore analysis progress if available
          // ONLY update if this is the currently viewed paper to prevent contamination
          if (state.analysisProgressStage && currentPaperUrlRef.current === paperUrl) {
            setAnalysisProgress({
              stage: state.analysisProgressStage as 'evaluating' | 'analyzing',
              current: state.currentAnalysisStep,
              total: state.totalAnalysisSteps,
            });
          }
        } else {
          operationState.removeAnalyzingPaper(paperUrl);
          // Clear analysis progress when generation stops
          // ONLY clear if this was the currently viewed paper
          if (currentPaperUrlRef.current === paperUrl) {
            setAnalysisProgress(null);
          }
        }

        // Update glossary generating papers Set
        if (state.isGeneratingGlossary) {
          operationState.addGlossaryGeneratingPaper(paperUrl);

          // Restore glossary progress if available
          // ONLY update if this is the currently viewed paper to prevent contamination
          if (state.glossaryProgressStage && currentPaperUrlRef.current === paperUrl) {
            setGlossaryProgress({
              stage: state.glossaryProgressStage as 'extracting' | 'filtering-terms' | 'generating-definitions',
              current: state.currentGlossaryTerm,
              total: state.totalGlossaryTerms,
            });
          }
        } else {
          operationState.removeGlossaryGeneratingPaper(paperUrl);
          // Clear glossary progress when generation stops
          // ONLY clear if this was the currently viewed paper
          if (currentPaperUrlRef.current === paperUrl) {
            setGlossaryProgress(null);
          }
        }

        // Reload paper from IndexedDB when operations complete
        // This keeps all papers in the sidepanel synchronized
        try {
          const freshPaper = await ChromeService.getPaperByUrl(paperUrl);

          if (freshPaper) {
            // Always fetch fresh papers from IndexedDB (single source of truth)
            // This avoids stale closure issues with paperNavigation.allPapers
            logger.debug('UI', '[Sidepanel] Operation completed, refreshing all papers from IndexedDB');
            const allPapers = await ChromeService.getAllPapers();
            paperNavigation.setAllPapers(allPapers);

            // Re-sync the current paper's index after array update
            // Papers are sorted by storedAt (newest first), so new papers change indices
            // This prevents the navigation from jumping to a different paper
            const currentPaperUrl = currentPaperUrlRef.current;
            if (currentPaperUrl) {
              const newIndex = allPapers.findIndex(p => normalizeUrl(p.url) === normalizeUrl(currentPaperUrl));
              if (newIndex !== -1 && newIndex !== paperNavigation.currentPaperIndex) {
                logger.debug('UI', '[Sidepanel] Re-syncing paper index after array update:', paperNavigation.currentPaperIndex, '→', newIndex);
                paperNavigation.setCurrentPaperIndex(newIndex);
              }
            }

            // Handle transition when no paper is loaded but papers exist in database
            // This ensures the sidepanel auto-loads when going from 0→1 papers
            // Use ref to avoid stale closure bug (same pattern as isCurrentPaper check below)
            if (allPapers.length > 0 && currentPaperUrlRef.current === null) {
              logger.debug('UI', '[Sidepanel] No current paper but papers exist, auto-loading first paper');
              const newPaper = allPapers.find(p => normalizeUrl(p.url) === normalizeUrl(paperUrl));
              if (newPaper) {
                const paperIndex = allPapers.findIndex(p => p.id === newPaper.id);
                if (paperIndex !== -1) {
                  logger.debug('UI', '[Sidepanel] Auto-switching to newly added paper at index:', paperIndex);
                  await paperNavigation.switchToPaper(paperIndex, allPapers);
                }
                // Paper has been loaded via navigation system, no need to check isCurrentPaper below
                return;
              }
            }

            // If this is the currently viewed paper, update display states
            // Call setState functions sequentially (not nested) to avoid timing issues
            // Use ref to avoid stale closure bug
            const isCurrentPaper = currentPaperUrlRef.current === paperUrl;

            if (isCurrentPaper) {
              // Update stored paper reference
              setStoredPaper(freshPaper);

              // Update data (explanation/summary)
              setData({
                paper: freshPaper,
                explanation: freshPaper.explanation || null,
                summary: freshPaper.summary || null,
              });

              // Update analysis
              if (freshPaper.analysis) {
                setAnalysis(freshPaper.analysis);
              }

              // Update glossary
              if (freshPaper.glossary) {
                const sortedGlossary = {
                  ...freshPaper.glossary,
                  terms: [...freshPaper.glossary.terms].sort((a, b) => a.acronym.localeCompare(b.acronym))
                };
                setGlossary(sortedGlossary);
              }
            }
          }
        } catch (error) {
          logger.error('UI', '[Sidepanel] Error reloading paper on operation update:', error);
        }
      }
    });

    // Create navigation message listener for NAVIGATE_TO_PAPER
    const navigationListener = async (message: any) => {
      if (message.type === MessageType.NAVIGATE_TO_PAPER) {
        const targetUrl = message.payload?.url;
        if (!targetUrl) return;

        logger.debug('UI', '[Sidepanel] Received navigation request for URL:', targetUrl);

        // Fetch fresh papers from ChromeService to avoid stale closure
        const papers = await ChromeService.getAllPapers();
        logger.debug('UI', '[Sidepanel] Fetched', papers.length, 'papers for navigation');

        const normalizedTargetUrl = normalizeUrl(targetUrl);
        const paperIndex = papers.findIndex(p => normalizeUrl(p.url) === normalizedTargetUrl);

        if (paperIndex !== -1) {
          logger.debug('UI', '[Sidepanel] Navigating to paper at index:', paperIndex);
          // Update allPapers and navigate using fresh array (avoid state timing)
          paperNavigation.setAllPapers(papers);
          await paperNavigation.switchToPaper(paperIndex, papers);
        } else {
          logger.warn('UI', '[Sidepanel] Paper not found for URL:', targetUrl);
        }
      }
    };

    // Create glossary progress listener for GLOSSARY_PROGRESS updates
    const glossaryProgressListener = (message: any) => {
      if (message.type === MessageType.GLOSSARY_PROGRESS) {
        logger.debug('UI', '[Sidepanel] Glossary progress update:', message.payload);
        setGlossaryProgress(message.payload);
      }
    };

    // Create glossary batch completion listener for progressive display
    const glossaryBatchCompleteListener = (message: any) => {
      if (message.type === MessageType.GLOSSARY_BATCH_COMPLETE) {
        const { paperUrl, terms } = message.payload;

        // Only update if it's the current paper
        if (currentPaperUrlRef.current && normalizeUrl(currentPaperUrlRef.current) === normalizeUrl(paperUrl)) {
          logger.debug('UI', '[Sidepanel] Glossary batch complete:', terms.length, 'new terms');

          // Update glossary state with new terms (append to existing)
          setGlossary((prevGlossary) => {
            // Merge new terms with existing terms
            const allTerms = [...(prevGlossary?.terms || []), ...terms];

            // Sort alphabetically by acronym for consistent display
            allTerms.sort((a, b) => a.acronym.localeCompare(b.acronym));

            return {
              terms: allTerms,
              timestamp: prevGlossary?.timestamp || Date.now(),
            };
          });
        }
      }
    };

    // Create analysis progress listener for ANALYSIS_PROGRESS updates
    const analysisProgressListener = (message: any) => {
      if (message.type === MessageType.ANALYSIS_PROGRESS) {
        logger.debug('UI', '[Sidepanel] Analysis progress update:', message.payload);
        setAnalysisProgress(message.payload);
      }
    };

    // Create analysis section completion listener for progressive display
    const analysisSectionCompleteListener = (message: any) => {
      if (message.type === MessageType.ANALYSIS_SECTION_COMPLETE) {
        const { paperUrl, section, result } = message.payload;

        // Only update if it's the current paper
        if (currentPaperUrlRef.current && normalizeUrl(currentPaperUrlRef.current) === normalizeUrl(paperUrl)) {
          logger.debug('UI', '[Sidepanel] Analysis section complete:', section);

          // Update analysis state with partial result
          setAnalysis((prevAnalysis) => ({
            ...prevAnalysis,
            [section]: result,
            timestamp: prevAnalysis?.timestamp || Date.now(),
          }));
        }
      }
    };

    // Create paper deleted listener for PAPER_DELETED broadcasts
    const paperDeletedListener = async (message: any) => {
      if (message.type === MessageType.PAPER_DELETED) {
        const deletedPaperUrl = message.payload?.paperUrl;
        if (!deletedPaperUrl) return;

        logger.debug('UI', '[Sidepanel] Paper deleted externally:', deletedPaperUrl);

        // Clean up operation states for deleted paper
        const normalizedDeletedUrl = normalizeUrl(deletedPaperUrl);
        operationState.clearExplainingPaper(normalizedDeletedUrl);
        operationState.clearSummaryGeneratingPaper(normalizedDeletedUrl);
        operationState.clearAnalyzingPaper(normalizedDeletedUrl);
        operationState.clearGlossaryGeneratingPaper(normalizedDeletedUrl);

        // Refresh papers list from IndexedDB
        const allPapers = await ChromeService.getAllPapers();
        paperNavigation.setAllPapers(allPapers);

        // Check if deleted paper was the current paper
        const currentPaperUrl = currentPaperUrlRef.current;
        if (currentPaperUrl && normalizeUrl(currentPaperUrl) === normalizedDeletedUrl) {
          // Current paper was deleted
          if (allPapers.length === 0) {
            // No papers left - show empty state
            setStoredPaper(null);
            setViewState('empty');
            setQaHistory([]);
            setData(null);
            setAnalysis(null);
            setGlossary(null);
          } else {
            // Switch to another paper (first paper in the list)
            logger.debug('UI', '[Sidepanel] Current paper deleted, switching to first paper');
            await paperNavigation.switchToPaper(0, allPapers);
          }
        } else {
          // Different paper was deleted, just re-sync the current paper's index
          if (currentPaperUrl) {
            const newIndex = allPapers.findIndex(p => normalizeUrl(p.url) === normalizeUrl(currentPaperUrl));
            if (newIndex !== -1 && newIndex !== paperNavigation.currentPaperIndex) {
              logger.debug('UI', '[Sidepanel] Re-syncing paper index after external deletion:', paperNavigation.currentPaperIndex, '→', newIndex);
              paperNavigation.setCurrentPaperIndex(newIndex);
            }
          }
        }
      }
    };

    // Register message listeners
    chrome.runtime.onMessage.addListener(messageListener);
    chrome.runtime.onMessage.addListener(navigationListener);
    chrome.runtime.onMessage.addListener(glossaryProgressListener);
    chrome.runtime.onMessage.addListener(glossaryBatchCompleteListener);
    chrome.runtime.onMessage.addListener(analysisProgressListener);
    chrome.runtime.onMessage.addListener(analysisSectionCompleteListener);
    chrome.runtime.onMessage.addListener(paperDeletedListener);

    return () => {
      chrome.runtime.onMessage.removeListener(messageListener);
      chrome.runtime.onMessage.removeListener(navigationListener);
      chrome.runtime.onMessage.removeListener(glossaryProgressListener);
      chrome.runtime.onMessage.removeListener(glossaryBatchCompleteListener);
      chrome.runtime.onMessage.removeListener(analysisProgressListener);
      chrome.runtime.onMessage.removeListener(analysisSectionCompleteListener);
      chrome.runtime.onMessage.removeListener(paperDeletedListener);
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

  /**
   * Reusable function to load all paper data into display state
   * Ensures synchronization between navigation and content
   */
  async function loadPaperData(paper: StoredPaper) {
    logger.debug('UI', '[Sidepanel] Loading paper data:', paper.title);

    setStoredPaper(paper);
    setQaHistory(paper.qaHistory || []);

    // Restore draft question if exists
    const draftQuestion = draftQuestions.get(paper.url) || '';
    setQuestion(draftQuestion);

    // Always show content state (all tabs) for stored papers
    // Individual section components handle showing "Generate" buttons when content doesn't exist
    setData({
      paper: paper,
      explanation: paper.explanation || null,
      summary: paper.summary || null
    });
    setViewState('content');

    // Load analysis
    if (paper.analysis) {
      logger.debug('UI', '[Sidepanel] Loading analysis from paper');
      setAnalysis(paper.analysis);
    } else {
      setAnalysis(null);
    }

    // Load glossary
    if (paper.glossary) {
      logger.debug('UI', '[Sidepanel] Loading glossary from paper');
      const sortedGlossary = {
        ...paper.glossary,
        terms: [...paper.glossary.terms].sort((a, b) => a.acronym.localeCompare(b.acronym))
      };
      setGlossary(sortedGlossary);
    } else {
      setGlossary(null);
    }

    // Query operation state to restore progress if paper is being analyzed/glossary-generated
    // This ensures immediate progress display when switching back to an in-progress paper
    try {
      const stateResponse = await ChromeService.getOperationStateByPaper(paper.url);

      if (stateResponse.success && stateResponse.state) {
        const state = stateResponse.state;

        // Update analysis state: both progress and operationState Set
        if (state.isAnalyzing) {
          operationState.addAnalyzingPaper(paper.url);

          if (state.analysisProgressStage) {
            setAnalysisProgress({
              stage: state.analysisProgressStage as 'evaluating' | 'analyzing',
              current: state.currentAnalysisStep,
              total: state.totalAnalysisSteps,
            });
            logger.debug('UI', '[loadPaperData] Restored analysis progress:', state.analysisProgressStage, state.currentAnalysisStep, '/', state.totalAnalysisSteps);
          }
        } else {
          operationState.removeAnalyzingPaper(paper.url);
          setAnalysisProgress(null);
        }

        // Update glossary state: both progress and operationState Set
        if (state.isGeneratingGlossary) {
          operationState.addGlossaryGeneratingPaper(paper.url);

          if (state.glossaryProgressStage) {
            setGlossaryProgress({
              stage: state.glossaryProgressStage as 'extracting' | 'filtering-terms' | 'generating-definitions',
              current: state.currentGlossaryTerm,
              total: state.totalGlossaryTerms,
            });
            logger.debug('UI', '[loadPaperData] Restored glossary progress:', state.glossaryProgressStage, state.currentGlossaryTerm, '/', state.totalGlossaryTerms);
          }
        } else {
          operationState.removeGlossaryGeneratingPaper(paper.url);
          setGlossaryProgress(null);
        }
      } else {
        // No operation state found, clear both progress states and Sets
        operationState.removeAnalyzingPaper(paper.url);
        operationState.removeGlossaryGeneratingPaper(paper.url);
        setAnalysisProgress(null);
        setGlossaryProgress(null);
      }
    } catch (error) {
      logger.warn('UI', '[loadPaperData] Could not load operation state for paper:', error);
      // Clear both progress states and Sets on error to prevent contamination
      operationState.removeAnalyzingPaper(paper.url);
      operationState.removeGlossaryGeneratingPaper(paper.url);
      setAnalysisProgress(null);
      setGlossaryProgress(null);
    }
  }

  async function loadExplanation() {
    try {
      // Parallelize independent async operations for faster load
      const [papers, [tab]] = await Promise.all([
        ChromeService.getAllPapers(),
        chrome.tabs.query({ active: true, currentWindow: true })
      ]);

      paperNavigation.setAllPapers(papers);
      logger.debug('UI', '[Sidepanel] Loaded', papers.length, 'papers from IndexedDB');

      const currentUrl = tab?.url;

      // Query IndexedDB for paper matching current tab URL (single source of truth)
      if (!currentUrl) {
        logger.debug('UI', '[Sidepanel] No current URL, showing empty state');
        setViewState('empty');
        return;
      }

      logger.debug('UI', '[Sidepanel] Checking IndexedDB for paper at URL:', currentUrl);
      setIsCheckingStorage(true);

      try {
        const stored = await checkForStoredPaper(currentUrl);
        let paperToLoad: StoredPaper | null = null;

        if (stored) {
          // Sync navigation selector to the loaded paper
          const paperIndex = papers.findIndex(p => p.id === stored.id);
          if (paperIndex !== -1) {
            paperNavigation.setCurrentPaperIndex(paperIndex);
            logger.debug('UI', '[Sidepanel] Synced navigation to paper index:', paperIndex);
          }
          paperToLoad = stored;
        } else {
          // No paper found for current URL - check if we have any papers to show as fallback
          if (papers.length > 0) {
            logger.debug('UI', '[Sidepanel] No paper for current URL, loading first paper as fallback');
            // Set navigation to first paper
            paperNavigation.setCurrentPaperIndex(0);
            paperToLoad = papers[0];
          } else {
            // Truly no papers in database - show empty state
            logger.debug('UI', '[Sidepanel] No papers in database');
            setViewState('empty');
          }
        }

        // Load paper data first
        if (paperToLoad) {
          await loadPaperData(paperToLoad);

          // Now query operation state for THIS specific paper by URL
          try {
            const stateResponse = await ChromeService.getOperationStateByPaper(paperToLoad.url);

            if (stateResponse.success && stateResponse.state) {
              const state = stateResponse.state;
              logger.debug('UI', '[Sidepanel] Loaded operation state for paper:', paperToLoad.url, state);

              // Update banner states based on current operation
              setIsExplainingInBackground(state.isExplaining);

              // Update paper-specific generation states
              if (state.isExplaining) {
                operationState.addExplainingPaper(paperToLoad.url);
              }
              if (state.isGeneratingSummary) {
                operationState.addSummaryGeneratingPaper(paperToLoad.url);
              }
              if (state.isAnalyzing) {
                operationState.addAnalyzingPaper(paperToLoad.url);

                // Restore analysis progress if available
                if (state.analysisProgressStage) {
                  setAnalysisProgress({
                    stage: state.analysisProgressStage as 'evaluating' | 'analyzing',
                    current: state.currentAnalysisStep,
                    total: state.totalAnalysisSteps,
                  });
                  logger.debug('UI', '[Sidepanel] Restored analysis progress:', state.analysisProgressStage, state.currentAnalysisStep, '/', state.totalAnalysisSteps);
                }
              }
              if (state.isGeneratingGlossary) {
                operationState.addGlossaryGeneratingPaper(paperToLoad.url);

                // Restore glossary progress if available
                if (state.glossaryProgressStage) {
                  setGlossaryProgress({
                    stage: state.glossaryProgressStage as 'extracting' | 'filtering-terms' | 'generating-definitions',
                    current: state.currentGlossaryTerm,
                    total: state.totalGlossaryTerms,
                  });
                  logger.debug('UI', '[Sidepanel] Restored glossary progress:', state.glossaryProgressStage, state.currentGlossaryTerm, '/', state.totalGlossaryTerms);
                }
              }
            } else {
              logger.debug('UI', '[Sidepanel] No operation state found for paper:', paperToLoad.url);
            }
          } catch (stateError) {
            logger.warn('UI', '[Sidepanel] Could not load operation state for paper:', stateError);
          }
        }
      } catch (dbError) {
        logger.error('UI', '[Sidepanel] Error loading from IndexedDB:', dbError);
        setViewState('empty');
      } finally {
        setIsCheckingStorage(false);
      }
    } catch (error) {
      logger.error('UI', 'Error loading explanation:', error);
      setViewState('empty');
    }
  }

  async function triggerAnalysis(paperUrl: string) {
    // Guard: Don't retrigger if already analyzing THIS paper
    if (operationState.isAnalyzing(paperUrl)) {
      logger.debug('UI', '[Sidepanel] Analysis already in progress for this paper, skipping');
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
      logger.debug('UI', 'Starting paper analysis for:', paperUrl);

      // Get active tab ID to associate operation state
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const tabId = tab?.id;

      const response = await ChromeService.analyzePaper(paperUrl, tabId);

      if (response.success) {
        logger.debug('UI', '✓ Paper analysis completed successfully');
        // Analysis will be loaded automatically via storage change listener
      } else {
        logger.error('UI', 'Analysis failed:', response.error);
        // Show error to user
        setOperationQueueMessage(`Analysis failed: ${response.error}`);
        setHasQueuedOperations(true);
        setTimeout(() => {
          setHasQueuedOperations(false);
          setOperationQueueMessage('');
        }, 5000);
      }
    } catch (error) {
      logger.error('UI', 'Error triggering analysis:', error);
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
      logger.debug('UI', '[Sidepanel] Glossary generation already in progress for this paper, skipping');
      setOperationQueueMessage('Glossary generation already in progress for this paper');
      setHasQueuedOperations(true);
      setTimeout(() => {
        setHasQueuedOperations(false);
        setOperationQueueMessage('');
      }, 3000);
      return;
    }

    try {
      // Add to glossary generating papers Set (progress updates come from message listener)
      operationState.addGlossaryGeneratingPaper(paperUrl);
      logger.debug('UI', 'Starting glossary generation for:', paperUrl);

      // Get active tab ID to associate operation state
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const tabId = tab?.id;

      const response = await ChromeService.generateGlossary(paperUrl, tabId);

      if (response.success && response.glossary) {
        logger.debug('UI', '✓ Glossary generated successfully');
        const sortedGlossary = {
          ...response.glossary,
          terms: [...response.glossary.terms].sort((a, b) => a.acronym.localeCompare(b.acronym))
        };
        setGlossary(sortedGlossary);

        // Update storedPaper and allPapers to reflect the new glossary
        // This prevents the glossary from being cleared when switchToPaper is called
        if (storedPaper) {
          const updatedPaper = { ...storedPaper, glossary: response.glossary };
          setStoredPaper(updatedPaper);

          // Update the paper in allPapers array
          const updatedAllPapers = [...paperNavigation.allPapers];
          updatedAllPapers[paperNavigation.currentPaperIndex] = updatedPaper;
          paperNavigation.setAllPapers(updatedAllPapers);

          logger.debug('UI', '[Sidepanel] Updated storedPaper and allPapers with new glossary');
        }
      } else {
        logger.error('UI', 'Glossary generation failed:', response.error);
        // Show error to user
        setOperationQueueMessage(`Glossary generation failed: ${response.error}`);
        setHasQueuedOperations(true);
        setTimeout(() => {
          setHasQueuedOperations(false);
          setOperationQueueMessage('');
        }, 5000);
      }
    } catch (error) {
      logger.error('UI', 'Error triggering glossary generation:', error);
      setOperationQueueMessage('Failed to generate glossary');
      setHasQueuedOperations(true);
      setTimeout(() => {
        setHasQueuedOperations(false);
        setOperationQueueMessage('');
      }, 3000);
    } finally {
      // Remove from glossary generating papers Set and reset progress
      operationState.removeGlossaryGeneratingPaper(paperUrl);
      setGlossaryProgress(null);
    }
  }

  async function triggerExplanation(paperUrl: string) {
    // Guard: Don't retrigger if already explaining for THIS paper
    if (operationState.isExplaining(paperUrl)) {
      logger.debug('UI', '[Sidepanel] Explanation generation already in progress for this paper, skipping');
      setOperationQueueMessage('Explanation generation already in progress for this paper');
      setHasQueuedOperations(true);
      setTimeout(() => {
        setHasQueuedOperations(false);
        setOperationQueueMessage('');
      }, 3000);
      return;
    }

    try {
      // Add to explaining papers Set
      operationState.addExplainingPaper(paperUrl);
      logger.debug('UI', 'Starting explanation generation for:', paperUrl);

      // Get active tab ID to associate operation state
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const tabId = tab?.id;

      const response = await ChromeService.explainPaperManual(paperUrl, tabId);

      if (response.success) {
        logger.debug('UI', '✓ Explanation generated successfully');
        // Explanation will be loaded automatically via storage change listener
      } else {
        logger.error('UI', 'Explanation generation failed:', response.error);
        // Show error to user
        setOperationQueueMessage(`Explanation generation failed: ${response.error}`);
        setHasQueuedOperations(true);
        setTimeout(() => {
          setHasQueuedOperations(false);
          setOperationQueueMessage('');
        }, 5000);
      }
    } catch (error) {
      logger.error('UI', 'Error triggering explanation generation:', error);
      setOperationQueueMessage('Failed to generate explanation');
      setHasQueuedOperations(true);
      setTimeout(() => {
        setHasQueuedOperations(false);
        setOperationQueueMessage('');
      }, 3000);
    } finally {
      // Remove from explaining papers Set
      operationState.removeExplainingPaper(paperUrl);
    }
  }

  async function triggerSummary(paperUrl: string) {
    // Guard: Don't retrigger if already generating summary for THIS paper
    if (operationState.isGeneratingSummary(paperUrl)) {
      logger.debug('UI', '[Sidepanel] Summary generation already in progress for this paper, skipping');
      setOperationQueueMessage('Summary generation already in progress for this paper');
      setHasQueuedOperations(true);
      setTimeout(() => {
        setHasQueuedOperations(false);
        setOperationQueueMessage('');
      }, 3000);
      return;
    }

    try {
      // Add to summary generating papers Set
      operationState.addSummaryGeneratingPaper(paperUrl);
      logger.debug('UI', 'Starting summary generation for:', paperUrl);

      // Get active tab ID to associate operation state
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const tabId = tab?.id;

      const response = await ChromeService.generateSummaryManual(paperUrl, tabId);

      if (response.success) {
        logger.debug('UI', '✓ Summary generated successfully');
        // Summary will be loaded automatically via storage change listener
      } else {
        logger.error('UI', 'Summary generation failed:', response.error);
        // Show error to user
        setOperationQueueMessage(`Summary generation failed: ${response.error}`);
        setHasQueuedOperations(true);
        setTimeout(() => {
          setHasQueuedOperations(false);
          setOperationQueueMessage('');
        }, 5000);
      }
    } catch (error) {
      logger.error('UI', 'Error triggering summary generation:', error);
      setOperationQueueMessage('Failed to generate summary');
      setHasQueuedOperations(true);
      setTimeout(() => {
        setHasQueuedOperations(false);
        setOperationQueueMessage('');
      }, 3000);
    } finally {
      // Remove from summary generating papers Set
      operationState.removeSummaryGeneratingPaper(paperUrl);
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

    const paperUrl = data.paper.url;

    // Guard: Don't retrigger if already asking a question for THIS paper
    if (operationState.isAsking(paperUrl)) {
      logger.debug('UI', '[Sidepanel] Q&A already in progress for this paper, skipping');
      setOperationQueueMessage('Q&A already in progress for this paper');
      setHasQueuedOperations(true);
      setTimeout(() => {
        setHasQueuedOperations(false);
        setOperationQueueMessage('');
      }, 3000);
      return;
    }

    try {
      // Add to asking papers Set
      operationState.addAskingPaper(paperUrl);
      logger.debug('UI', 'Asking question:', question);

      const sanitizedQuestion = question.trim();

      const newQA = {
        question: sanitizedQuestion,
        answer: '',
        sources: [],
        timestamp: Date.now(),
      };

      const newHistory = [newQA, ...qaHistory];
      setQaHistory(newHistory);
      if(activeTab === 'qa') {
        setNewlyAddedQAIndex(0);
      }

      if (storedPaper) {
        await ChromeService.updatePaperQAHistory(storedPaper.id, newHistory);
      }

      const response = await ChromeService.askQuestion(data.paper.url, sanitizedQuestion);

      if (response.success && response.answer) {
        logger.debug('UI', '✓ Question answered successfully');
        // update history
        const answeredHistory = [response.answer, ...qaHistory];
        setQaHistory(answeredHistory);
        setQuestion(''); // Clear input

        // Remove draft question from Map since it's been answered
        setDraftQuestions(prev => {
          const next = new Map(prev);
          next.delete(data.paper.url);
          return next;
        });

        // If user is on Q&A tab when answer arrives, mark it as newly added
        if (activeTab === 'qa') {
          setNewlyAddedQAIndex(0); // New answer is at index 0 (prepended to array)
        }

        // Save Q&A history to database
        if (storedPaper) {
          await ChromeService.updatePaperQAHistory(storedPaper.id, answeredHistory);
        }
      } else {
        logger.error('UI', 'Question answering failed:', response.error);

        alert(`Failed to answer question: ${response.error}`);
      }
    } catch (error) {
      const revertHistory = [...qaHistory];
      setQaHistory(revertHistory);
      if(activeTab === 'qa') {
        setNewlyAddedQAIndex(revertHistory.length - 1);
      }

      if (storedPaper && revertHistory.length > 0) {
        await ChromeService.updatePaperQAHistory(storedPaper.id, revertHistory);
      }
      logger.error('UI', 'Error asking question:', error);
      alert('Failed to ask question. Please try again.');
    } finally {
      // Remove from asking papers Set
      operationState.removeAskingPaper(paperUrl);
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
      logger.error('UI', 'Error copying:', error);
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
      logger.error('UI', 'Error regenerating:', error);
      alert('Failed to regenerate explanation');
      setViewState('empty');
    } finally {
      setIsRegenerating(false);
    }
  }

  async function handleManualRefresh() {
    logger.debug('UI', '[Sidepanel] Manual refresh requested');
    setIsCheckingStorage(true);
    await loadExplanation();
  }

  async function handleOpenChat() {
    if (!storedPaper) return;

    try {
      // Get the active tab
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab.id) {
        await ChromeService.toggleChatbox(tab.id);
      }
    } catch (error) {
      logger.error('UI', '[Sidepanel] Failed to toggle chatbox:', error);
    }
  }

  // Paper navigation and management functions
  async function switchToPaper(index: number, papersArray?: StoredPaper[]) {
    // Use provided array or fall back to hook state
    const papers = papersArray || paperNavigation.allPapers;

    if (index < 0 || index >= papers.length) return;

    logger.debug('UI', `[Sidepanel] Switching to paper at index ${index}`);

    // Save current paper's Q&A history before switching
    if (storedPaper && qaHistory.length > 0) {
      await ChromeService.updatePaperQAHistory(storedPaper.id, qaHistory);
    }

    // Save current paper's draft question before switching
    if (storedPaper && question.trim()) {
      setDraftQuestions(prev => {
        const next = new Map(prev);
        next.set(storedPaper.url, question);
        return next;
      });
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

    // Restore draft question for new paper
    const draftQuestion = draftQuestions.get(paperToUse.url) || '';
    setQuestion(draftQuestion);

    // Load explanation and summary from IndexedDB (single source of truth)
    logger.debug('UI', '[Sidepanel] Loading paper data from IndexedDB');
    setData({
      paper: paperToUse,
      explanation: paperToUse.explanation || null,
      summary: paperToUse.summary || null,
    });
    setActiveTab('summary');
    setViewState('content');

    // Load analysis from IndexedDB (single source of truth)
    if (paperToUse.analysis) {
      logger.debug('UI', '[Sidepanel] Loading analysis from IndexedDB');
      setAnalysis(paperToUse.analysis);
    } else {
      // Paper switching should NOT auto-trigger analysis (prevents retrigger bug)
      // Analysis is only auto-triggered during initial load in loadExplanation()
      logger.debug('UI', '[Sidepanel] No analysis for this paper');
      setAnalysis(null);
    }

    // Load glossary from IndexedDB (single source of truth)
    if (paperToUse.glossary) {
      logger.debug('UI', '[Sidepanel] Loading glossary from IndexedDB');
      const sortedGlossary = {
        ...paperToUse.glossary,
        terms: [...paperToUse.glossary.terms].sort((a, b) => a.acronym.localeCompare(b.acronym))
      };
      setGlossary(sortedGlossary);
    } else {
      // Paper switching should NOT auto-trigger glossary generation (prevents retrigger bug)
      // Glossary is only auto-triggered during initial load in loadExplanation()
      logger.debug('UI', '[Sidepanel] No glossary for this paper');
      setGlossary(null);
    }

    // Query operation state to restore progress if paper is being analyzed/glossary-generated
    // This ensures immediate progress display when switching back to an in-progress paper
    try {
      const stateResponse = await ChromeService.getOperationStateByPaper(paperToUse.url);

      if (stateResponse.success && stateResponse.state) {
        const state = stateResponse.state;

        // Update analysis state: both progress and operationState Set
        if (state.isAnalyzing) {
          operationState.addAnalyzingPaper(paperToUse.url);

          if (state.analysisProgressStage) {
            setAnalysisProgress({
              stage: state.analysisProgressStage as 'evaluating' | 'analyzing',
              current: state.currentAnalysisStep,
              total: state.totalAnalysisSteps,
            });
            logger.debug('UI', '[switchToPaper] Restored analysis progress:', state.analysisProgressStage, state.currentAnalysisStep, '/', state.totalAnalysisSteps);
          }
        } else {
          operationState.removeAnalyzingPaper(paperToUse.url);
          setAnalysisProgress(null);
        }

        // Update glossary state: both progress and operationState Set
        if (state.isGeneratingGlossary) {
          operationState.addGlossaryGeneratingPaper(paperToUse.url);

          if (state.glossaryProgressStage) {
            setGlossaryProgress({
              stage: state.glossaryProgressStage as 'extracting' | 'filtering-terms' | 'generating-definitions',
              current: state.currentGlossaryTerm,
              total: state.totalGlossaryTerms,
            });
            logger.debug('UI', '[switchToPaper] Restored glossary progress:', state.glossaryProgressStage, state.currentGlossaryTerm, '/', state.totalGlossaryTerms);
          }
        } else {
          operationState.removeGlossaryGeneratingPaper(paperToUse.url);
          setGlossaryProgress(null);
        }
      } else {
        // No operation state found, clear both progress states and Sets
        operationState.removeAnalyzingPaper(paperToUse.url);
        operationState.removeGlossaryGeneratingPaper(paperToUse.url);
        setAnalysisProgress(null);
        setGlossaryProgress(null);
      }
    } catch (error) {
      logger.warn('UI', '[switchToPaper] Could not load operation state for paper:', error);
      // Clear both progress states and Sets on error to prevent contamination
      operationState.removeAnalyzingPaper(paperToUse.url);
      operationState.removeGlossaryGeneratingPaper(paperToUse.url);
      setAnalysisProgress(null);
      setGlossaryProgress(null);
    }
  }

  async function handleDeletePaper() {
    // Use hook's delete function with current paper and QA history
    // The hook handles navigation to next paper internally
    await paperNavigation.handleDeletePaper(storedPaper, qaHistory);
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
      logger.debug('UI', '[Sidepanel] Deleting all papers:', paperNavigation.allPapers.length);

      // Delete all papers one by one
      let successCount = 0;
      for (const paper of paperNavigation.allPapers) {
        const success = await ChromeService.deletePaper(paper.id);
        if (success) {
          successCount++;
        }
      }

      logger.debug('UI', `[Sidepanel] Deleted ${successCount}/${paperNavigation.allPapers.length} papers`);

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
      logger.error('UI', '[Sidepanel] Error deleting all papers:', error);
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
      logger.debug('UI', '[Sidepanel] Resetting sidepanel state...');

      // Reset all component state
      setData(null);
      setAnalysis(null);
      setGlossary(null);
      setQaHistory([]);
      setStoredPaper(null);
      setViewState('empty');

      // Reload from IndexedDB (single source of truth)
      await loadExplanation();

      logger.debug('UI', '[Sidepanel] ✓ Sidepanel state reset and reloaded from IndexedDB');
    } catch (error) {
      logger.error('UI', '[Sidepanel] Error resetting state:', error);
      alert('Failed to reset state. Please try again.');
    }
  }

  if (viewState === 'loading') {
    return (
      <div class="h-screen flex items-center justify-center bg-gray-50">
        <div class="text-center">
          <LottiePlayer path="/lotties/kuma-thinking.lottie" size={120} className="mb-4 mx-auto" autoStartLoop={true} loopPurpose={LoopPurpose.SIDEPANEL} />
          {isCheckingStorage ? (
            <div>
              <p class="text-gray-600 font-medium text-base">Kuma is retrieving papers from storage...</p>
              <p class="text-sm text-gray-500 mt-2">Retrying with exponential backoff</p>
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
          title="No Research Papers Yet"
          subtitle='Click "Detect & Explain Paper" in the popup to generate an explanation'
        />
      </div>
    );
  }

  return (
    <div class="h-screen flex flex-col bg-gray-50">
      {/* Integrated Header */}
      <IntegratedHeader
        papers={paperNavigation.allPapers}
        currentIndex={paperNavigation.currentPaperIndex}
        currentPaperTitle={storedPaper?.title}
        subtitle="A bear that helps you understand research papers"
        topLevelTab={topLevelTab}
        onTopLevelTabChange={setTopLevelTab}
        onPrevious={handlePrevPaper}
        onNext={handleNextPaper}
        onSelect={(index) => switchToPaper(index)}
        onDeleteCurrent={handleDeletePaper}
        isDeleting={paperNavigation.isDeleting}
        showDeleteConfirm={paperNavigation.showDeleteConfirm}
        onCancelDelete={() => paperNavigation.setShowDeleteConfirm(false)}
        onDeleteAll={handleDeleteAllPapers}
        isDeletingAll={isDeletingAll}
        showDeleteAllConfirm={showDeleteAllConfirm}
        onCancelDeleteAll={() => setShowDeleteAllConfirm(false)}
        onOpenChat={handleOpenChat}
        hasChatEnabled={!!storedPaper && storedPaper.chunkCount > 0}
      />

      {/* Content */}
      <div class="flex-1 overflow-auto">
        <div class="max-w-4xl mx-auto px-responsive py-responsive">
          {/* Debug Panel */}
          <DebugPanel
            show={showDebug}
            debugInfo={debugInfo}
            onRefresh={collectDebugInfo}
            onClearStorage={handleClearAllStorage}
          />

          {/* Operation Queue Banner */}
          {hasQueuedOperations && operationQueueMessage && (
            <OperationBanner
              status="warning"
              title={operationQueueMessage}
            />
          )}


          {/* Citations Tab Content */}
          {topLevelTab === 'citations' && (
            <div class="tab-content space-y-4">
              <CitationsSection />
            </div>
          )}

          {/* Settings Tab Content */}
          {topLevelTab === 'settings' && (
            <div class="tab-content">
              <SettingsTab />
            </div>
          )}

          {/* Papers Tab Content */}
          {topLevelTab === 'papers' && (
            <>
              {/* Paper Info Card */}
              <PaperInfoCard paper={data?.paper || null} storedPaper={storedPaper} />

              {/* Tabs */}
              {/* Dropdown for narrow screens */}
              <>
            <div class="mb-4 hide-on-wide text-center">
                <TabDropdown
                  tabs={[
                    {
                      id: 'summary',
                      label: 'Summary',
                      active: activeTab === 'summary',
                      onClick: () => setActiveTab('summary'),
                    },
                    {
                      id: 'explanation',
                      label: 'Explanation',
                      active: activeTab === 'explanation',
                      onClick: () => setActiveTab('explanation'),
                    },
                    {
                      id: 'analysis',
                      label: 'Analysis',
                      active: activeTab === 'analysis',
                      loading: storedPaper?.url ? operationState.isAnalyzing(storedPaper.url) : false,
                      title: (storedPaper?.url && operationState.isAnalyzing(storedPaper.url)) ? 'Analysis in progress...' : !analysis ? 'Analysis will start automatically when paper is stored' : '',
                      onClick: () => setActiveTab('analysis'),
                    },
                    {
                      id: 'qa',
                      label: 'Q&A',
                      active: activeTab === 'qa',
                      disabled: !storedPaper,
                      title: !storedPaper ? 'Paper must be stored to ask questions' : 'Ask questions about this paper',
                      onClick: () => setActiveTab('qa'),
                    },
                    {
                      id: 'glossary',
                      label: 'Glossary',
                      active: activeTab === 'glossary',
                      loading: storedPaper?.url ? operationState.isGeneratingGlossary(storedPaper.url) : false,
                      title: (storedPaper?.url && operationState.isGeneratingGlossary(storedPaper.url)) ? 'Glossary being generated...' : !glossary ? 'Glossary will be generated when paper is stored' : '',
                      onClick: () => setActiveTab('glossary'),
                    },
                    {
                      id: 'original',
                      label: 'Original',
                      active: activeTab === 'original',
                      onClick: () => setActiveTab('original'),
                    },
                  ]}
                  activeTabLabel={
                    activeTab === 'summary' ? 'Summary' :
                    activeTab === 'explanation' ? 'Explanation' :
                    activeTab === 'analysis' ? 'Analysis' :
                    activeTab === 'qa' ? 'Q&A' :
                    activeTab === 'glossary' ? 'Glossary' :
                    'Original'
                  }
                />
              </div>

              {/* Horizontal tabs for wide screens */}
              <div class="mb-4 border-b border-gray-200 -mx-responsive hide-on-narrow">
                <div class="flex gap-1 overflow-x-auto px-responsive scrollbar-hide" style="scrollbar-width: none; -ms-overflow-style: none;">
                  {/* Paper-Specific Tabs */}
                  <TabButton
                    active={activeTab === 'summary'}
                    onClick={() => setActiveTab('summary')}
                    loading={storedPaper?.url ? operationState.isGeneratingSummary(storedPaper.url) : false}
                    title={(storedPaper?.url && operationState.isGeneratingSummary(storedPaper.url)) ? 'Summary being generated...' : !data?.summary ? 'Summary will be generated when paper is stored' : ''}
                  >
                    Summary
                  </TabButton>
                  <TabButton
                    active={activeTab === 'explanation'}
                    onClick={() => setActiveTab('explanation')}
                    loading={storedPaper?.url ? operationState.isExplaining(storedPaper.url) : false}
                    title={(storedPaper?.url && operationState.isExplaining(storedPaper.url)) ? 'Explanation being generated...' : !data?.explanation ? 'Explanation will be generated when paper is stored' : ''}
                  >
                    Explanation
                  </TabButton>
                  <TabButton
                    active={activeTab === 'analysis'}
                    onClick={() => setActiveTab('analysis')}
                    loading={storedPaper?.url ? operationState.isAnalyzing(storedPaper.url) : false}
                    title={(storedPaper?.url && operationState.isAnalyzing(storedPaper.url)) ? 'Analysis in progress...' : !analysis ? 'Analysis will start automatically when paper is stored' : ''}
                  >
                    Analysis
                  </TabButton>
                  <TabButton
                    active={activeTab === 'qa'}
                    onClick={() => setActiveTab('qa')}
                    disabled={!storedPaper}
                    loading={storedPaper?.url ? operationState.isAsking(storedPaper.url) : false}
                    title={!storedPaper ? 'Paper must be stored to ask questions' : (storedPaper?.url && operationState.isAsking(storedPaper.url)) ? 'Kuma is thinking about your question...' : 'Ask questions about this paper'}
                  >
                    Q&A
                  </TabButton>
                  <TabButton
                    active={activeTab === 'glossary'}
                    onClick={() => setActiveTab('glossary')}
                    loading={storedPaper?.url ? operationState.isGeneratingGlossary(storedPaper.url) : false}
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
              </div>

              {/* Tab Content */}
              <div class="space-y-4">
                {activeTab === 'summary' && (
                  <div class="tab-content space-y-4">
                    <SummarySection
                      summary={data?.summary || null}
                      isGeneratingSummary={storedPaper?.url ? operationState.isGeneratingSummary(storedPaper.url) : false}
                      onGenerateSummary={storedPaper?.url ? () => triggerSummary(storedPaper.url) : undefined}
                    />
                  </div>
                )}

                {activeTab === 'explanation' && (
                  <div class="tab-content space-y-4">
                    <ExplanationSection
                      explanation={data?.explanation || null}
                      isExplaining={storedPaper?.url ? operationState.isExplaining(storedPaper.url) : false}
                      onGenerateExplanation={storedPaper?.url ? () => triggerExplanation(storedPaper.url) : undefined}
                    />
                  </div>
                )}

                {activeTab === 'analysis' && (
                  <div class="tab-content space-y-4">
                    <AnalysisSection
                      analysis={analysis}
                      isAnalyzing={storedPaper?.url ? operationState.isAnalyzing(storedPaper.url) : false}
                      analysisProgress={analysisProgress}
                      onGenerateAnalysis={storedPaper?.url ? () => triggerAnalysis(storedPaper.url) : undefined}
                    />
                  </div>
                )}

                {activeTab === 'qa' && (
                  <div class="tab-content space-y-4">
                    <QASection
                      question={question}
                      setQuestion={setQuestion}
                      isAsking={storedPaper?.url ? operationState.isAsking(storedPaper.url) : false}
                      qaHistory={qaHistory}
                      storedPaper={storedPaper}
                      onAskQuestion={handleAskQuestion}
                      newlyAddedQAIndex={newlyAddedQAIndex}
                    />
                  </div>
                )}

                {activeTab === 'glossary' && (
                  <div class="tab-content space-y-4">
                    <GlossarySection
                      glossary={glossary}
                      isGenerating={storedPaper?.url ? operationState.isGeneratingGlossary(storedPaper.url) : false}
                      glossaryProgress={glossaryProgress}
                      onGenerateGlossary={storedPaper?.url ? () => triggerGlossaryGeneration(storedPaper.url) : undefined}
                    />
                  </div>
                )}

                {activeTab === 'original' && (
                  <div class="tab-content space-y-4">
                    <OriginalPaperTab paper={data?.paper || null} />
                  </div>
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
            </>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
