import { FileText, Sparkles } from 'lucide-preact';
import { ExplanationResult } from '../../shared/types/index.ts';
import { MarkdownRenderer } from '../../components/MarkdownRenderer.tsx';
import { CollapsibleSection } from './ui/CollapsibleSection.tsx';
import { LottiePlayer, LoopPurpose } from '../../shared/components/LottiePlayer.tsx';

interface ExplanationSectionProps {
  explanation: ExplanationResult | null;
  isExplaining: boolean;
  onGenerateExplanation?: () => void;
}

/**
 * Explanation Section Component
 * Displays paper explanation or provides option to generate it
 */
export function ExplanationSection(props: ExplanationSectionProps) {
  const { explanation, isExplaining, onGenerateExplanation } = props;

  // Loading state
  if (isExplaining && !explanation) {
    return (
      <div class="card">
        <div class="flex flex-col items-center justify-center gap-4 py-12">
          <LottiePlayer path="/lotties/kuma-thinking-glasses.lottie" className="mx-auto mb-1" autoStartLoop={true} size={100} loopPurpose={LoopPurpose.SIDEPANEL} />
          <div class="text-center">
            <p class="text-base font-medium text-gray-900 mb-2">Generating Explanation...</p>
            <p class="text-sm text-gray-600">
              Kuma is thinking of ways to explain the research paper in simpler terms.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // No explanation yet
  if (!explanation) {
    return (
      <div class="card">
        <div class="text-center py-8">
          <LottiePlayer path="/lotties/kuma-thinking-glasses.lottie" className="mx-auto mb-1" size={100} autoStartLoop={false} />
          <p class="text-gray-900 font-medium text-base mb-2">No explanation available yet</p>
          <p class="text-sm text-gray-600 mb-4">
            Click the button below to generate a simplified explanation of this paper.
          </p>

          {onGenerateExplanation && (
            <button
              onClick={onGenerateExplanation}
              class="inline-flex items-center gap-2 px-4 py-2 bg-blue-400 hover:bg-blue-500 text-white rounded-lg transition-colors duration-200 font-medium hover:cursor-pointer active:scale-95"
            >
              <Sparkles size={18} />
              Generate Explanation
            </button>
          )}
        </div>
      </div>
    );
  }

  // Explanation results
  return (
    <div class="animate-scale-in" style={{ animationDuration: '1000ms' }}>
      <CollapsibleSection
        title="At a Glance"
        icon={FileText}
        iconColor="text-blue-600"
        titleClassName="text-responsive-base font-semibold text-gray-900"
        defaultOpen={true}
      >
        <div class="space-y-2">
          <MarkdownRenderer content={explanation.explanation || ''} />
        </div>
      </CollapsibleSection>
    </div>
  );
}
