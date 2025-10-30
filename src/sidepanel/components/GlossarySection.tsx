import { memo } from 'preact/compat';
import { BookOpen, Sparkles } from 'lucide-preact';
import { GlossaryResult } from '../../types/index.ts';
import { GlossaryList } from '../../components/GlossaryCard.tsx';
import { LottiePlayer } from '../../shared/components/LottiePlayer.tsx';
import { LoopPurpose } from '../../shared/components/LottiePlayer.tsx';

interface GlossarySectionProps {
  glossary: GlossaryResult | null;
  isGenerating: boolean;
  glossaryProgress?: {
    stage: 'extracting' | 'extracting-terms-from-chunks' | 'filtering-terms' | 'generating-definitions';
    current?: number;
    total?: number;
  } | null;
  onGenerateGlossary?: () => void;
}

/**
 * Glossary Section Component
 * Displays glossary of terms for the paper
 * Memoized to prevent unnecessary re-renders
 */
export const GlossarySection = memo(function GlossarySection(props: GlossarySectionProps) {
  const { glossary, isGenerating, glossaryProgress, onGenerateGlossary } = props;

  // Show glossary if available
  if (glossary) {
    return (
      <div class="card">
        <GlossaryList terms={glossary.terms} />
      </div>
    );
  }

  // Loading state
  if (isGenerating) {
    let progressMessage = 'Generating glossary of terms...';
    let progressDetail = 'Combing through the paper and extracting key terminology.';

    if (glossaryProgress) {
      if (glossaryProgress.stage === 'extracting') {
        progressMessage = 'Extracting keyword candidates...';
        progressDetail = 'Kuma is identifying potential technical terms.';
      } else if (glossaryProgress.stage === 'extracting-terms-from-chunks') {
        progressMessage = `Extracting terms from document sections... ${glossaryProgress.current || 0}/${glossaryProgress.total || 0}`;
        progressDetail = 'Kuma is analyzing each section to identify key technical terms and concepts.';
      } else if (glossaryProgress.stage === 'filtering-terms') {
        progressMessage = 'Filtering for technical terms...';
        progressDetail = 'Kuma is identifying actual technical terminology and removing non-technical terms.';
      } else if (glossaryProgress.stage === 'generating-definitions') {
        progressMessage = `Writing definitions for each term... ${glossaryProgress.current || 0}/${glossaryProgress.total || 0}`;
        progressDetail = 'Kuma is writing definitions for each term.';
      }
    }

    return (
      <div class="card">
        <div class="text-center py-8">
          <LottiePlayer path="/lotties/kuma-thinking-glasses.lottie" size={100} className="mx-auto mb-1" autoStartLoop={true} loopPurpose={LoopPurpose.SIDEPANEL} />
          <p class="text-gray-900 font-medium text-base">{progressMessage}</p>
          <p class="text-sm text-gray-600">{progressDetail}</p>

          {glossaryProgress?.stage === 'extracting-terms-from-chunks' && glossaryProgress.current && glossaryProgress.total && (
            <div class="mt-4 w-full max-w-xs mx-auto">
              <div class="w-full bg-gray-200 rounded-full h-2.5">
                <div
                  class="bg-blue-600 h-2.5 rounded-full transition-all duration-300"
                  style={{ width: `${(glossaryProgress.current / glossaryProgress.total) * 100}%` }}
                ></div>
              </div>
            </div>
          )}

          {glossaryProgress?.stage === 'generating-definitions' && glossaryProgress.current && glossaryProgress.current > 0 && glossaryProgress.total && glossaryProgress.total > 0 && (
            <div class="mt-4 w-full max-w-xs mx-auto">
              <div class="w-full bg-gray-200 rounded-full h-2.5">
                <div
                  class="bg-blue-600 h-2.5 rounded-full transition-all duration-300"
                  style={{ width: `${(glossaryProgress.current / glossaryProgress.total) * 100}%` }}
                ></div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // No glossary yet
  return (
    <div class="card">
      <div class="text-center py-8">
        <LottiePlayer path="/lotties/kuma-thinking-glasses.lottie" size={100} className="mx-auto mb-1" autoStartLoop={false} />
        <p class="text-gray-900 font-medium text-base mb-2">No glossary available yet</p>
        <p class="text-sm text-gray-600 mb-4">
          Click the button below to generate a glossary of key terms and concepts from this paper.
        </p>

        {onGenerateGlossary && (
          <button
            onClick={onGenerateGlossary}
            class="inline-flex items-center gap-2 px-4 py-2 bg-blue-400 hover:bg-blue-500 text-white rounded-lg transition-colors duration-200 font-medium hover:cursor-pointer active:scale-95"
          >
            <Sparkles size={18} />
            Generate Glossary
          </button>
        )}
      </div>
    </div>
  );
});
