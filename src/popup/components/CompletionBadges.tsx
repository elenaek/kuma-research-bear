import { CheckCircle, Clock } from 'lucide-preact';

interface CompletionBadgesProps {
  hasExplanation: boolean;
  hasSummary: boolean;
  hasAnalysis: boolean;
  hasGlossary: boolean;
}

interface FeatureBadgeProps {
  name: string;
  completed: boolean;
}

function FeatureBadge({ name, completed }: FeatureBadgeProps) {
  return (
    <div
      class={`flex items-center gap-1 px-2 py-1 rounded text-xs ${
        completed
          ? 'bg-green-50 text-green-700 border border-green-200'
          : 'bg-gray-50 text-gray-500 border border-gray-200'
      }`}
    >
      {completed ? (
        <CheckCircle size={12} class="text-green-600" />
      ) : (
        <Clock size={12} class="text-gray-400" />
      )}
      <span class="font-medium">{name}</span>
    </div>
  );
}

/**
 * Completion Badges component
 * Displays completion status for 4 main features in a compact 2x2 grid
 */
export function CompletionBadges({
  hasExplanation,
  hasSummary,
  hasAnalysis,
  hasGlossary,
}: CompletionBadgesProps) {
  return (
    <div class="grid grid-cols-2 gap-2 mt-3">
      <FeatureBadge name="Explanation" completed={hasExplanation} />
      <FeatureBadge name="Summary" completed={hasSummary} />
      <FeatureBadge name="Analysis" completed={hasAnalysis} />
      <FeatureBadge name="Glossary" completed={hasGlossary} />
    </div>
  );
}
