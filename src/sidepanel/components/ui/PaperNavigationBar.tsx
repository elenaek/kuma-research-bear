import { ChevronLeft, ChevronRight, Trash2, Loader } from 'lucide-preact';
import { StoredPaper } from '../../../types/index.ts';
import { ConfirmationDialog } from './ConfirmationDialog.tsx';

interface PaperNavigationBarProps {
  papers: StoredPaper[];
  currentIndex: number;
  currentPaperTitle?: string;
  onPrevious: () => void;
  onNext: () => void;
  onSelect: (index: number) => void;
  onDelete: () => void;
  isDeleting: boolean;
  showDeleteConfirm: boolean;
  onCancelDelete: () => void;
}

/**
 * Paper Navigation Bar Component
 * Provides navigation controls for browsing multiple papers
 */
export function PaperNavigationBar(props: PaperNavigationBarProps) {
  const {
    papers,
    currentIndex,
    currentPaperTitle,
    onPrevious,
    onNext,
    onSelect,
    onDelete,
    isDeleting,
    showDeleteConfirm,
    onCancelDelete,
  } = props;

  // Don't render if only one or no papers
  if (papers.length <= 1) {
    return null;
  }

  return (
    <div class="card mb-4 bg-gray-50 animate-slide-in-up">
      <div class="flex items-center justify-between gap-3">
        {/* Previous Button */}
        <button
          onClick={onPrevious}
          disabled={currentIndex === 0}
          class="btn btn-secondary px-3 py-2 disabled:opacity-30 hover:cursor-pointer"
          title="Previous Paper"
        >
          <ChevronLeft size={16} />
        </button>

        {/* Dropdown Selector */}
        <select
          value={currentIndex}
          onChange={(e) => onSelect(parseInt((e.target as HTMLSelectElement).value))}
          class="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          style={{ transition: 'all var(--duration-normal) var(--ease-out)' }}
        >
          {papers.map((paper, idx) => (
            <option key={paper.id} value={idx}>
              {paper.title.substring(0, 60)}{paper.title.length > 60 ? '...' : ''}
            </option>
          ))}
        </select>

        {/* Paper Counter */}
        <span class="text-sm text-gray-600 whitespace-nowrap animate-fade-in">
          {currentIndex + 1} of {papers.length}
        </span>

        {/* Next Button */}
        <button
          onClick={onNext}
          disabled={currentIndex === papers.length - 1}
          class="btn btn-secondary px-3 py-2 disabled:opacity-30 hover:cursor-pointer"
          title="Next Paper"
        >
          <ChevronRight size={16} />
        </button>

        {/* Delete Button */}
        <button
          onClick={onDelete}
          disabled={isDeleting}
          class="btn btn-secondary px-3 py-2 text-red-600 hover:bg-red-50 hover:cursor-pointer"
          title="Delete Paper"
        >
          {isDeleting ? <Loader size={16} class="animate-spin spinner-fade-in" /> : <Trash2 size={16} />}
        </button>
      </div>

      {/* Delete Confirmation */}
      <ConfirmationDialog
        show={showDeleteConfirm}
        message={`Delete "${currentPaperTitle}"? This will remove all data including Q&A history.`}
        confirmText="Confirm Delete"
        cancelText="Cancel"
        onConfirm={onDelete}
        onCancel={onCancelDelete}
        variant="danger"
      />
    </div>
  );
}
