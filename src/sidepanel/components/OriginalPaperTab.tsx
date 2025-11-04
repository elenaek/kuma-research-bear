import { ResearchPaper } from '../../shared/types/index.ts';
import { CollapsibleSection } from './ui/CollapsibleSection.tsx';

interface OriginalPaperTabProps {
  paper: ResearchPaper | null;
}

/**
 * Original Paper Tab Component
 * Displays the original abstract of the research paper
 */
export function OriginalPaperTab(props: OriginalPaperTabProps) {
  const { paper } = props;

  if (!paper) {
    return null;
  }

  return (
    <CollapsibleSection title="Original Abstract" defaultOpen={true}>
      <div class="text-gray-700 leading-relaxed">
        {paper.abstract}
      </div>
    </CollapsibleSection>
  );
}
