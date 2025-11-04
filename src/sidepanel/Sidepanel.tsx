import { useState, useEffect, useRef } from 'preact/hooks';
import { FileText } from 'lucide-preact';
import { ResearchPaper, ExplanationResult, SummaryResult, StoredPaper, PaperAnalysisResult, QuestionAnswer, GlossaryResult, MessageType } from '../shared/types/index.ts';
import { useDebounce } from './hooks/useDebounce.ts';
import { usePaperNavigation } from './hooks/usePaperNavigation.ts';
import { useOperationState } from './hooks/useOperationState.ts';
import { usePaperData } from './hooks/usePaperData.ts';
import { usePaperOperations } from './hooks/usePaperOperations.ts';
import { PaperDetailPanel } from './components/panels/PaperDetailPanel.tsx';
import { CitationsPanel } from './components/panels/CitationsPanel.tsx';
import { SettingsPanel } from './components/panels/SettingsPanel.tsx';
import { OperationBanner } from './components/ui/OperationBanner.tsx';
import { IntegratedHeader } from './components/ui/IntegratedHeader.tsx';
import { EmptyState } from './components/ui/EmptyState.tsx';
import { LottiePlayer, LoopPurpose } from '../shared/components/LottiePlayer.tsx';
import { DebugPanel } from './components/DebugPanel.tsx';
import { normalizeUrl } from '../shared/utils/urlUtils.ts';
import * as ChromeService from '../services/chromeService.ts';
import * as StorageService from '../services/storageService.ts';
import { logger } from '../shared/utils/logger.ts';

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
  const [data, setData] = useState<ExplanationData | null>(null);
  const [isCheckingStorage, setIsCheckingStorage] = useState(false);
  const [isExplainingInBackground, setIsExplainingInBackground] = useState(false);
  const [storedPaper, setStoredPaper] = useState<StoredPaper | null>(null);

  // Paper content state (updated by message listeners, passed to PaperDetailPanel)
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
  const [qaHistory, setQaHistory] = useState<QuestionAnswer[]>([]);
  const [question, setQuestion] = useState('');
  const [draftQuestions, setDraftQuestions] = useState<Map<string, string>>(new Map());

  // Ref to track current paper URL (avoids stale closure in listener)
  const currentPaperUrlRef = useRef<string | null>(null);

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
  const paperOperations = usePaperOperations(
    operationState,
    setOperationQueueMessage,
    setHasQueuedOperations
  );
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

      logger.debug('UI', '[Sidepanel] Current tab URL:', currentUrl);
      setIsCheckingStorage(true);

      try {
        let paperToLoad: StoredPaper | null = null;

        // Try to find paper matching current URL if we have one
        if (currentUrl) {
          logger.debug('UI', '[Sidepanel] Checking IndexedDB for paper at URL:', currentUrl);
          const stored = await checkForStoredPaper(currentUrl);

          if (stored) {
            // Sync navigation selector to the loaded paper
            const paperIndex = papers.findIndex(p => p.id === stored.id);
            if (paperIndex !== -1) {
              paperNavigation.setCurrentPaperIndex(paperIndex);
              logger.debug('UI', '[Sidepanel] Synced navigation to paper index:', paperIndex);
            }
            paperToLoad = stored;
          }
        }

        // If no paper found for current URL (or no URL), check if we have any papers to show as fallback
        if (!paperToLoad && papers.length > 0) {
          logger.debug('UI', '[Sidepanel] No paper for current URL, loading first paper as fallback');
          // Set navigation to first paper
          paperNavigation.setCurrentPaperIndex(0);
          paperToLoad = papers[0];
        }

        // If still no paper to load, show empty state
        if (!paperToLoad) {
          logger.debug('UI', '[Sidepanel] No papers in database');
          setViewState('empty');
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

  /**
   * Find the tab ID for a paper by its URL
   * Searches all tabs and returns the first one viewing this paper
   * @returns Tab ID if found, undefined otherwise
   */
  // Analysis, Explanation, and Summary operations moved to usePaperOperations hook

  // Create debounced version of triggerAnalysis from hook
  const debouncedTriggerAnalysis = useDebounce((paperUrl: string) => {
    paperOperations.triggerAnalysis(paperUrl);
  }, 500); // 500ms debounce for analysis

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

      // Create snapshot of paper IDs to avoid issues with array mutation during deletion
      // (PAPER_DELETED messages trigger listener that updates allPapers mid-iteration)
      const paperIdsToDelete = paperNavigation.allPapers.map(p => p.id);
      const totalPapers = paperIdsToDelete.length;

      logger.debug('UI', '[Sidepanel] Deleting all papers:', totalPapers);

      // Delete all papers one by one
      let successCount = 0;
      for (const paperId of paperIdsToDelete) {
        const success = await ChromeService.deletePaper(paperId);
        if (success) {
          successCount++;
        }
      }

      logger.debug('UI', `[Sidepanel] Deleted ${successCount}/${totalPapers} papers`);

      // Clear all state
      paperNavigation.setAllPapers([]);
      paperNavigation.setCurrentPaperIndex(0);
      setStoredPaper(null);
      setData(null);
      setAnalysis(null);
      setQaHistory([]);
      setViewState('empty');

      if (successCount < totalPapers) {
        alert(`Deleted ${successCount} out of ${totalPapers} papers. Some papers could not be deleted.`);
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
          {topLevelTab === 'citations' && <CitationsPanel />}

          {/* Settings Tab Content */}
          {topLevelTab === 'settings' && <SettingsPanel />}

          {/* Papers Tab Content */}
          {topLevelTab === 'papers' && (
            <PaperDetailPanel
              data={data}
              storedPaper={storedPaper}
              analysis={analysis}
              glossary={glossary}
              glossaryProgress={glossaryProgress}
              analysisProgress={analysisProgress}
              qaHistory={qaHistory}
              question={question}
              setQuestion={setQuestion}
              draftQuestions={draftQuestions}
              setDraftQuestions={setDraftQuestions}
              operationState={operationState}
              paperOperations={paperOperations}
              paperNavigation={paperNavigation}
              setStoredPaper={setStoredPaper}
              setGlossary={setGlossary}
              setGlossaryProgress={setGlossaryProgress}
              setQaHistory={setQaHistory}
              setOperationQueueMessage={setOperationQueueMessage}
              setHasQueuedOperations={setHasQueuedOperations}
              setViewState={setViewState}
              loadExplanation={loadExplanation}
            />
          )}
        </div>
      </div>
    </div>
  );
}
