import { useState } from 'preact/hooks';
import {
  Copy,
  RefreshCw,
} from 'lucide-preact';
import { ResearchPaper, ExplanationResult, SummaryResult, StoredPaper, PaperAnalysisResult, QuestionAnswer, GlossaryResult } from '../../../shared/types/index.ts';
import { QASection } from '../QASection.tsx';
import { AnalysisSection } from '../AnalysisSection.tsx';
import { GlossarySection } from '../GlossarySection.tsx';
import { ExplanationSection } from '../ExplanationSection.tsx';
import { SummarySection } from '../SummarySection.tsx';
import { OriginalPaperTab } from '../OriginalPaperTab.tsx';
import { TabButton } from '../ui/TabButton.tsx';
import { TabDropdown } from '../ui/TabDropdown.tsx';
import { LoadingButton } from '../ui/LoadingButton.tsx';
import { PaperInfoCard } from '../PaperInfoCard.tsx';
import * as ChromeService from '../../../services/chromeService.ts';
import { logger } from '../../../shared/utils/logger.ts';

type TabType = 'summary' | 'explanation' | 'qa' | 'analysis' | 'glossary' | 'original';

interface ExplanationData {
  paper: ResearchPaper;
  explanation: ExplanationResult | null;
  summary: SummaryResult | null;
}

interface PaperDetailPanelProps {
  // Paper data
  data: ExplanationData | null;
  storedPaper: StoredPaper | null;

  // Content state (from parent)
  analysis: PaperAnalysisResult | null;
  glossary: GlossaryResult | null;
  glossaryProgress: { stage: string; current?: number; total?: number } | null;
  analysisProgress: { stage: string; current?: number; total?: number } | null;
  qaHistory: QuestionAnswer[];
  question: string;
  setQuestion: (q: string) => void;
  draftQuestions: Map<string, string>;
  setDraftQuestions: (drafts: Map<string, string>) => void;

  // Operation state from parent
  operationState: {
    isGeneratingSummary: (url: string) => boolean;
    isExplaining: (url: string) => boolean;
    isAnalyzing: (url: string) => boolean;
    isGeneratingGlossary: (url: string) => boolean;
    isAsking: (url: string) => boolean;
    addGlossaryGeneratingPaper: (url: string) => void;
    removeGlossaryGeneratingPaper: (url: string) => void;
    addAskingPaper: (url: string) => void;
    removeAskingPaper: (url: string) => void;
  };

  // Paper operations from parent hook
  paperOperations: {
    triggerSummary: (url: string) => Promise<void>;
    triggerExplanation: (url: string) => Promise<void>;
    triggerAnalysis: (url: string) => Promise<void>;
    findTabIdForPaper: (url: string) => Promise<number | undefined>;
  };

  // Paper navigation from parent
  paperNavigation: {
    allPapers: StoredPaper[];
    currentPaperIndex: number;
    setAllPapers: (papers: StoredPaper[]) => void;
  };

  // Callbacks to parent
  setStoredPaper: (paper: StoredPaper) => void;
  setGlossary: (glossary: GlossaryResult | null) => void;
  setGlossaryProgress: (progress: any) => void;
  setQaHistory: (history: QuestionAnswer[]) => void;
  setOperationQueueMessage: (msg: string) => void;
  setHasQueuedOperations: (has: boolean) => void;
  setViewState: (state: 'loading' | 'empty' | 'content' | 'stored-only') => void;
  loadExplanation: () => Promise<void>;
}

/**
 * PaperDetailPanel - Main panel showing paper details with tabs
 *
 * Displays:
 * - Paper info card
 * - Tabs: Summary, Explanation, Analysis, Q&A, Glossary, Original
 * - Tab-specific content
 * - Actions (Copy, Regenerate)
 */
