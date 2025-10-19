import { ResearchPaper } from '../../types/index.ts';

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
    <div class="card">
      <h3 class="text-base font-semibold text-gray-900 mb-3">Original Abstract</h3>
      <div class="text-gray-700 leading-relaxed">
        {paper.abstract}
      </div>
    </div>
  );
}
