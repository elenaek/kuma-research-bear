import { CheckCircle, Clock, Loader, ArrowBigUpDash } from 'lucide-preact';

interface CompletionBadgesProps {
  isExplaining: boolean;
  isGeneratingSummary: boolean;
  isAnalyzing: boolean;
  isGeneratingGlossary: boolean;
  hasExplanation: boolean;
  hasSummary: boolean;
  hasAnalysis: boolean;
  hasGlossary: boolean;
  hasChunked: boolean;
  onExplanationClick?: () => void;
  onSummaryClick?: () => void;
  onAnalysisClick?: () => void;
  onGlossaryClick?: () => void;
  disableInteraction?: boolean; // Prevents clicks during initial render
}

interface FeatureBadgeProps {
  name: string;
  completed: boolean;
  active: boolean;
  onClick?: () => void;
  readyIdle?: boolean;
  tooltip?: string;
}

function FeatureBadge({ name, completed, active, onClick, readyIdle = false, tooltip }: FeatureBadgeProps) {
  const isPending = !completed && !active;
  const isClickable = isPending && onClick;

  const getBadgeStyle = () => {
    if (completed) return 'bg-green-50 text-green-700 border border-green-200';
    if (active) return 'bg-yellow-50 text-yellow-700 border border-yellow-200';
    return `text-gray-500 ${readyIdle ? 'bg-yellow-50 hover:bg-yellow-100 hover:scale-105 transition-all duration-150' : 'bg-gray-50 text-gray-500 border border-gray-200'}`;
  };

  const getIcon = () => {
    if (completed) return <CheckCircle size={12} class="text-green-600" />;
    if (active) return <Loader size={12} class="text-yellow-600 animate-spin" />;
    if (readyIdle) return <ArrowBigUpDash size={12} class="text-gray-400 rotate-180 animate-bounce" />;
    return <Clock size={12} class="text-gray-400" />;
  };

  const cursorClass = isClickable ? 'cursor-pointer hover:bg-gray-100' : '';

  return (
    <div
      class={`flex items-center gap-1 px-2 py-1 rounded text-xs ${getBadgeStyle()} ${cursorClass}`}
      onClick={isClickable ? onClick : undefined}
      title={tooltip}
    >
      {getIcon()}
      <span class="font-medium">{name}</span>
    </div>
  );
}

/**
 * Completion Badges component
 * Displays completion status for 4 main content features in a compact 2x2 grid
 */
export function CompletionBadges({
  isExplaining,
  isGeneratingSummary,
  isAnalyzing,
  isGeneratingGlossary,
  hasExplanation,
  hasSummary,
  hasAnalysis,
  hasGlossary,
  hasChunked,
  onExplanationClick,
  onSummaryClick,
  onAnalysisClick,
  onGlossaryClick,
  disableInteraction = false,
}: CompletionBadgesProps) {
  // All features can be triggered independently once paper is chunked
  const canTrigger = hasChunked;

  // Tooltip messages
  const summaryTooltip = hasSummary
    ? 'Summary complete'
    : isGeneratingSummary
    ? 'Generating summary...'
    : canTrigger
    ? 'Click to generate a summary of the paper'
    : 'Complete paper extraction/chunking first';

  const explanationTooltip = hasExplanation
    ? 'Explanation complete'
    : isExplaining
    ? 'Generating explanation...'
    : canTrigger
    ? 'Click to generate an explanation of the paper'
    : 'Complete paper extraction/chunking first';

  const analysisTooltip = hasAnalysis
    ? 'Analysis complete'
    : isAnalyzing
    ? 'Analysis in progress...'
    : canTrigger
    ? 'Click to analyze methodology, confounders, and limitations'
    : 'Complete paper extraction/chunking first';

  const glossaryTooltip = hasGlossary
    ? 'Glossary complete'
    : isGeneratingGlossary
    ? 'Generating glossary...'
    : canTrigger
    ? 'Click to generate a glossary of key terms'
    : 'Complete paper extraction/chunking first';

  return (
    <div class="grid grid-cols-2 gap-2 mt-3">
      <FeatureBadge
        name="Summary"
        completed={hasSummary}
        active={isGeneratingSummary}
        onClick={canTrigger && !disableInteraction ? onSummaryClick : undefined}
        readyIdle={canTrigger && !hasSummary && !isGeneratingSummary}
        tooltip={summaryTooltip}
      />
      <FeatureBadge
        name="Explanation"
        completed={hasExplanation}
        active={isExplaining}
        onClick={canTrigger && !disableInteraction ? onExplanationClick : undefined}
        readyIdle={canTrigger && !hasExplanation && !isExplaining}
        tooltip={explanationTooltip}
      />
      <FeatureBadge
        name="Analysis"
        completed={hasAnalysis}
        active={isAnalyzing}
        onClick={canTrigger && !disableInteraction ? onAnalysisClick : undefined}
        readyIdle={canTrigger && !hasAnalysis && !isAnalyzing}
        tooltip={analysisTooltip}
      />
      <FeatureBadge
        name="Glossary"
        completed={hasGlossary}
        active={isGeneratingGlossary}
        onClick={canTrigger && !disableInteraction ? onGlossaryClick : undefined}
        readyIdle={canTrigger && !hasGlossary && !isGeneratingGlossary}
        tooltip={glossaryTooltip}
      />
    </div>
  );
}
