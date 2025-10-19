import { Settings, ChevronUp, ChevronDown, Trash2, Loader } from 'lucide-preact';
import { StoredPaper } from '../../types/index.ts';

interface PaperManagementProps {
  papers: StoredPaper[];
  showManageSection: boolean;
  onToggleManageSection: () => void;
  onDeleteAll: () => void;
  isDeletingAll: boolean;
  showDeleteAllConfirm: boolean;
  onCancelDeleteAll: () => void;
}

/**
 * Paper Management Component
 * Displays manage papers section with delete all functionality
 */
export function PaperManagement(props: PaperManagementProps) {
  const {
    papers,
    showManageSection,
    onToggleManageSection,
    onDeleteAll,
    isDeletingAll,
    showDeleteAllConfirm,
    onCancelDeleteAll,
  } = props;

  // Only render if there are papers
  if (papers.length === 0) {
    return null;
  }

  return (
    <div class="card mt-2 mb-6">
      <button
        onClick={onToggleManageSection}
        class="w-full flex items-center justify-between text-left hover:cursor-pointer"
      >
        <div class="flex items-center gap-2">
          <Settings size={18} class="text-gray-600" />
          <h3 class="text-base font-semibold text-gray-900 hover:cursor-pointer">Manage Papers</h3>
        </div>
        {showManageSection ? <ChevronUp size={18} class="text-gray-600" /> : <ChevronDown size={18} class="text-gray-600" />}
      </button>

      {showManageSection && (
        <div class="mt-4 pt-4 border-t border-gray-200">
          <p class="text-sm text-gray-600 mb-3">
            {papers.length} paper{papers.length !== 1 ? 's' : ''} stored in your library
          </p>

          <div class="flex items-center gap-3">
            <button
              onClick={onDeleteAll}
              disabled={isDeletingAll}
              class="btn btn-secondary px-4 py-2 text-red-600 hover:bg-red-50 hover:cursor-pointer flex items-center gap-2"
              title="Delete all papers and their data"
            >
              {isDeletingAll ? (
                <>
                  <Loader size={16} class="animate-spin" />
                  <span>Deleting all...</span>
                </>
              ) : (
                <>
                  <Trash2 size={16} />
                  <span>Delete All Papers</span>
                </>
              )}
            </button>
          </div>

          {/* Delete All Confirmation */}
          {showDeleteAllConfirm && (
            <div class="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg">
              <p class="text-sm font-semibold text-red-900 mb-2">
                Delete all {papers.length} papers?
              </p>
              <p class="text-xs text-red-800 mb-3">
                This will permanently delete all papers, chunks, and Q&A history. This action cannot be undone.
              </p>
              <div class="flex gap-2">
                <button
                  onClick={onDeleteAll}
                  disabled={isDeletingAll}
                  class="btn btn-secondary text-red-600 hover:bg-red-100 px-4 py-2 text-sm hover:cursor-pointer"
                >
                  {isDeletingAll ? 'Deleting...' : 'Delete All'}
                </button>
                <button
                  onClick={onCancelDeleteAll}
                  disabled={isDeletingAll}
                  class="btn btn-secondary px-4 py-2 text-sm"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
