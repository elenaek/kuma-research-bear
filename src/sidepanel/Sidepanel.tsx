import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import { Copy, RefreshCw, ExternalLink, FileText, Calendar, BookOpen, Hash, Download, Database, Clock, AlertCircle, CheckCircle, TrendingUp, AlertTriangle, Loader, PawPrint, ChevronLeft, ChevronRight, Trash2, Settings, ChevronDown, ChevronUp } from 'lucide-preact';
import { ResearchPaper, ExplanationResult, SummaryResult, StoredPaper, PaperAnalysisResult, QuestionAnswer, MessageType, GlossaryResult } from '../types/index.ts';
import { MarkdownRenderer } from '../components/MarkdownRenderer.tsx';
import { Tooltip } from '../components/Tooltip.tsx';
import { GlossaryList } from '../components/GlossaryCard.tsx';

// Debounce utility
function useDebounce<T extends (...args: any[]) => any>(
  callback: T,
  delay: number
): T {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const debouncedCallback = useCallback(
    ((...args: Parameters<T>) => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(() => {
        callback(...args);
      }, delay);
    }) as T,
    [callback, delay]
  );

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return debouncedCallback;
}

// Helper function to get paper from background worker's IndexedDB
async function getPaperByUrl(url: string): Promise<StoredPaper | null> {
  console.log('[Sidepanel] Requesting paper from background worker:', url);
  const response = await chrome.runtime.sendMessage({
    type: MessageType.GET_PAPER_FROM_DB_BY_URL,
    payload: { url },
  });

  if (response.success) {
    console.log('[Sidepanel] Paper retrieval result:', response.paper ? 'Found' : 'Not found');
    return response.paper;
  } else {
    console.error('[Sidepanel] Failed to get paper:', response.error);
    return null;
  }
}

// Helper function to get all papers from IndexedDB
async function getAllPapers(): Promise<StoredPaper[]> {
  console.log('[Sidepanel] Requesting all papers from background worker');
  const response = await chrome.runtime.sendMessage({
    type: MessageType.GET_ALL_PAPERS_FROM_DB,
    payload: {},
  });

  if (response.success) {
    console.log('[Sidepanel] Retrieved', response.papers.length, 'papers');
    return response.papers || [];
  } else {
    console.error('[Sidepanel] Failed to get all papers:', response.error);
    return [];
  }
}

// Helper function to update Q&A history for a paper
async function updatePaperQAHistory(paperId: string, qaHistory: QuestionAnswer[]): Promise<boolean> {
  console.log('[Sidepanel] Updating Q&A history for paper:', paperId);
  const response = await chrome.runtime.sendMessage({
    type: MessageType.UPDATE_PAPER_QA_HISTORY,
    payload: { paperId, qaHistory },
  });

  if (response.success) {
    console.log('[Sidepanel] Q&A history updated successfully');
    return true;
  } else {
    console.error('[Sidepanel] Failed to update Q&A history:', response.error);
    return false;
  }
}

// Helper function to delete a paper
async function deletePaperFromDB(paperId: string): Promise<boolean> {
  console.log('[Sidepanel] Deleting paper:', paperId);
  const response = await chrome.runtime.sendMessage({
    type: MessageType.DELETE_PAPER_FROM_DB,
    payload: { paperId },
  });

  if (response.success) {
    console.log('[Sidepanel] Paper deleted successfully');
    return true;
  } else {
    console.error('[Sidepanel] Failed to delete paper:', response.error);
    return false;
  }
}

type ViewState = 'loading' | 'empty' | 'content' | 'stored-only';
type TabType = 'summary' | 'explanation' | 'qa' | 'analysis' | 'glossary' | 'original';

interface ExplanationData {
  paper: ResearchPaper;
  explanation: ExplanationResult;
  summary: SummaryResult;
}

