import { MarkdownRenderer } from '../../../components/MarkdownRenderer.tsx';
import { SummaryResult } from '../../../types/index.ts';

interface SummaryTabProps {
  summary: SummaryResult | null;
}

/**
 * Summary Tab Component
 * Displays quick summary and key points
 */
export function SummaryTab(props: SummaryTabProps) {
  const { summary } = props;

  if (!summary) {
    return null;
  }

  return (
    <>
      <div class="card">
        <h3 class="text-base font-semibold text-gray-900 mb-3">Quick Summary</h3>
        <MarkdownRenderer content={summary.summary || ''} />
      </div>

      <div class="card">
        <h3 class="text-base font-semibold text-gray-900 mb-3">Key Points</h3>
        <ul class="space-y-2">
          {summary.keyPoints.map((point, index) => (
            <li key={index} class="flex gap-2 text-gray-700">
              <span class="text-blue-600 font-bold">•</span>
              <MarkdownRenderer content={point} />
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
