import { Search, PanelRight, Loader, Backpack } from 'lucide-preact';
import type { AIStatus } from '../hooks/useAIStatus.ts';

interface ActionButtonsProps {
  aiStatus: AIStatus;
  isDetecting: boolean;
  isExplaining: boolean;
  isAnalyzing: boolean;
  isGeneratingGlossary: boolean;
  isPaperStored: boolean;
  isSidepanelOpen: boolean;
  currentUrlHasPaper: boolean;
  onDetectPaper: () => void;
  onOpenSidepanel: () => void;
}

/**
 * Action Buttons component
 * Main action buttons for detecting papers and opening sidepanel
 */
export function ActionButtons({
  aiStatus,
  isDetecting,
  isExplaining,
  isAnalyzing,
  isGeneratingGlossary,
  isPaperStored,
  isSidepanelOpen,
  currentUrlHasPaper,
  onDetectPaper,
  onOpenSidepanel,
}: ActionButtonsProps) {
  const isOperationRunning = isDetecting || isExplaining || isAnalyzing || isGeneratingGlossary;
  const isDetectDisabled = aiStatus !== 'ready' || isOperationRunning || isPaperStored;

  // Determine button style
  const getDetectButtonClass = () => {
    if (isPaperStored) {
      return isOperationRunning ? 'btn btn-kuma-working' : 'btn btn-success';
    }
    return 'btn btn-primary';
  };

  // Determine button title
  const getDetectButtonTitle = () => {
    if (aiStatus !== 'ready') return 'Wake Kuma up';
    if (isDetecting) return 'Detecting and explaining...';
    return 'Detect paper and automatically generate explanation';
  };

  return (
    <div class="space-y-2">
      {/* Detect & Explain Button */}
      <button
        onClick={onDetectPaper}
        disabled={isDetectDisabled}
        class={`${getDetectButtonClass()} w-full hover:cursor-pointer`}
        title={getDetectButtonTitle()}
      >
        {isOperationRunning ? (
          <>
            <Loader size={32} class="animate-spin" />
            Kuma is hard at work... (Detecting, explaining, and analyzing)
          </>
        ) : isPaperStored ? (
          <>
            <Backpack size={32} />
            Kuma has found this research paper stored in his backpack. (Paper already stored)
          </>
        ) : (
          <>
            <Search size={32} />
            Detect & Explain Paper
          </>
        )}
      </button>

      {/* Open Sidepanel Button */}
      <button
        onClick={onOpenSidepanel}
        disabled={isSidepanelOpen && !currentUrlHasPaper}
        class="btn btn-secondary w-full hover:cursor-pointer"
        title={
          isSidepanelOpen && !currentUrlHasPaper
            ? 'No paper stored for this URL'
            : isSidepanelOpen
            ? 'Navigate sidepanel to this paper'
            : 'Open sidepanel'
        }
      >
        <PanelRight size={16} />
        {isSidepanelOpen ? 'Open in Sidepanel' : 'Open Sidepanel'}
      </button>
    </div>
  );
}
