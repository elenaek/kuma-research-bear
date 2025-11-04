import { FileText, List, Sparkles } from 'lucide-preact';
import { SummaryResult } from '../../shared/types/index.ts';
import { MarkdownRenderer } from '../../components/MarkdownRenderer.tsx';
import { CollapsibleSection } from './ui/CollapsibleSection.tsx';
import { LottiePlayer, LoopPurpose } from '../../shared/components/LottiePlayer.tsx';

interface SummarySectionProps {
  summary: SummaryResult | null;
  isGeneratingSummary: boolean;
  onGenerateSummary?: () => void;
}

/**
 * Summary Section Component
 * Displays paper summary or provides option to generate it
 */
export function SummarySection(props: SummarySectionProps) {
  const { summary, isGeneratingSummary, onGenerateSummary } = props;

  // Loading state
  if (isGeneratingSummary && !summary) {
    return (
      <div class="card">
        <div class="flex flex-col items-center justify-center gap-4 py-12">
          <LottiePlayer path="/lotties/kuma-thinking-glasses.lottie" className="mx-auto mb-1" autoStartLoop={true} size={100} loopPurpose={LoopPurpose.SIDEPANEL} />
          <div class="text-center">
            <p class="text-base font-medium text-gray-900 mb-2">Generating Summary...</p>
            <p class="text-sm text-gray-600">
              Kuma is creating a concise summary with key takeaways.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // No summary yet
  if (!summary) {
    return (
      <div class="card">
        <div class="text-center py-8">
          <LottiePlayer path="/lotties/kuma-thinking-glasses.lottie" className="mx-auto mb-1" size={100} autoStartLoop={false} />
          <p class="text-gray-900 font-medium text-base mb-2">No summary available yet</p>
          <p class="text-sm text-gray-600 mb-4">
            Click the button below to generate a summary with key points from this paper.
          </p>

          {onGenerateSummary && (
            <button
              onClick={onGenerateSummary}
              class="inline-flex items-center gap-2 px-4 py-2 bg-blue-400 hover:bg-blue-500 text-white rounded-lg transition-colors duration-200 font-medium hover:cursor-pointer active:scale-95"
            >
              <Sparkles size={18} />
              Generate Summary
            </button>
          )}
        </div>
      </div>
    );
  }

  // Summary results
  return (
    <>
      <div class="animate-scale-in" style={{ animationDuration: '1000ms' }}>
        <CollapsibleSection
          title="Quick Summary"
          icon={FileText}
          iconColor="text-blue-600"
          titleClassName="text-responsive-base font-semibold text-gray-900"
          defaultOpen={true}
        >
          <div class="space-y-2">
            <MarkdownRenderer content={summary.summary || ''} />
          </div>
        </CollapsibleSection>
      </div>

      <div class="animate-scale-in" style={{ animationDuration: '1000ms' }}>
        <CollapsibleSection
          title="Key Points"
          icon={List}
          iconColor="text-green-600"
          titleClassName="text-responsive-base font-semibold text-gray-900"
          defaultOpen={true}
        >
          <ul class="space-y-2">
            {summary.keyPoints.map((point, index) => (
              <li key={index} class="flex gap-2 text-gray-700">
                <span class="text-blue-600 font-bold">•</span>
                <MarkdownRenderer content={point} />
              </li>
            ))}
          </ul>
        </CollapsibleSection>
      </div>
    </>
  );
}