export function Sidepanel() {
  const [viewState, setViewState] = useState<ViewState>('loading');
  const [activeTab, setActiveTab] = useState<TabType>('summary');
  const [data, setData] = useState<ExplanationData | null>(null);
  const [copied, setCopied] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [analysis, setAnalysis] = useState<PaperAnalysisResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [glossary, setGlossary] = useState<GlossaryResult | null>(null);
  const [isGeneratingGlossary, setIsGeneratingGlossary] = useState(false);
  const [isCheckingStorage, setIsCheckingStorage] = useState(false);
  const [isExplainingInBackground, setIsExplainingInBackground] = useState(false);

  // Multi-paper carousel state
  const [allPapers, setAllPapers] = useState<StoredPaper[]>([]);
  const [currentPaperIndex, setCurrentPaperIndex] = useState<number>(0);
  const [storedPaper, setStoredPaper] = useState<StoredPaper | null>(null);

  // Q&A state
  const [question, setQuestion] = useState('');
  const [isAsking, setIsAsking] = useState(false);
  const [qaHistory, setQaHistory] = useState<QuestionAnswer[]>([]);

  // Deletion state
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

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

  // Create debounced version of loadExplanation to prevent rapid re-triggers
  const debouncedLoadExplanation = useDebounce(() => {
    loadExplanation();
  }, 300); // 300ms debounce delay

  useEffect(() => {
    loadExplanation();

    // Listen for storage changes
    const storageListener = (changes: any, namespace: string) => {
      if (namespace === 'local') {
        // Handle explanation progress flag
        if (changes.isExplaining) {
          const isExplaining = changes.isExplaining.newValue || false;
          console.log('[Sidepanel] Explanation status changed:', isExplaining);
          setIsExplainingInBackground(isExplaining);
        }

        // Reload on data changes with debouncing
        if (changes.lastExplanation || changes.lastAnalysis || changes.currentPaper) {
          console.log('Storage changed, will reload explanation after debounce...', changes);
          debouncedLoadExplanation();
        }
      }
    };

    // Listen for operation state changes from background
    const messageListener = (message: any) => {
      if (message.type === MessageType.OPERATION_STATE_CHANGED) {
        const state = message.payload?.state;
        if (!state) return;

        console.log('[Sidepanel] Operation state changed:', state);

        // Update banner states
        setIsExplainingInBackground(state.isExplaining);
        setIsAnalyzing(state.isAnalyzing);

        // Removed auto-reload on operation completion - storage listener handles reloads
        // This was causing infinite loop with auto-trigger logic
      }
    };

    chrome.storage.onChanged.addListener(storageListener);
    chrome.runtime.onMessage.addListener(messageListener);

    return () => {
      chrome.storage.onChanged.removeListener(storageListener);
      chrome.runtime.onMessage.removeListener(messageListener);
    };
  }, []);

  /**
   * Check for stored paper with retry logic and exponential backoff
   * Retries up to maxRetries times with increasing delays: 100ms, 200ms, 400ms, 800ms, 1600ms
   */
  async function checkForStoredPaper(paperUrl: string, maxRetries = 5): Promise<StoredPaper | null> {
    for (let i = 0; i < maxRetries; i++) {
      console.log(`[Sidepanel] Checking if paper is stored (attempt ${i + 1}/${maxRetries})...`);

      try {
        const stored = await getPaperByUrl(paperUrl);

        if (stored) {
          console.log(`[Sidepanel] ✓ Paper found in storage!`, {
            id: stored.id,
            title: stored.title,
            chunkCount: stored.chunkCount,
            storedAt: new Date(stored.storedAt).toLocaleString()
          });
          return stored;
        }

        console.log(`[Sidepanel] Paper not found yet (attempt ${i + 1}/${maxRetries})`);
      } catch (error) {
        console.error(`[Sidepanel] Error checking storage (attempt ${i + 1}/${maxRetries}):`, error);
      }

      // Wait before next retry with exponential backoff
      if (i < maxRetries - 1) {
        const delay = 100 * Math.pow(2, i);
        console.log(`[Sidepanel] Waiting ${delay}ms before next attempt...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    console.warn(`[Sidepanel] Paper not found after ${maxRetries} attempts`);
    return null;
  }

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
        isAnalyzing,
        isCheckingStorage,
      },
    };

    // Try to get paper from IndexedDB
    if (result.currentPaper?.url) {
      try {
        const stored = await getPaperByUrl(result.currentPaper.url);
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
      const papers = await getAllPapers();
      setAllPapers(papers);
      console.log('[Sidepanel] Loaded', papers.length, 'papers from IndexedDB');

      // Query current operation state from background
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab?.id) {
          const stateResponse = await chrome.runtime.sendMessage({
            type: MessageType.GET_OPERATION_STATE,
            payload: { tabId: tab.id },
          });

          if (stateResponse.success && stateResponse.state) {
            const state = stateResponse.state;
            console.log('[Sidepanel] Loaded operation state:', state);

            // Update banner states based on current operation
            setIsExplainingInBackground(state.isExplaining);
            setIsAnalyzing(state.isAnalyzing);
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

            // Auto-trigger analysis for stored paper (only if not already analyzing)
            if (!isAnalyzing && (!result.lastAnalysis || result.lastAnalysis.paper?.url !== result.currentPaper.url)) {
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

          // Auto-trigger analysis if paper is stored and no analysis exists yet (only if not already analyzing)
          if (!stored.analysis && !isAnalyzing && (!result.lastAnalysis || result.lastAnalysis.paper?.url !== result.lastExplanation.paper.url)) {
            console.log('[Sidepanel] Paper is stored, triggering automatic analysis...');
            triggerAnalysis(result.lastExplanation.paper.url);
          }

          // Auto-trigger glossary generation if paper is stored and no glossary exists yet
          if (!stored.glossary && !isGeneratingGlossary) {
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
    // Guard: Don't retrigger if already analyzing
    if (isAnalyzing) {
      console.log('[Sidepanel] Analysis already in progress, skipping');
      setOperationQueueMessage('Analysis already in progress for another paper');
      setHasQueuedOperations(true);
      setTimeout(() => {
        setHasQueuedOperations(false);
        setOperationQueueMessage('');
      }, 3000);
      return;
    }

    try {
      setIsAnalyzing(true);
      console.log('Starting paper analysis for:', paperUrl);

      const response = await chrome.runtime.sendMessage({
        type: 'ANALYZE_PAPER',
        payload: { url: paperUrl },
      });

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
      setIsAnalyzing(false);
    }
  }

  async function triggerGlossaryGeneration(paperUrl: string) {
    // Guard: Don't retrigger if already generating
    if (isGeneratingGlossary) {
      console.log('[Sidepanel] Glossary generation already in progress, skipping');
      setOperationQueueMessage('Glossary generation already in progress');
      setHasQueuedOperations(true);
      setTimeout(() => {
        setHasQueuedOperations(false);
        setOperationQueueMessage('');
      }, 3000);
      return;
    }

    try {
      setIsGeneratingGlossary(true);
      console.log('Starting glossary generation for:', paperUrl);

      const response = await chrome.runtime.sendMessage({
        type: MessageType.GENERATE_GLOSSARY,
        payload: { url: paperUrl },
      });

      if (response.success) {
        console.log('✓ Glossary generated successfully');
        setGlossary(response.glossary);

        // Update storedPaper and allPapers to reflect the new glossary
        // This prevents the glossary from being cleared when switchToPaper is called
        if (storedPaper) {
          const updatedPaper = { ...storedPaper, glossary: response.glossary };
          setStoredPaper(updatedPaper);

          // Update the paper in allPapers array
          const updatedAllPapers = [...allPapers];
          updatedAllPapers[currentPaperIndex] = updatedPaper;
          setAllPapers(updatedAllPapers);

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
      setIsGeneratingGlossary(false);
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

      const response = await chrome.runtime.sendMessage({
        type: MessageType.ASK_QUESTION,
        payload: {
          paperUrl: data.paper.url,
          question: question.trim(),
        },
      });

      if (response.success) {
        console.log('✓ Question answered successfully');
        // Add to history
        const newHistory = [response.answer, ...qaHistory];
        setQaHistory(newHistory);
        setQuestion(''); // Clear input

        // Save Q&A history to database
        if (storedPaper) {
          await updatePaperQAHistory(storedPaper.id, newHistory);
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

      const response = await chrome.runtime.sendMessage({
        type: 'EXPLAIN_PAPER',
        payload: { paper: result.currentPaper },
      });

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
    // Use provided array or fall back to state (for backwards compatibility)
    const papers = papersArray || allPapers;

    if (index < 0 || index >= papers.length) return;

    console.log(`[Sidepanel] Switching to paper at index ${index}`);

    // Save current paper's Q&A history before switching
    if (storedPaper && qaHistory.length > 0) {
      await updatePaperQAHistory(storedPaper.id, qaHistory);
    }

    // Switch to new paper
    setCurrentPaperIndex(index);
    const newPaper = papers[index];
    setStoredPaper(newPaper);

    // Load Q&A history for new paper
    setQaHistory(newPaper.qaHistory || []);

    // Try to load explanation and analysis for this paper
    const result = await chrome.storage.local.get(['lastExplanation', 'lastAnalysis']);

    // Prioritize loading from StoredPaper fields, fall back to chrome.storage
    if (newPaper.explanation && newPaper.summary) {
      console.log('[Sidepanel] Loading explanation from StoredPaper');
      setData({
        paper: newPaper,
        explanation: newPaper.explanation,
        summary: newPaper.summary,
      });
      setActiveTab('summary');
      setViewState('content');
    } else if (result.lastExplanation?.paper?.url === newPaper.url) {
      console.log('[Sidepanel] Loading explanation from chrome.storage');
      setData(result.lastExplanation);
      setActiveTab('summary');
      setViewState('content');
    } else {
      // No explanation for this paper, show stored-only view
      console.log('[Sidepanel] No explanation found for this paper');
      setData({
        paper: newPaper,
        explanation: { originalText: '', explanation: '', timestamp: 0 },
        summary: { summary: '', keyPoints: [], timestamp: 0 }
      });
      setActiveTab('analysis');
      setViewState('stored-only');
    }

    // Load analysis from StoredPaper or chrome.storage
    if (newPaper.analysis) {
      console.log('[Sidepanel] Loading analysis from StoredPaper');
      setAnalysis(newPaper.analysis);
    } else if (result.lastAnalysis?.paper?.url === newPaper.url) {
      console.log('[Sidepanel] Loading analysis from chrome.storage');
      setAnalysis(result.lastAnalysis.analysis);
    } else {
      console.log('[Sidepanel] No analysis found, triggering new analysis');
      setAnalysis(null);
      // Trigger analysis for this paper
      triggerAnalysis(newPaper.url);
    }

    // Load glossary from StoredPaper
    if (newPaper.glossary) {
      console.log('[Sidepanel] Loading glossary for paper:', newPaper.title);
      setGlossary(newPaper.glossary);
    } else {
      console.log('[Sidepanel] No glossary found, triggering generation');
      setGlossary(null);
      // Trigger glossary generation for this paper
      triggerGlossaryGeneration(newPaper.url);
    }
  }

  async function handleDeletePaper() {
    if (!storedPaper || !showDeleteConfirm) {
      setShowDeleteConfirm(true);
      return;
    }

    try {
      setIsDeleting(true);
      const success = await deletePaperFromDB(storedPaper.id);

      if (success) {
        console.log('[Sidepanel] Paper deleted successfully');

        // Remove from allPapers array
        const newAllPapers = allPapers.filter((_, idx) => idx !== currentPaperIndex);
        setAllPapers(newAllPapers);

        // Handle switching to another paper
        if (newAllPapers.length === 0) {
          // No papers left
          setStoredPaper(null);
          setViewState('empty');
          setQaHistory([]);
        } else {
          // Switch to previous paper, or first if we deleted the first
          const newIndex = Math.max(0, currentPaperIndex - 1);
          setCurrentPaperIndex(newIndex);
          // Pass newAllPapers directly to avoid race condition with state updates
          await switchToPaper(newIndex, newAllPapers);
        }
      } else {
        alert('Failed to delete paper. Please try again.');
      }
    } catch (error) {
      console.error('[Sidepanel] Error deleting paper:', error);
      alert('Failed to delete paper. Please try again.');
    } finally {
      setIsDeleting(false);
      setShowDeleteConfirm(false);
    }
  }

  function handlePrevPaper() {
    if (currentPaperIndex > 0) {
      switchToPaper(currentPaperIndex - 1);
    }
  }

  function handleNextPaper() {
    if (currentPaperIndex < allPapers.length - 1) {
      switchToPaper(currentPaperIndex + 1);
    }
  }

  async function handleDeleteAllPapers() {
    if (!showDeleteAllConfirm) {
      setShowDeleteAllConfirm(true);
      return;
    }

    try {
      setIsDeletingAll(true);
      console.log('[Sidepanel] Deleting all papers:', allPapers.length);

      // Delete all papers one by one
      let successCount = 0;
      for (const paper of allPapers) {
        const success = await deletePaperFromDB(paper.id);
        if (success) {
          successCount++;
        }
      }

      console.log(`[Sidepanel] Deleted ${successCount}/${allPapers.length} papers`);

      // Clear all state
      setAllPapers([]);
      setCurrentPaperIndex(0);
      setStoredPaper(null);
      setData(null);
      setAnalysis(null);
      setQaHistory([]);
      setViewState('empty');

      // Clear Chrome storage
      await chrome.storage.local.remove(['lastExplanation', 'lastAnalysis', 'currentPaper']);
      console.log('[Sidepanel] Cleared Chrome storage');

      if (successCount < allPapers.length) {
        alert(`Deleted ${successCount} out of ${allPapers.length} papers. Some papers could not be deleted.`);
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
              <p class="text-gray-600 font-medium">Checking paper storage...</p>
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
        <div class="text-center max-w-md">
          <div class="w-16 h-16 mx-auto mb-4 rounded-full bg-gray-200 flex items-center justify-center">
            <FileText size={32} class="text-gray-400" />
          </div>
          <h2 class="text-xl font-semibold text-gray-800 mb-2">No Explanation Yet</h2>
          <p class="text-gray-600">Click "Explain Paper" in the popup to generate an explanation</p>
        </div>
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
              {allPapers.length > 1 && (
              <div class="card mb-4 bg-gray-50">
                <div class="flex items-center justify-between gap-3">
                  {/* Previous Button */}
                  <button
                    onClick={handlePrevPaper}
                    disabled={currentPaperIndex === 0}
                    class="btn btn-secondary px-3 py-2 disabled:opacity-30 hover:cursor-pointer"
                    title="Previous Paper"
                  >
                    <ChevronLeft size={16} />
                  </button>

                  {/* Dropdown Selector */}
                  <select
                    value={currentPaperIndex}
                    onChange={(e) => switchToPaper(parseInt((e.target as HTMLSelectElement).value))}
                    class="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {allPapers.map((paper, idx) => (
                      <option key={paper.id} value={idx}>
                        {paper.title.substring(0, 60)}{paper.title.length > 60 ? '...' : ''}
                      </option>
                    ))}
                  </select>

                  {/* Paper Counter */}
                  <span class="text-sm text-gray-600 whitespace-nowrap">
                    {currentPaperIndex + 1} of {allPapers.length}
                  </span>

                  {/* Next Button */}
                  <button
                    onClick={handleNextPaper}
                    disabled={currentPaperIndex === allPapers.length - 1}
                    class="btn btn-secondary px-3 py-2 disabled:opacity-30 hover:cursor-pointer"
                    title="Next Paper"
                  >
                    <ChevronRight size={16} />
                  </button>

                  {/* Delete Button */}
                  <button
                    onClick={handleDeletePaper}
                    disabled={isDeleting}
                    class="btn btn-secondary px-3 py-2 text-red-600 hover:bg-red-50 hover:cursor-pointer"
                    title="Delete Paper"
                  >
                    {isDeleting ? <Loader size={16} class="animate-spin" /> : <Trash2 size={16} />}
                  </button>
                </div>

                {/* Delete Confirmation */}
                {showDeleteConfirm && (
                  <div class="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg">
                    <p class="text-sm text-red-800 mb-2">
                      Delete "{storedPaper?.title}"? This will remove all data including Q&A history.
                    </p>
                    <div class="flex gap-2">
                      <button
                        onClick={handleDeletePaper}
                        class="btn btn-secondary text-red-600 hover:bg-red-100 px-3 py-1 text-sm"
                      >
                        Confirm Delete
                      </button>
                      <button
                        onClick={() => setShowDeleteConfirm(false)}
                        class="btn btn-secondary px-3 py-1 text-sm"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Storage Checking Banner */}
            {isCheckingStorage && (
              <div class="card mb-4 bg-blue-50 border-blue-200">
                <div class="flex items-center gap-3">
                  <Loader size={20} class="animate-spin text-blue-600" />
                  <div>
                    <p class="text-sm font-medium text-blue-900">🐻 Kuma is checking paper storage...</p>
                    <p class="text-xs text-blue-700">Retrying with exponential backoff (up to 5 attempts)</p>
                  </div>
                </div>
              </div>
            )}

            {/* Explanation In Progress Banner */}
            {isExplainingInBackground && (
              <div class="card mb-4 bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-300">
                <div class="flex items-center gap-3">
                  <Loader size={24} class="animate-spin text-blue-600" />
                  <div class="flex-1">
                    <p class="text-base font-semibold text-blue-900 mb-1">🐻 Kuma is thinking of ways to explain the research paper... (Generating explanation)</p>
                    <p class="text-sm text-blue-700">Generating summary and simplified explanation</p>
                    <p class="text-xs text-blue-600 mt-1">This usually takes 10-20 seconds</p>
                  </div>
                </div>
              </div>
            )}

            {/* Paper Info Card */}
            <div class="card mb-6">
              <div class="flex items-start justify-between gap-4 mb-3">
                <h2 class="text-lg font-semibold text-gray-900 flex-1">{data?.paper.title}</h2>
                <span class="px-2 py-1 text-xs font-medium rounded-full bg-green-100 text-green-700 flex items-center gap-1">
                  <Database size={12} />
                  Stored
                </span>
              </div>

              <p class="text-sm text-gray-600 mb-4">{data?.paper.authors.join(', ')}</p>

              {storedPaper && (
                <div class="mb-4 pb-4 border-b border-gray-200">
                  <div class="flex items-center gap-2 text-sm text-gray-700 mb-2">
                    <Clock size={14} class="text-gray-400" />
                    <span class="font-medium">Stored:</span>
                    <span>{new Date(storedPaper.storedAt).toLocaleString()}</span>
                  </div>
                  <div class="flex items-center gap-2 text-sm text-gray-700">
                    <Database size={14} class="text-gray-400" />
                    <span class="font-medium">Chunks:</span>
                    <span>{storedPaper.chunkCount} content chunks for Q&A</span>
                  </div>
                </div>
              )}

              <a
                href={data?.paper.url}
                target="_blank"
                rel="noopener noreferrer"
                class="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-700 font-medium"
              >
                <ExternalLink size={14} />
                View Original Paper
              </a>
            </div>


            {/* Available Features */}
            <div class="card mb-6">
              <h3 class="text-base font-semibold text-gray-900 mb-3">Available Features</h3>
              <div class="space-y-3">
                <div class="flex items-start gap-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                  <TrendingUp size={20} class="text-blue-600 shrink-0 mt-0.5" />
                  <div>
                    <p class="font-medium text-gray-900 text-sm mb-1">Analysis</p>
                    <p class="text-xs text-gray-600">
                      {isAnalyzing ? 'Analyzing methodology, confounders, implications, and limitations...' : 'View comprehensive paper analysis'}
                    </p>
                    {isAnalyzing && <Loader size={16} class="animate-spin text-blue-600 mt-2" />}
                  </div>
                </div>

                <div class="flex items-start gap-3 p-3 bg-green-50 border border-green-200 rounded-lg">
                  <FileText size={20} class="text-green-600 shrink-0 mt-0.5" />
                  <div>
                    <p class="font-medium text-gray-900 text-sm mb-1">Q&A System</p>
                    <p class="text-xs text-gray-600">
                      Ask Kuma questions and get AI-powered answers from {storedPaper?.chunkCount} content chunks
                    </p>
                  </div>
                </div>

                <div class="flex items-start gap-3 p-3 bg-gray-50 border border-gray-200 rounded-lg">
                  <Loader size={20} class="text-gray-400 shrink-0 mt-0.5" />
                  <div>
                    <p class="font-medium text-gray-900 text-sm mb-1">Full Explanation</p>
                    <p class="text-xs text-gray-600">
                      Click "Explain Paper" in the popup to generate summary and detailed explanation
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Tabs */}
            <div class="flex gap-2 mb-4 border-b border-gray-200">
              <button
                onClick={() => setActiveTab('analysis')}
                class={`px-4 py-2 font-medium transition-colors border-b-2 flex items-center gap-2 ${
                  activeTab === 'analysis'
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-600 hover:text-gray-800'
                }`}
              >
                <span>Analysis</span>
                {isAnalyzing && <Loader size={14} class="animate-spin" />}
              </button>
              <button
                onClick={() => setActiveTab('qa')}
                class={`px-4 py-2 font-medium transition-colors border-b-2 ${
                  activeTab === 'qa'
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-600 hover:text-gray-800'
                }`}
              >
                Q&A
              </button>
              <button
                onClick={() => setActiveTab('glossary')}
                class={`px-4 py-2 font-medium transition-colors border-b-2 flex items-center gap-2 ${
                  activeTab === 'glossary'
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-600 hover:text-gray-800'
                }`}
              >
                <span>Glossary</span>
                {isGeneratingGlossary && <Loader size={14} class="animate-spin" />}
              </button>
              <button
                onClick={() => setActiveTab('original')}
                class={`px-4 py-2 font-medium transition-colors border-b-2 ${
                  activeTab === 'original'
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-600 hover:text-gray-800'
                }`}
              >
                Abstract
              </button>
            </div>

            {/* Tab Content */}
            <div class="space-y-4">
              {/* Analysis Tab Content (reuse existing) */}
              {activeTab === 'analysis' && (
                <>
                  {isAnalyzing && !analysis && (
                    <div class="card">
                      <div class="flex flex-col items-center justify-center gap-4 py-12">
                        <Loader size={32} class="animate-spin text-blue-600" />
                        <div class="text-center">
                          <p class="text-base font-medium text-gray-900 mb-2">Analyzing Paper...</p>
                          <p class="text-sm text-gray-600">
                            Evaluating methodology, identifying confounders, analyzing implications, and assessing limitations.
                          </p>
                          <p class="text-xs text-gray-500 mt-2">This may take 20-30 seconds</p>
                        </div>
                      </div>
                    </div>
                  )}

                  {!isAnalyzing && !analysis && (
                    <div class="card text-center py-8">
                      <TrendingUp size={32} class="mx-auto mb-3 text-gray-400" />
                      <p class="text-sm text-gray-600">Analysis will begin automatically</p>
                      <p class="text-xs text-gray-500 mt-1">Please wait...</p>
                    </div>
                  )}
                </>
              )}

              {/* Q&A Tab Content (reuse existing) */}
              {activeTab === 'qa' && (
                <>
                  <div class="card">
                    <h3 class="text-base font-semibold text-gray-900 mb-3">Ask a Question</h3>
                    <div class="flex gap-2 mb-3">
                      <input
                        type="text"
                        value={question}
                        onInput={(e) => setQuestion((e.target as HTMLInputElement).value)}
                        onKeyPress={(e) => e.key === 'Enter' && !isAsking && handleAskQuestion()}
                        placeholder="Ask anything about this paper..."
                        disabled={isAsking}
                        class="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100"
                      />
                      <button
                        onClick={handleAskQuestion}
                        disabled={!question.trim() || isAsking}
                        class="btn btn-primary px-4 hover:cursor-pointer"
                      >
                        {isAsking ? (
                          <Loader size={16} class="animate-spin" />
                        ) : (
                          'Ask'
                        )}
                      </button>
                    </div>
                    <p class="text-xs text-gray-500">
                      Kuma will search through {storedPaper?.chunkCount} content chunks to find relevant information.
                    </p>
                  </div>

                  {qaHistory.length > 0 ? (
                    <div class="space-y-4">
                      {qaHistory.map((qa, idx) => (
                        <div key={idx} class="card">
                          <div class="mb-3 pb-3 border-b border-gray-200">
                            <p class="text-sm font-semibold text-gray-900 mb-1">Question:</p>
                            <p class="text-sm text-gray-700">{qa.question}</p>
                          </div>
                          <div class="mb-3">
                            <p class="text-sm font-semibold text-gray-900 mb-1">Answer:</p>
                            <MarkdownRenderer content={qa.answer} className="text-sm" />
                          </div>
                          {qa.sources.length > 0 && (
                            <div class="pt-3 border-t border-gray-200">
                              <p class="text-xs font-medium text-gray-600 mb-1">Sources:</p>
                              <div class="flex flex-wrap gap-1">
                                {qa.sources.map((source, sIdx) => (
                                  <span key={sIdx} class="px-2 py-0.5 text-xs rounded bg-blue-100 text-blue-700">
                                    {source}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                          <div class="mt-2 text-xs text-gray-500">
                            {new Date(qa.timestamp).toLocaleString()}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div class="card text-center py-8">
                      <p class="text-sm text-gray-600">No questions asked yet.</p>
                      <p class="text-xs text-gray-500 mt-1">Ask a question above to get started!</p>
                    </div>
                  )}
                </>
              )}

              {/* Abstract Tab */}
              {activeTab === 'glossary' && (
                <div class="card">
                  {glossary ? (
                    <GlossaryList terms={glossary.terms} />
                  ) : (
                    <div class="text-center py-8">
                      <BookOpen size={48} class="text-gray-300 mx-auto mb-4" />
                      <p class="text-gray-500">No glossary available for this stored paper</p>
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'original' && (
                <div class="card">
                  <h3 class="text-base font-semibold text-gray-900 mb-3">Original Abstract</h3>
                  <div class="text-gray-700 leading-relaxed">
                    {data?.paper.abstract}
                  </div>
                </div>
              )}
            </div>

            {/* Manage Papers Section */}
            {allPapers.length > 0 && (
              <div class="card mt-6">
                <button
                  onClick={() => setShowManageSection(!showManageSection)}
                  class="w-full flex items-center justify-between text-left hover:cursor-pointer"
                >
                  <div class="flex items-center gap-2">
                    <Settings size={18} class="text-gray-600" />
                    <h3 class="text-base font-semibold text-gray-900 hover:cursor-pointer">Manage Papers</h3>
                  </div>
                  {showManageSection ? <ChevronUp size={18} class="text-gray-600" /> : <ChevronDown size={18} class="text-gray-600" />}
                </button>

                {showManageSection && (
                  <div class="mt-4 pt-4 border-t border-gray-200">
                    <p class="text-sm text-gray-600 mb-3">
                      {allPapers.length} paper{allPapers.length !== 1 ? 's' : ''} stored in your library
                    </p>

                    <div class="flex items-center gap-3">
                      <button
                        onClick={handleDeleteAllPapers}
                        disabled={isDeletingAll}
                        class="btn btn-secondary px-4 py-2 text-red-600 hover:bg-red-50 hover:cursor-pointer flex items-center gap-2"
                        title="Delete all papers and their data"
                      >
                        {isDeletingAll ? (
                          <>
                            <Loader size={16} class="animate-spin" />
                            <span>Deleting all...</span>
                          </>
                        ) : (
                          <>
                            <Trash2 size={16} />
                            <span>Delete All Papers</span>
                          </>
                        )}
                      </button>
                    </div>

                    {/* Delete All Confirmation */}
                    {showDeleteAllConfirm && (
                      <div class="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg">
                        <p class="text-sm font-semibold text-red-900 mb-2">
                          Delete all {allPapers.length} papers?
                        </p>
                        <p class="text-xs text-red-800 mb-3">
                          This will permanently delete all papers, chunks, and Q&A history. This action cannot be undone.
                        </p>
                        <div class="flex gap-2">
                          <button
                            onClick={handleDeleteAllPapers}
                            disabled={isDeletingAll}
                            class="btn btn-secondary text-red-600 hover:bg-red-100 px-4 py-2 text-sm hover:cursor-pointer"
                          >
                            {isDeletingAll ? 'Deleting...' : 'Delete All'}
                          </button>
                          <button
                            onClick={() => setShowDeleteAllConfirm(false)}
                            disabled={isDeletingAll}
                            class="btn btn-secondary px-4 py-2 text-sm"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
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
          {showDebug && debugInfo && (
            <div class="card mb-6 bg-gray-900 text-gray-100 font-mono text-xs">
              <div class="flex items-center justify-between mb-3">
                <h3 class="text-sm font-bold text-yellow-400">🔍 Debug Information</h3>
                <div class="flex gap-2">
                  <button
                    onClick={collectDebugInfo}
                    class="text-xs px-2 py-1 bg-yellow-500 text-gray-900 rounded hover:bg-yellow-400"
                  >
                    Refresh
                  </button>
                  <button
                    onClick={handleClearAllStorage}
                    class="text-xs px-2 py-1 bg-red-500 text-white rounded hover:bg-red-600"
                    title="Clear all Chrome storage (useful for removing ghost papers)"
                  >
                    Clear All Storage
                  </button>
                </div>
              </div>

              <div class="space-y-3">
                <div>
                  <p class="text-blue-400 font-semibold mb-1">Chrome Storage:</p>
                  <pre class="text-xs bg-gray-800 p-2 rounded overflow-x-auto">
                    {JSON.stringify(debugInfo.chromeStorage, null, 2)}
                  </pre>
                </div>

                <div>
                  <p class="text-green-400 font-semibold mb-1">Sidepanel State:</p>
                  <pre class="text-xs bg-gray-800 p-2 rounded overflow-x-auto">
                    {JSON.stringify(debugInfo.sidepanelState, null, 2)}
                  </pre>
                </div>

                {debugInfo.indexedDB && (
                  <div>
                    <p class="text-purple-400 font-semibold mb-1">IndexedDB Query:</p>
                    <pre class="text-xs bg-gray-800 p-2 rounded overflow-x-auto">
                      {JSON.stringify(debugInfo.indexedDB, null, 2)}
                    </pre>
                  </div>
                )}

                <div class="pt-2 border-t border-gray-700">
                  <p class="text-red-400 font-semibold mb-1">Diagnosis:</p>
                  {!debugInfo.chromeStorage.hasCurrentPaper && (
                    <p class="text-red-300">❌ No currentPaper in chrome.storage</p>
                  )}
                  {debugInfo.chromeStorage.hasCurrentPaper && !debugInfo.indexedDB?.found && (
                    <p class="text-red-300">❌ Paper URL in storage but NOT found in IndexedDB</p>
                  )}
                  {debugInfo.chromeStorage.hasCurrentPaper && debugInfo.indexedDB?.found && !debugInfo.sidepanelState.hasStoredPaper && (
                    <p class="text-red-300">❌ Paper in IndexedDB but storedPaper state is null</p>
                  )}
                  {debugInfo.sidepanelState.hasStoredPaper && (
                    <p class="text-green-300">✅ Paper is properly loaded</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Paper Navigation Bar */}
          {allPapers.length > 1 && (
            <div class="card mb-4 bg-gray-50">
              <div class="flex items-center justify-between gap-3">
                {/* Previous Button */}
                <button
                  onClick={handlePrevPaper}
                  disabled={currentPaperIndex === 0}
                  class="btn btn-secondary px-3 py-2 disabled:opacity-30 hover:cursor-pointer"
                  title="Previous Paper"
                >
                  <ChevronLeft size={16} />
                </button>

                {/* Dropdown Selector */}
                <select
                  value={currentPaperIndex}
                  onChange={(e) => switchToPaper(parseInt((e.target as HTMLSelectElement).value))}
                  class="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {allPapers.map((paper, idx) => (
                    <option key={paper.id} value={idx}>
                      {paper.title.substring(0, 60)}{paper.title.length > 60 ? '...' : ''}
                    </option>
                  ))}
                </select>

                {/* Paper Counter */}
                <span class="text-sm text-gray-600 whitespace-nowrap">
                  {currentPaperIndex + 1} of {allPapers.length}
                </span>

                {/* Next Button */}
                <button
                  onClick={handleNextPaper}
                  disabled={currentPaperIndex === allPapers.length - 1}
                  class="btn btn-secondary px-3 py-2 disabled:opacity-30 hover:cursor-pointer"
                  title="Next Paper"
                >
                  <ChevronRight size={16} />
                </button>

                {/* Delete Button */}
                <button
                  onClick={handleDeletePaper}
                  disabled={isDeleting}
                  class="btn btn-secondary px-3 py-2 text-red-600 hover:bg-red-50 hover:cursor-pointer"
                  title="Delete Paper"
                >
                  {isDeleting ? <Loader size={16} class="animate-spin" /> : <Trash2 size={16} />}
                </button>
              </div>

              {/* Delete Confirmation */}
              {showDeleteConfirm && (
                <div class="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg">
                  <p class="text-sm text-red-800 mb-2">
                    Delete "{storedPaper?.title}"? This will remove all data including Q&A history.
                  </p>
                  <div class="flex gap-2">
                    <button
                      onClick={handleDeletePaper}
                      class="btn btn-secondary text-red-600 hover:bg-red-100 px-3 py-1 text-sm hover:cursor-pointer"
                    >
                      Confirm Delete
                    </button>
                    <button
                      onClick={() => setShowDeleteConfirm(false)}
                      class="btn btn-secondary px-3 py-1 text-sm"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Manage Papers Section */}
          {allPapers.length > 0 && (
            <div class="card mt-1 mb-6">
              <button
                onClick={() => setShowManageSection(!showManageSection)}
                class="w-full flex items-center justify-between text-left hover:cursor-pointer"
              >
                <div class="flex items-center gap-2">
                  <Settings size={18} class="text-gray-600" />
                  <h3 class="text-base font-semibold text-gray-900 hover:cursor-pointer">Manage Papers</h3>
                </div>
                {showManageSection ? <ChevronUp size={18} class="text-gray-600" /> : <ChevronDown size={18} class="text-gray-600" />}
              </button>

              {showManageSection && (
                <div class="mt-4 pt-4 border-t border-gray-200">
                  <p class="text-sm text-gray-600 mb-3">
                    {allPapers.length} paper{allPapers.length !== 1 ? 's' : ''} stored in your library
                  </p>

                  <div class="flex items-center gap-3">
                    <button
                      onClick={handleDeleteAllPapers}
                      disabled={isDeletingAll}
                      class="btn btn-secondary px-4 py-2 text-red-600 hover:bg-red-50 hover:cursor-pointer flex items-center gap-2"
                      title="Delete all papers and their data"
                    >
                      {isDeletingAll ? (
                        <>
                          <Loader size={16} class="animate-spin" />
                          <span>Deleting all...</span>
                        </>
                      ) : (
                        <>
                          <Trash2 size={16} />
                          <span>Delete All Papers</span>
                        </>
                      )}
                    </button>
                  </div>

                  {/* Delete All Confirmation */}
                  {showDeleteAllConfirm && (
                    <div class="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg">
                      <p class="text-sm font-semibold text-red-900 mb-2">
                        Delete all {allPapers.length} papers?
                      </p>
                      <p class="text-xs text-red-800 mb-3">
                        This will permanently delete all papers, chunks, and Q&A history. This action cannot be undone.
                      </p>
                      <div class="flex gap-2">
                        <button
                          onClick={handleDeleteAllPapers}
                          disabled={isDeletingAll}
                          class="btn btn-secondary text-red-600 hover:bg-red-100 px-4 py-2 text-sm hover:cursor-pointer"
                        >
                          {isDeletingAll ? 'Deleting...' : 'Delete All'}
                        </button>
                        <button
                          onClick={() => setShowDeleteAllConfirm(false)}
                          disabled={isDeletingAll}
                          class="btn btn-secondary px-4 py-2 text-sm"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Operation Queue Banner */}
          {hasQueuedOperations && operationQueueMessage && (
            <div class="card mb-4 bg-yellow-50 border-yellow-300">
              <div class="flex items-center gap-3">
                <AlertCircle size={20} class="text-yellow-600" />
                <div class="flex-1">
                  <p class="text-sm font-medium text-yellow-900">{operationQueueMessage}</p>
                </div>
              </div>
            </div>
          )}

          {/* Explanation In Progress Banner */}
          {isExplainingInBackground && (
            <div class="card mb-4 bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-300">
              <div class="flex items-center gap-3">
                <Loader size={24} class="animate-spin text-blue-600" />
                <div class="flex-1">
                  <p class="text-base font-semibold text-blue-900 mb-1">🐻 Kuma is explaining the paper...</p>
                  <p class="text-sm text-blue-700">Generating summary and simplified explanation</p>
                  <p class="text-xs text-blue-600 mt-1">This usually takes 10-20 seconds</p>
                </div>
              </div>
            </div>
          )}

          {/* Paper Info - Enhanced Title Card */}
          <div class="card mb-6">
            {/* Title and Badges */}
            <div class="flex items-start justify-between gap-4 mb-3">
              <h2 class="text-lg font-semibold text-gray-900 flex-1">{data?.paper.title}</h2>
              <div class="flex gap-2 shrink-0">
                <span class="px-2 py-1 text-xs font-medium rounded-full bg-gray-100 text-gray-700 capitalize">
                  {data?.paper.source.replace('-', ' ')}
                </span>
                {storedPaper && (
                  <span class="px-2 py-1 text-xs font-medium rounded-full bg-green-100 text-green-700 flex items-center gap-1">
                    <Database size={12} />
                    Stored
                  </span>
                )}
              </div>
            </div>

            {/* Authors */}
            <p class="text-sm text-gray-600 mb-4">{data?.paper.authors.join(', ')}</p>

            {/* Metadata Grid */}
            {(data?.paper.metadata || storedPaper) && (
              <div class="grid grid-cols-1 gap-2 mb-4 pb-4 border-b border-gray-200">
                {/* Storage Info */}
                {storedPaper && (
                  <>
                    <div class="flex items-center gap-2 text-sm text-gray-700">
                      <Clock size={14} class="text-gray-400" />
                      <span class="font-medium">Stored:</span>
                      <span>{new Date(storedPaper.storedAt).toLocaleString()}</span>
                    </div>
                    <div class="flex items-center gap-2 text-sm text-gray-700">
                      <Database size={14} class="text-gray-400" />
                      <span class="font-medium">Chunks:</span>
                      <span>{storedPaper.chunkCount} content chunks for Q&A</span>
                    </div>
                  </>
                )}

                {data?.paper.metadata && (
                  <>
                    {/* Publication Date */}
                    {data.paper.metadata.publishDate && (
                      <div class="flex items-center gap-2 text-sm text-gray-700">
                        <Calendar size={14} class="text-gray-400" />
                        <span class="font-medium">Published:</span>
                        <span>{new Date(data.paper.metadata.publishDate).toLocaleDateString()}</span>
                      </div>
                    )}

                    {/* Journal/Venue */}
                    {(data.paper.metadata.journal || data.paper.metadata.venue) && (
                      <div class="flex items-center gap-2 text-sm text-gray-700">
                        <BookOpen size={14} class="text-gray-400" />
                        <span class="font-medium">Published in:</span>
                        <span>{data.paper.metadata.journal || data.paper.metadata.venue}</span>
                      </div>
                    )}

                    {/* DOI */}
                    {data.paper.metadata.doi && (
                      <div class="flex items-center gap-2 text-sm text-gray-700">
                        <Hash size={14} class="text-gray-400" />
                        <span class="font-medium">DOI:</span>
                        <a
                          href={`https://doi.org/${data.paper.metadata.doi}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          class="text-gray-600 hover:text-gray-700 hover:underline"
                        >
                          {data.paper.metadata.doi}
                        </a>
                      </div>
                    )}

                    {/* arXiv ID */}
                    {data.paper.metadata.arxivId && (
                      <div class="flex items-center gap-2 text-sm text-gray-700">
                        <Hash size={14} class="text-gray-400" />
                        <span class="font-medium">arXiv:</span>
                        <a
                          href={`https://arxiv.org/abs/${data.paper.metadata.arxivId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          class="text-gray-600 hover:text-gray-700 hover:underline"
                        >
                          {data.paper.metadata.arxivId}
                        </a>
                      </div>
                    )}

                    {/* PubMed IDs */}
                    {data.paper.metadata.pmid && (
                      <div class="flex items-center gap-2 text-sm text-gray-700">
                        <Hash size={14} class="text-gray-400" />
                        <span class="font-medium">PMID:</span>
                        <a
                          href={`https://pubmed.ncbi.nlm.nih.gov/${data.paper.metadata.pmid}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          class="text-gray-600 hover:text-gray-700 hover:underline"
                        >
                          {data.paper.metadata.pmid}
                        </a>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Action Links */}
            <div class="flex gap-3">
              <a
                href={data?.paper.url}
                target="_blank"
                rel="noopener noreferrer"
                class="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-700 font-medium"
              >
                <ExternalLink size={14} />
                View Original
              </a>

              {data?.paper.metadata?.pdfUrl && (
                <a
                  href={data.paper.metadata.pdfUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-700 font-medium"
                >
                  <Download size={14} />
                  Download PDF
                </a>
              )}
            </div>
          </div>

          {/* Tabs */}
          <div class="flex gap-2 mb-4 border-b border-gray-200">
            <button
              onClick={() => setActiveTab('summary')}
              class={`px-4 py-2 font-medium transition-colors border-b-2 ${
                activeTab === 'summary'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-600 hover:text-gray-800'
              }`}
            >
              Summary
            </button>
            <button
              onClick={() => setActiveTab('explanation')}
              class={`px-4 py-2 font-medium transition-colors border-b-2 ${
                activeTab === 'explanation'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-600 hover:text-gray-800'
              }`}
            >
              Explanation
            </button>
            <button
              onClick={() => setActiveTab('analysis')}
              class={`px-4 py-2 font-medium transition-colors border-b-2 flex items-center gap-2 ${
                activeTab === 'analysis'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-600 hover:text-gray-800'
              } ${!analysis && !isAnalyzing ? 'opacity-50' : ''}`}
              title={isAnalyzing ? 'Analysis in progress...' : !analysis ? 'Analysis will start automatically when paper is stored' : ''}
            >
              <span>Analysis</span>
              {isAnalyzing && <Loader size={14} class="animate-spin" />}
            </button>
            <button
              onClick={() => setActiveTab('qa')}
              class={`px-4 py-2 font-medium transition-colors border-b-2 ${
                activeTab === 'qa'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-600 hover:text-gray-800'
              } ${!storedPaper ? 'opacity-50' : ''}`}
              title={!storedPaper ? 'Paper must be stored to ask questions' : 'Ask questions about this paper'}
            >
              Q&A
            </button>
            <button
              onClick={() => setActiveTab('glossary')}
              class={`px-4 py-2 font-medium transition-colors border-b-2 flex items-center gap-2 ${
                activeTab === 'glossary'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-600 hover:text-gray-800'
              } ${!glossary && !isGeneratingGlossary ? 'opacity-50' : ''}`}
              title={isGeneratingGlossary ? 'Glossary being generated...' : !glossary ? 'Glossary will be generated when paper is stored' : ''}
            >
              <span>Glossary</span>
              {isGeneratingGlossary && <Loader size={14} class="animate-spin" />}
            </button>
            <button
              onClick={() => setActiveTab('original')}
              class={`px-4 py-2 font-medium transition-colors border-b-2 ${
                activeTab === 'original'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-600 hover:text-gray-800'
              }`}
            >
              Original
            </button>
          </div>

          {/* Tab Content */}
          <div class="space-y-4">
            {activeTab === 'summary' && (
              <>
                <div class="card">
                  <h3 class="text-base font-semibold text-gray-900 mb-3">Quick Summary</h3>
                  <MarkdownRenderer content={data?.summary.summary || ''} />
                </div>

                <div class="card">
                  <h3 class="text-base font-semibold text-gray-900 mb-3">Key Points</h3>
                  <ul class="space-y-2">
                    {data?.summary.keyPoints.map((point, index) => (
                      <li key={index} class="flex gap-2 text-gray-700">
                        <span class="text-blue-600 font-bold">•</span>
                        <MarkdownRenderer content={point} />
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            )}

            {activeTab === 'explanation' && (
              <div class="card">
                <h3 class="text-base font-semibold text-gray-900 mb-3">Simplified Explanation</h3>
                <MarkdownRenderer content={data?.explanation.explanation || ''} />
              </div>
            )}

            {activeTab === 'analysis' && (
              <>
                {/* Loading State */}
                {isAnalyzing && !analysis && (
                  <div class="card">
                    <div class="flex flex-col items-center justify-center gap-4 py-12">
                      <Loader size={32} class="animate-spin text-blue-600" />
                      <div class="text-center">
                        <p class="text-base font-medium text-gray-900 mb-2">Analyzing Paper...</p>
                        <p class="text-sm text-gray-600">
                          Evaluating methodology, identifying confounders, analyzing implications, and assessing limitations.
                        </p>
                        <p class="text-xs text-gray-500 mt-2">This may take 20-30 seconds</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Analysis Results */}
                {analysis && (
                  <>
                    {/* Methodology Analysis */}
                    <div class="card">
                  <div class="flex items-center gap-2 mb-3">
                    <FileText size={18} class="text-blue-600" />
                    <h3 class="text-base font-semibold text-gray-900">Methodology</h3>
                  </div>

                  <div class="space-y-3">
                    <div>
                      <p class="text-sm font-medium text-gray-700 mb-1">
                        Study Type
                        <Tooltip text="The type of study (e.g. randomized controlled trial, cohort study, case-control study, etc.)" />
                      </p>
                      <p class="text-sm text-gray-600">{analysis.methodology.studyType}</p>
                    </div>

                    <div>
                      <p class="text-sm font-medium text-gray-700 mb-1">
                        Study Design
                        <Tooltip text="The overall framework and approach used to conduct the research study" />
                      </p>
                      <p class="text-sm text-gray-600">{analysis.methodology.studyDesign}</p>
                    </div>

                    <div>
                      <p class="text-sm font-medium text-gray-700 mb-1">
                        Data Collection
                        <Tooltip text="Methods and procedures used to gather information and measurements for the study" />
                      </p>
                      <p class="text-sm text-gray-600">{analysis.methodology.dataCollection}</p>
                    </div>

                    <div>
                      <p class="text-sm font-medium text-gray-700 mb-1">
                        Sample Size
                        <Tooltip text="The number of participants or observations included in the study" />
                      </p>
                      <p class="text-sm text-gray-600">{analysis.methodology.sampleSize}</p>
                    </div>

                    <div>
                      <p class="text-sm font-medium text-gray-700 mb-1">
                        Statistical Methods
                        <Tooltip text="Analytical techniques and tests used to evaluate and interpret the data" />
                      </p>
                      <p class="text-sm text-gray-600">{analysis.methodology.statisticalMethods}</p>
                    </div>

                    <div>
                      <p class="text-sm font-medium text-green-700 mb-1 flex items-center gap-1">
                        <CheckCircle size={14} />
                        Strengths
                        <Tooltip text="Notable positive aspects and robust elements of the research methodology" />
                      </p>
                      <ul class="space-y-1">
                        {analysis.methodology.strengths.map((strength, idx) => (
                          <li key={idx} class="flex gap-2 text-sm text-gray-600">
                            <span class="text-green-600">•</span>
                            <span>{strength}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div>
                      <p class="text-sm font-medium text-yellow-700 mb-1 flex items-center gap-1">
                        <AlertCircle size={14} />
                        Concerns
                        <Tooltip text="Potential weaknesses or issues identified in the research methodology" />
                      </p>
                      <ul class="space-y-1">
                        {analysis.methodology.concerns.map((concern, idx) => (
                          <li key={idx} class="flex gap-2 text-sm text-gray-600">
                            <span class="text-yellow-600">•</span>
                            <span>{concern}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>

                {/* Confounders & Biases */}
                <div class="card">
                  <div class="flex items-center gap-2 mb-3">
                    <AlertTriangle size={18} class="text-orange-600" />
                    <h3 class="text-lg font-semibold text-gray-900">Confounders & Biases</h3>
                  </div>

                  <div class="space-y-3">
                    <div>
                      <p class="text-base font-medium text-gray-700 mb-1">
                        Identified Confounders
                        <Tooltip text="Variables that may influence both the independent and dependent variables, potentially distorting results" />
                      </p>
                      <ul class="space-y-3">
                        {analysis.confounders.identified.map((item, idx) => (
                          <li key={idx} class="flex flex-col gap-2 text-sm text-gray-600">
                            <span class="font-medium text-gray-600">{item.name}</span>
                            <span class="text-gray-500 text-xs">{item.explanation}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div>
                      <p class="text-base font-medium text-gray-700 mb-1">
                        Potential Biases
                        <Tooltip text="Systematic errors or tendencies that could skew the study results in a particular direction" />
                      </p>
                      <ul class="space-y-3">
                        {analysis.confounders.biases.map((bias, idx) => (
                          <li key={idx} class="flex flex-col gap-2 text-sm text-gray-600">
                            <span class="font-medium text-gray-600">{bias.name}</span>
                            <span class="text-gray-500 text-xs">{bias.explanation}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div>
                      <p class="text-base font-medium text-gray-700 mb-1">
                        Control Measures
                        <Tooltip text="Strategies implemented by researchers to minimize or account for confounders and biases" />
                      </p>
                      <ul class="space-y-3">
                        {analysis.confounders.controlMeasures.map((controlMeasure, idx) => (
                          <li key={idx} class="flex flex-col gap-2 text-sm text-gray-600">
                            <span class="font-medium text-gray-600">{controlMeasure.name}</span>
                            <span class="text-gray-500 text-xs">{controlMeasure.explanation}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>

                {/* Implications */}
                <div class="card">
                  <div class="flex items-center gap-2 mb-3">
                    <TrendingUp size={18} class="text-blue-600" />
                    <h3 class="text-base font-semibold text-gray-900">Implications</h3>
                  </div>

                  <div class="space-y-3">
                    <div>
                      <p class="text-sm font-medium text-gray-700 mb-1">
                        Significance
                        <Tooltip text="The importance and meaning of the research findings within the field" />
                      </p>
                      <p class="text-sm text-gray-600">{analysis.implications.significance}</p>
                    </div>

                    <div>
                      <p class="text-sm font-medium text-gray-700 mb-1">
                        Possible Real-World Applications
                        <Tooltip text="What the research findings may be applied to in the real world" />
                      </p>
                      <ul class="space-y-3">
                        {analysis.implications.realWorldApplications.map((app, idx) => (
                          <li key={idx} class="flex gap-2 text-sm text-gray-600">
                            <span class="text-blue-600">•</span>
                            <span>{app}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div>
                      <p class="text-sm font-medium text-gray-700 mb-1">
                        What could be Investigated Further
                        <Tooltip text="Suggested areas for further investigation to build upon or address gaps in this research" />
                      </p>
                      <ul class="space-y-3">
                        {analysis.implications.futureResearch.map((research, idx) => (
                          <li key={idx} class="flex gap-2 text-sm text-gray-600">
                            <span class="text-purple-600">•</span>
                            <span>{research}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>

                {/* Limitations */}
                <div class="card">
                  <div class="flex items-center gap-2 mb-3">
                    <AlertCircle size={18} class="text-red-600" />
                    <h3 class="text-base font-semibold text-gray-900">Limitations</h3>
                  </div>

                  <div class="space-y-3">
                    <div>
                      <p class="text-sm font-medium text-gray-700 mb-1">
                        Study Limitations
                        <Tooltip text="Constraints and boundaries that may affect the validity or scope of the research findings" />
                      </p>
                      <ul class="space-y-3">
                        {analysis.limitations.studyLimitations.map((limitation, idx) => (
                          <li key={idx} class="flex gap-2 text-sm text-gray-600">
                            <span class="text-red-600">•</span>
                            <MarkdownRenderer content={limitation} />
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div>
                      <p class="text-sm font-medium text-gray-700 mb-1">
                        Generalizability
                        <Tooltip text="The extent to which findings can be applied to other populations, settings, or contexts" />
                      </p>
                      <p class="text-sm text-gray-600">{analysis.limitations.generalizability}</p>
                    </div>
                  </div>
                </div>
              </>
            )}
              </>
            )}

            {activeTab === 'qa' && (
              <>
                {/* Q&A Input */}
                <div class="card">
                  <h3 class="text-base font-semibold text-gray-900 mb-3">Ask a Question</h3>

                  {!storedPaper ? (
                    <div class="space-y-3">
                      <div class="p-4 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-800">
                        <p class="font-semibold mb-2">⚠️ Paper Storage Issue</p>
                        <p class="mb-3">Paper must be stored in IndexedDB before asking questions, but the paper wasn't found in storage.</p>
                        <p class="text-xs mb-3">This usually happens when:</p>
                        <ul class="text-xs space-y-1 ml-4 list-disc">
                          <li>Storage is still in progress (wait a few seconds)</li>
                          <li>IndexedDB permissions are blocked</li>
                          <li>Storage failed silently</li>
                        </ul>
                      </div>
                      <button
                        onClick={async () => {
                          console.log('[Sidepanel] Manual storage check triggered');
                          await collectDebugInfo();
                          await loadExplanation();
                        }}
                        disabled={isCheckingStorage}
                        class="btn btn-primary w-full"
                      >
                        {isCheckingStorage ? (
                          <>
                            <Loader size={16} class="animate-spin" />
                            Checking storage...
                          </>
                        ) : (
                          <>
                            <RefreshCw size={16} />
                            Retry Storage Check
                          </>
                        )}
                      </button>
                      <p class="text-xs text-gray-500 text-center">
                        Click "Show Debug" in the header to see detailed diagnostic information
                      </p>
                    </div>
                  ) : (
                    <>
                      <div class="flex gap-2 mb-3">
                        <input
                          type="text"
                          value={question}
                          onInput={(e) => setQuestion((e.target as HTMLInputElement).value)}
                          onKeyPress={(e) => e.key === 'Enter' && !isAsking && handleAskQuestion()}
                          placeholder="Ask anything about this paper..."
                          disabled={isAsking}
                          class="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-bear-500 focus:border-transparent disabled:bg-gray-100"
                        />
                        <button
                          onClick={handleAskQuestion}
                          disabled={!question.trim() || isAsking}
                          class="btn btn-primary px-4 hover:cursor-pointer"
                        >
                          {isAsking ? (
                            <Loader size={16} class="animate-spin" />
                          ) : (
                            'Ask'
                          )}
                        </button>
                      </div>

                      <p class="text-xs text-gray-500">
                        Kuma will search through {storedPaper.chunkCount} content chunks to find relevant information.
                      </p>
                    </>
                  )}
                </div>

                {/* Q&A History */}
                {qaHistory.length > 0 ? (
                  <div class="space-y-4">
                    {qaHistory.map((qa, idx) => (
                      <div key={idx} class="card">
                        {/* Question */}
                        <div class="mb-3 pb-3 border-b border-gray-200">
                          <p class="text-sm font-semibold text-gray-900 mb-1">Question:</p>
                          <p class="text-sm text-gray-700">{qa.question}</p>
                        </div>

                        {/* Answer */}
                        <div class="mb-3">
                          <p class="text-sm font-semibold text-gray-900 mb-1">Answer:</p>
                          <MarkdownRenderer content={qa.answer} className="text-sm" />
                        </div>

                        {/* Sources */}
                        {qa.sources.length > 0 && (
                          <div class="pt-3 border-t border-gray-200">
                            <p class="text-xs font-medium text-gray-600 mb-1">Sources:</p>
                            <div class="flex flex-wrap gap-1">
                              {qa.sources.map((source, sIdx) => (
                                <span
                                  key={sIdx}
                                  class="px-2 py-0.5 text-xs rounded bg-gray-100 text-gray-700"
                                >
                                  {source}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Timestamp */}
                        <div class="mt-2 text-xs text-gray-500">
                          {new Date(qa.timestamp).toLocaleString()}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : storedPaper ? (
                  <div class="card text-center py-8">
                    <p class="text-sm text-gray-600">No questions asked yet.</p>
                    <p class="text-xs text-gray-500 mt-1">Ask a question above to get started!</p>
                  </div>
                ) : null}
              </>
            )}

            {/* Glossary Tab */}
            {activeTab === 'glossary' && (
              <div class="card">
                {glossary ? (
                  <GlossaryList terms={glossary.terms} />
                ) : isGeneratingGlossary ? (
                  <div class="text-center py-8">
                    <Loader size={32} class="text-blue-600 mx-auto mb-3 animate-spin" />
                    <p class="text-gray-600">Generating glossary of terms...</p>
                  </div>
                ) : (
                  <div class="text-center py-8">
                    <BookOpen size={48} class="text-gray-300 mx-auto mb-4" />
                    <p class="text-gray-500 mb-2">No glossary available yet</p>
                    <p class="text-sm text-gray-400">
                      The glossary will be generated when the paper is stored
                    </p>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'original' && (
              <div class="card">
                <h3 class="text-base font-semibold text-gray-900 mb-3">Original Abstract</h3>
                <div class="text-gray-700 leading-relaxed">
                  {data?.paper.abstract}
                </div>
              </div>
            )}
          </div>

          {/* Actions */}
          <div class="flex gap-3 mt-6">
            <button onClick={handleCopy} class="btn btn-secondary flex-1">
              <Copy size={16} />
              {copied ? 'Copied!' : 'Copy Explanation'}
            </button>

            <button
              onClick={handleRegenerate}
              disabled={isRegenerating}
              class="btn btn-secondary flex-1"
            >
              <RefreshCw size={16} class={isRegenerating ? 'animate-spin' : ''} />
              {isRegenerating ? 'Regenerating...' : 'Regenerate'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
