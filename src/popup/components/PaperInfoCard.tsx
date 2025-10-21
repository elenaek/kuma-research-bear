import { Database } from 'lucide-preact';
import type { ResearchPaper } from '../../types/index.ts';
import { OperationBadges } from './OperationBadges.tsx';
import { CompletionBadges } from './CompletionBadges.tsx';

interface PaperInfoCardProps {
  paper: ResearchPaper;
  isPaperStored: boolean;
  // Operation phases
  isDetecting?: boolean;
  isChunking?: boolean;
  isExplaining?: boolean;
  isAnalyzing?: boolean;
  isGeneratingGlossary?: boolean;
  hasDetected?: boolean;
  hasChunked?: boolean;
  currentChunk?: number;
  totalChunks?: number;
  // Content features
  hasExplanation?: boolean;
  hasSummary?: boolean;
  hasAnalysis?: boolean;
  hasGlossary?: boolean;
  completionPercentage?: number;
}

/**
 * Paper Info Card component
 * Displays current paper information with storage status badge and completion indicators
 */
export function PaperInfoCard({
  paper,
  isPaperStored,
  isDetecting = false,
  isChunking = false,
  isExplaining = false,
  isAnalyzing = false,
  isGeneratingGlossary = false,
  hasDetected = false,
  hasChunked = false,
  currentChunk = 0,
  totalChunks = 0,
  hasExplanation = false,
  hasSummary = false,
  hasAnalysis = false,
  hasGlossary = false,
  completionPercentage = 0,
}: PaperInfoCardProps) {
  const getCompletionBadgeText = () => {
    if (completionPercentage === 100) return 'Ready';
    if (completionPercentage === 0) return '0% Ready';
    return `${Math.round(completionPercentage)}% Ready`;
  };

  const getCompletionBadgeColor = () => {
    if (completionPercentage === 100) return 'bg-green-100 text-green-700';
    if (completionPercentage >= 50) return 'bg-yellow-100 text-yellow-700';
    return 'bg-orange-100 text-orange-700';
  };

  return (
    <div class="card mb-4 bg-blue-50 border-blue-200">
      <div class="flex items-start justify-between gap-2 mb-2">
        <h3 class="text-sm font-semibold text-gray-700">Current Paper</h3>
        {isPaperStored && (
          <div class="flex items-center gap-2">
            <span class="px-2 py-1 text-xs font-medium rounded-full bg-green-100 text-green-700 flex items-center gap-1">
              <Database size={10} />
              Stored
            </span>
            <span class={`px-2 py-1 text-xs font-medium rounded-full ${getCompletionBadgeColor()}`}>
              {getCompletionBadgeText()}
            </span>
          </div>
        )}
      </div>
      <p class="text-sm font-medium text-gray-900 mb-1 line-clamp-2">{paper.title}</p>
      <p class="text-xs text-gray-600 line-clamp-1">{paper.authors.join(', ')}</p>

      {/* Show operation badges when operations are active or completed */}
      <OperationBadges
        isDetecting={isDetecting}
        isChunking={isChunking}
        hasDetected={hasDetected}
        hasChunked={hasChunked}
        currentChunk={currentChunk}
        totalChunks={totalChunks}
      />

      {/* Show completion badges when paper is stored or has any features */}
      {(isPaperStored || hasExplanation || hasSummary || hasAnalysis || hasGlossary) && (
        <CompletionBadges
          hasExplanation={hasExplanation}
          hasSummary={hasSummary}
          hasAnalysis={hasAnalysis}
          hasGlossary={hasGlossary}
          isExplaining={isExplaining}
          isAnalyzing={isAnalyzing}
          isGeneratingGlossary={isGeneratingGlossary}
        />
      )}
    </div>
  );
}
