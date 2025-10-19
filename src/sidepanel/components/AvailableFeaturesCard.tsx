import { TrendingUp, FileText, Loader } from 'lucide-preact';
import { StoredPaper } from '../../types/index.ts';

interface AvailableFeaturesCardProps {
  storedPaper: StoredPaper | null;
  isAnalyzing: boolean;
}

/**
 * Available Features Card Component
 * Shows available features when paper is stored but not yet fully explained
 */
export function AvailableFeaturesCard(props: AvailableFeaturesCardProps) {
  const { storedPaper, isAnalyzing } = props;

  return (
    <div class="card mb-6">
      <h3 class="text-base font-semibold text-gray-900 mb-3">Available Features</h3>
      <div class="space-y-3">
        <div class="flex items-start gap-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
          <TrendingUp size={20} class="text-blue-600 shrink-0 mt-0.5" />
          <div>
            <p class="font-medium text-gray-900 text-sm mb-1">Analysis</p>
            <p class="text-xs text-gray-600">
              {isAnalyzing
                ? 'Analyzing methodology, confounders, implications, and limitations...'
                : 'View comprehensive paper analysis'}
            </p>
            {isAnalyzing && <Loader size={16} class="animate-spin text-blue-600 mt-2" />}
          </div>
        </div>

        <div class="flex items-start gap-3 p-3 bg-green-50 border border-green-200 rounded-lg">
          <FileText size={20} class="text-green-600 shrink-0 mt-0.5" />
          <div>
            <p class="font-medium text-gray-900 text-sm mb-1">Q&A System</p>
            <p class="text-xs text-gray-600">
              Ask Kuma questions and get AI-powered answers from {storedPaper?.chunkCount} content chunks
            </p>
          </div>
        </div>

        <div class="flex items-start gap-3 p-3 bg-gray-50 border border-gray-200 rounded-lg">
          <Loader size={20} class="text-gray-400 shrink-0 mt-0.5" />
          <div>
            <p class="font-medium text-gray-900 text-sm mb-1">Full Explanation</p>
            <p class="text-xs text-gray-600">
              Click "Explain Paper" in the popup to generate summary and detailed explanation
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
