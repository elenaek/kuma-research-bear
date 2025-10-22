import { MarkdownRenderer } from '../../../components/MarkdownRenderer.tsx';
import { ExplanationResult } from '../../../types/index.ts';
import { CollapsibleSection } from '../ui/CollapsibleSection.tsx';

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
    <CollapsibleSection title="At a Glance" defaultOpen={true}>
      <MarkdownRenderer content={explanation.explanation || ''} />
    </CollapsibleSection>
  );
}
