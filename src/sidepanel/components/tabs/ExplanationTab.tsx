import { MarkdownRenderer } from '../../../components/MarkdownRenderer.tsx';
import { ExplanationResult } from '../../../types/index.ts';

interface ExplanationTabProps {
  explanation: ExplanationResult | null;
}

/**
 * Explanation Tab Component
 * Displays simplified explanation
 */
export function ExplanationTab(props: ExplanationTabProps) {
  const { explanation } = props;

  if (!explanation) {
    return null;
  }

  return (
    <div class="card">
      <h3 class="text-base font-semibold text-gray-900 mb-3">Simplified Explanation</h3>
      <MarkdownRenderer content={explanation.explanation || ''} />
    </div>
  );
}
