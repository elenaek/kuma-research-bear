import { MarkdownRenderer } from '../../../components/MarkdownRenderer.tsx';
import { SummaryResult } from '../../../types/index.ts';
import { CollapsibleSection } from '../ui/CollapsibleSection.tsx';

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
      <CollapsibleSection title="Quick Summary" defaultOpen={true}>
        <MarkdownRenderer content={summary.summary || ''} />
      </CollapsibleSection>

      <CollapsibleSection title="Key Points" defaultOpen={true}>
        <ul class="space-y-2">
          {summary.keyPoints.map((point, index) => (
            <li key={index} class="flex gap-2 text-gray-700">
              <span class="text-blue-600 font-bold">•</span>
              <MarkdownRenderer content={point} />
            </li>
          ))}
        </ul>
      </CollapsibleSection>
    </>
  );
}
