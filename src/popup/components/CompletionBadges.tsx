import { CheckCircle, Clock, Loader } from 'lucide-preact';

interface CompletionBadgesProps {
  isExplaining: boolean;
  isAnalyzing: boolean;
  isGeneratingGlossary: boolean;
  hasExplanation: boolean;
  hasSummary: boolean;
  hasAnalysis: boolean;
  hasGlossary: boolean;
}

interface FeatureBadgeProps {
  name: string;
  completed: boolean;
  active: boolean;
}

function FeatureBadge({ name, completed, active }: FeatureBadgeProps) {
  const getBadgeStyle = () => {
    if (completed) return 'bg-green-50 text-green-700 border border-green-200';
    if (active) return 'bg-yellow-50 text-yellow-700 border border-yellow-200';
    return 'bg-gray-50 text-gray-500 border border-gray-200';
  };
  const getIcon = () => {
    if (completed) return <CheckCircle size={12} class="text-green-600" />;
    if (active) return <Loader size={12} class="text-yellow-600 animate-spin" />;
    return <Clock size={12} class="text-gray-400" />;
  };
  return (
    <div class={`flex items-center gap-1 px-2 py-1 rounded text-xs ${getBadgeStyle()}`}>
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
}: CompletionBadgesProps) {
  return (
    <div class="grid grid-cols-2 gap-2 mt-3">
      <FeatureBadge name="Explanation" completed={hasExplanation} active={isExplaining} />
      <FeatureBadge name="Summary" completed={hasSummary} active={isExplaining} />
      <FeatureBadge name="Analysis" completed={hasAnalysis} active={isAnalyzing} />
      <FeatureBadge name="Glossary" completed={hasGlossary} active={isGeneratingGlossary} />
    </div>
  );
}