export function PaperDetailPanel(props: PaperDetailPanelProps) {
  const {
    data,
    storedPaper,
    analysis,
    glossary,
    glossaryProgress,
    analysisProgress,
    qaHistory,
    question,
    setQuestion,
    draftQuestions,
    setDraftQuestions,
    operationState,
    paperOperations,
    paperNavigation,
    setStoredPaper,
    setGlossary,
    setGlossaryProgress,
    setQaHistory,
    setOperationQueueMessage,
    setHasQueuedOperations,
    setViewState,
    loadExplanation,
  } = props;

  // Tab state (local to this panel - UI only)
  const [activeTab, setActiveTab] = useState<TabType>('summary');

  // Q&A UI state (local to this panel)
  const [newlyAddedQAIndex, setNewlyAddedQAIndex] = useState<number | null>(null);

  // Actions state (local to this panel - UI only)
  const [copied, setCopied] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);

  /**
   * Trigger glossary generation
   * NOTE: This needs to stay here because it updates local state (glossary, analysis)
   * and also updates parent state (storedPaper, allPapers)
   */
  async function triggerGlossaryGeneration(paperUrl: string) {
    // Guard: Don't retrigger if already generating for THIS paper
    if (operationState.isGeneratingGlossary(paperUrl)) {
      logger.debug('UI', '[PaperDetailPanel] Glossary generation already in progress for this paper, skipping');
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

      // Find the tab viewing this specific paper (not just the active tab)
      const tabId = await paperOperations.findTabIdForPaper(paperUrl);

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

          logger.debug('UI', '[PaperDetailPanel] Updated storedPaper and allPapers with new glossary');
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

  /**
   * Handle asking a question about the paper
   */
  async function handleAskQuestion() {
    if (!question.trim() || !data?.paper.url) {
      return;
    }

    if (!storedPaper) {
      alert('Paper must be stored before asking questions. Please wait for paper to be stored.');
      return;
    }

    const paperUrl = data.paper.url;

    // Capture paper ID at start to prevent race conditions when user switches papers
    // during async operations (Q&A can take 3-5 seconds, user might switch to different paper)
    const targetPaperId = storedPaper.id;
    const targetPaperUrl = data.paper.url;

    // Guard: Don't retrigger if already asking a question for THIS paper
    if (operationState.isAsking(paperUrl)) {
      logger.debug('UI', '[PaperDetailPanel] Q&A already in progress for this paper, skipping');
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

      // Use captured paper ID to ensure we save to correct paper even if user switches
      await ChromeService.updatePaperQAHistory(targetPaperId, newHistory);

      const response = await ChromeService.askQuestion(targetPaperUrl, sanitizedQuestion);

      if (response.success && response.answer) {
        logger.debug('UI', '✓ Question answered successfully');
        // update history
        const answeredHistory = [response.answer, ...qaHistory];
        setQaHistory(answeredHistory);
        setQuestion(''); // Clear input

        // Remove draft question from Map since it's been answered
        setDraftQuestions(prev => {
          const next = new Map(prev);
          next.delete(targetPaperUrl);
          return next;
        });

        // If user is on Q&A tab when answer arrives, mark it as newly added
        if (activeTab === 'qa') {
          setNewlyAddedQAIndex(0); // New answer is at index 0 (prepended to array)
        }

        // Save Q&A history to database using captured paper ID
        await ChromeService.updatePaperQAHistory(targetPaperId, answeredHistory);
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

      // Use captured paper ID for error recovery too
      if (revertHistory.length > 0) {
        await ChromeService.updatePaperQAHistory(targetPaperId, revertHistory);
      }
      logger.error('UI', 'Error asking question:', error);
      alert('Failed to ask question. Please try again.');
    } finally {
      // Remove from asking papers Set
      operationState.removeAskingPaper(paperUrl);
    }
  }

  /**
   * Copy explanation to clipboard
   */
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

  /**
   * Regenerate explanation
   */
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

  return (
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
              onGenerateSummary={storedPaper?.url ? () => paperOperations.triggerSummary(storedPaper.url) : undefined}
            />
          </div>
        )}

        {activeTab === 'explanation' && (
          <div class="tab-content space-y-4">
            <ExplanationSection
              explanation={data?.explanation || null}
              isExplaining={storedPaper?.url ? operationState.isExplaining(storedPaper.url) : false}
              onGenerateExplanation={storedPaper?.url ? () => paperOperations.triggerExplanation(storedPaper.url) : undefined}
            />
          </div>
        )}

        {activeTab === 'analysis' && (
          <div class="tab-content space-y-4">
            <AnalysisSection
              analysis={analysis}
              isAnalyzing={storedPaper?.url ? operationState.isAnalyzing(storedPaper.url) : false}
              analysisProgress={analysisProgress}
              onGenerateAnalysis={storedPaper?.url ? () => paperOperations.triggerAnalysis(storedPaper.url) : undefined}
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
  );
}
