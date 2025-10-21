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

  // Determine API badge text and styling
  const apiInfo = summary.generatedBy === 'summarizer-api'
    ? { text: 'Chrome Summarizer API', color: 'bg-green-100 text-green-800' }
    : { text: 'Prompt API', color: 'bg-blue-100 text-blue-800' };

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

      {/* API Source Indicator */}
      {/* {summary.generatedBy && (
        <div class="mt-4 flex items-center justify-end">
          <span class={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${apiInfo.color}`}>
            Generated with {apiInfo.text}
          </span>
        </div>
      )} */}
    </>
  );
}
