import { CheckCircle, Clock, Loader, ArrowBigUpDash } from 'lucide-preact';

interface CompletionBadgesProps {
  isExplaining: boolean;
  isAnalyzing: boolean;
  isGeneratingGlossary: boolean;
  hasExplanation: boolean;
  hasSummary: boolean;
  hasAnalysis: boolean;
  hasGlossary: boolean;
  onAnalysisClick?: () => void;
  onGlossaryClick?: () => void;
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
  isAnalyzing,
  isGeneratingGlossary,
  hasExplanation,
  hasSummary,
  hasAnalysis,
  hasGlossary,
  onAnalysisClick,
  onGlossaryClick,
}: CompletionBadgesProps) {
  // Only allow Analysis and Glossary to be triggered after Explanation and Summary are complete
  const prerequisitesComplete = hasExplanation && hasSummary;

  // Tooltip messages
  const analysisTooltip = hasAnalysis
    ? 'Analysis complete'
    : isAnalyzing
    ? 'Analysis in progress...'
    : prerequisitesComplete
    ? 'Click to analyze methodology, confounders, and limitations'
    : 'Complete Explanation and Summary first';

  const glossaryTooltip = hasGlossary
    ? 'Glossary complete'
    : isGeneratingGlossary
    ? 'Generating glossary...'
    : prerequisitesComplete
    ? 'Click to generate a glossary of key terms'
    : 'Complete Explanation and Summary first';

  return (
    <div class="grid grid-cols-2 gap-2 mt-3">
      <FeatureBadge name="Explanation" completed={hasExplanation} active={isExplaining} />
      <FeatureBadge name="Summary" completed={hasSummary} active={isExplaining} />
      <FeatureBadge
        name="Analysis"
        completed={hasAnalysis}
        active={isAnalyzing}
        onClick={prerequisitesComplete ? onAnalysisClick : undefined}
        readyIdle={prerequisitesComplete}
        tooltip={analysisTooltip}
      />
      <FeatureBadge
        name="Glossary"
        completed={hasGlossary}
        active={isGeneratingGlossary}
        onClick={prerequisitesComplete ? onGlossaryClick : undefined}
        readyIdle={prerequisitesComplete}
        tooltip={glossaryTooltip}
      />
    </div>
  );
}
