import { useState, useRef, useEffect } from 'preact/hooks';
import {
  PawPrint,
  ChevronLeft,
  ChevronRight,
  Trash2,
  Settings,
  RefreshCw,
  Loader,
  MoreVertical,
  X,
  MessageCircle
} from 'lucide-preact';
import { StoredPaper } from '../../../types/index.ts';

interface IntegratedHeaderProps {
  // Paper data
  papers: StoredPaper[];
  currentIndex: number;
  currentPaperTitle?: string;

  // Top-level tab state
  topLevelTab: 'papers' | 'citations';
  onTopLevelTabChange: (tab: 'papers' | 'citations') => void;

  // Status
  isCheckingStorage?: boolean;
  statusText?: string;

  // Navigation handlers
  onPrevious: () => void;
  onNext: () => void;
  onSelect: (index: number) => void;

  // Delete handlers
  onDeleteCurrent: () => void;
  isDeleting: boolean;
  showDeleteConfirm: boolean;
  onCancelDelete: () => void;

  // Delete all handlers
  onDeleteAll: () => void;
  isDeletingAll: boolean;
  showDeleteAllConfirm: boolean;
  onCancelDeleteAll: () => void;

  // Refresh handler
  onRefresh?: () => void;

  // Chat handler
  onOpenChat?: () => void;
  hasChatEnabled?: boolean;

  // Optional subtitle (for "content" view)
  subtitle?: string;
}

/**
 * Integrated Header Component
 * Combines Kuma branding, paper navigation, and management controls
 */
export function IntegratedHeader(props: IntegratedHeaderProps) {
  const {
    papers,
    currentIndex,
    currentPaperTitle,
    topLevelTab,
    onTopLevelTabChange,
    isCheckingStorage = false,
    statusText,
    onPrevious,
    onNext,
    onSelect,
    onDeleteCurrent,
    isDeleting,
    showDeleteConfirm,
    onCancelDelete,
    onDeleteAll,
    isDeletingAll,
    showDeleteAllConfirm,
    onCancelDeleteAll,
    onRefresh,
    onOpenChat,
    hasChatEnabled = false,
    subtitle
  } = props;

  const [showSettingsMenu, setShowSettingsMenu] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const settingsMenuRef = useRef<HTMLDivElement>(null);
  const mobileMenuRef = useRef<HTMLDivElement>(null);

  // Close menus when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (settingsMenuRef.current && !settingsMenuRef.current.contains(event.target as Node)) {
        setShowSettingsMenu(false);
      }
      if (mobileMenuRef.current && !mobileMenuRef.current.contains(event.target as Node)) {
        setShowMobileMenu(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const hasPapers = papers.length > 0;
  const hasMultiplePapers = papers.length > 1;

  return (
    <header class="bg-white border-b border-gray-200">
      {/* Compact Branding Row */}
      <div class="px-responsive py-2.5">
        <div class="flex items-center justify-between gap-2">
          {/* Left: Compact Branding with Subtitle */}
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-1.5 text-sm">
              <PawPrint size={16} class="text-gray-400 flex-shrink-0" />
              <span class="font-semibold text-gray-800">Kuma</span>
              <span class="text-gray-400 hidden sm:inline">•</span>
              <span class="text-gray-600 hidden sm:inline truncate"> A bear that helps you understand research papers</span>
            </div>
          </div>

          {/* Right: Mobile Menu Button (narrow screens only) */}
          <div class="hide-on-wide">
            <button
              onClick={() => setShowMobileMenu(!showMobileMenu)}
              class="btn btn-secondary px-2 py-2 hover:cursor-pointer flex-shrink-0"
              title="Menu"
            >
              <MoreVertical size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* Top-Level Tabs Row */}
      <div class="px-responsive border-t border-gray-100">
        <div class="flex items-center gap-1 pt-2 pb-2">
          <button
            onClick={() => onTopLevelTabChange('papers')}
            class={`px-4 py-2 text-sm font-medium rounded-t-lg transition-all hover:cursor-pointer ${
              topLevelTab === 'papers'
                ? 'bg-white text-blue-600 border border-gray-200 border-b-0 shadow-sm relative z-10'
                : 'bg-gray-50 text-gray-600 border border-transparent hover:bg-gray-100 hover:text-gray-900 hover:shadow-sm'
            }`}
            style={topLevelTab === 'papers' ? 'margin-bottom: -1px;' : ''}
          >
            Papers
          </button>
          <button
            onClick={() => onTopLevelTabChange('citations')}
            class={`px-4 py-2 text-sm font-medium rounded-t-lg transition-all hover:cursor-pointer ${
              topLevelTab === 'citations'
                ? 'bg-white text-blue-600 border border-gray-200 border-b-0 shadow-sm relative z-10'
                : 'bg-gray-50 text-gray-600 border border-transparent hover:bg-gray-100 hover:text-gray-900 hover:shadow-sm'
            }`}
            style={topLevelTab === 'citations' ? 'margin-bottom: -1px;' : ''}
          >
            Citations
          </button>
        </div>
      </div>

      {/* Navigation Row (wide screens, when papers exist and Papers tab is active) */}
      {hasPapers && topLevelTab === 'papers' && (
        <div class="px-responsive pb-2.5 hide-on-narrow">
          <div class="flex items-center gap-2">
            {/* Navigation controls (only show if multiple papers) */}
            {hasMultiplePapers && (
              <>
                {/* Previous Button */}
                <button
                  onClick={onPrevious}
                  disabled={currentIndex === 0}
                  class="btn btn-secondary px-2 py-2 disabled:opacity-30 hover:cursor-pointer flex-shrink-0"
                  title="Previous Paper"
                >
                  <ChevronLeft size={14} />
                </button>

                {/* Paper Dropdown */}
                <select
                  value={currentIndex}
                  onChange={(e) => onSelect(parseInt((e.target as HTMLSelectElement).value))}
                  class="flex-1 min-w-0 px-2.5 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 truncate"
                >
                  {papers.map((paper, idx) => (
                    <option key={paper.id} value={idx}>
                      {paper.title}
                    </option>
                  ))}
                </select>

                {/* Next Button */}
                <button
                  onClick={onNext}
                  disabled={currentIndex === papers.length - 1}
                  class="btn btn-secondary px-2 py-2 disabled:opacity-30 hover:cursor-pointer flex-shrink-0"
                  title="Next Paper"
                >
                  <ChevronRight size={14} />
                </button>

                {/* Paper Counter */}
                <span class="text-xs text-gray-600 whitespace-nowrap flex-shrink-0 px-1">
                  {currentIndex + 1}/{papers.length}
                </span>
              </>
            )}

            {/* Single paper - show title */}
            {!hasMultiplePapers && (
              <div class="flex-1 min-w-0 text-sm text-gray-700 truncate" title={currentPaperTitle}>
                {currentPaperTitle}
              </div>
            )}

            {/* Delete Current Button */}
            <button
              onClick={onDeleteCurrent}
              disabled={isDeleting}
              class="btn btn-secondary px-2 py-2 text-red-600 hover:bg-red-50 hover:cursor-pointer flex-shrink-0"
              title="Delete Current Paper"
            >
              {isDeleting ? <Loader size={14} class="animate-spin" /> : <Trash2 size={14} />}
            </button>

            {/* Chat Button */}
            {/* {onOpenChat && (
              <button
                onClick={onOpenChat}
                disabled={!hasChatEnabled}
                class="btn btn-secondary px-2 py-2 hover:cursor-pointer flex-shrink-0"
                title={hasChatEnabled ? "Open floating chat" : "Paper not ready for chat"}
              >
                <MessageCircle size={14} />
              </button>
            )} */}

            {/* Settings Menu */}
            <div class="relative" ref={settingsMenuRef}>
              <button
                onClick={() => setShowSettingsMenu(!showSettingsMenu)}
                class="btn btn-secondary px-2 py-2 hover:cursor-pointer flex-shrink-0"
                title="Settings"
              >
                <Settings size={14} />
              </button>

              {/* Settings Dropdown */}
              {showSettingsMenu && (
                <div class="absolute right-0 mt-2 w-64 bg-white rounded-lg shadow-lg border border-gray-200 z-50 animate-scale-in">
                  <div class="p-4 space-y-3">
                    <div>
                      <h4 class="text-sm font-semibold text-gray-900 mb-1">Manage Papers</h4>
                      <p class="text-xs text-gray-600">
                        {papers.length} paper{papers.length !== 1 ? 's' : ''} in library
                      </p>
                    </div>

                    {/* Refresh Button */}
                    {onRefresh && (
                      <button
                        onClick={() => {
                          onRefresh();
                          setShowSettingsMenu(false);
                        }}
                        disabled={isCheckingStorage}
                        class="w-full btn btn-secondary px-3 py-2 text-sm hover:cursor-pointer flex items-center justify-center gap-2"
                      >
                        <RefreshCw size={14} class={isCheckingStorage ? 'animate-spin' : ''} />
                        <span>Refresh Storage</span>
                      </button>
                    )}

                    {/* Delete All Button */}
                    <button
                      onClick={() => {
                        onDeleteAll();
                        setShowSettingsMenu(false);
                      }}
                      disabled={isDeletingAll}
                      class="w-full btn btn-secondary text-red-600 hover:bg-red-50 px-3 py-2 text-sm hover:cursor-pointer flex items-center justify-center gap-2"
                    >
                      {isDeletingAll ? (
                        <>
                          <Loader size={14} class="animate-spin" />
                          <span>Deleting All...</span>
                        </>
                      ) : (
                        <>
                          <Trash2 size={14} />
                          <span>Delete All Papers</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Mobile Menu Dropdown (only in Papers tab) */}
      {showMobileMenu && topLevelTab === 'papers' && (
        <div class="hide-on-wide" ref={mobileMenuRef}>
          <div class="px-responsive pb-3 border-t border-gray-200 bg-gray-50 animate-scale-in">
            <div class="py-3 space-y-3">
              {/* Navigation (if multiple papers) */}
              {hasMultiplePapers && (
                <>
                  {/* Paper Dropdown - Full Width */}
                  <select
                    value={currentIndex}
                    onChange={(e) => onSelect(parseInt((e.target as HTMLSelectElement).value))}
                    class="w-full px-2 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {papers.map((paper, idx) => (
                      <option key={paper.id} value={idx}>
                        {paper.title}
                      </option>
                    ))}
                  </select>

                  {/* Navigation Buttons - Compact Centered Row */}
                  <div class="flex items-center justify-center gap-3">
                    <button
                      onClick={onPrevious}
                      disabled={currentIndex === 0}
                      class="btn btn-secondary px-2 py-2 disabled:opacity-30 hover:cursor-pointer flex-shrink-0"
                      title="Previous Paper"
                    >
                      <ChevronLeft size={16} />
                    </button>

                    <span class="text-xs text-gray-600 whitespace-nowrap">
                      {currentIndex + 1} / {papers.length}
                    </span>

                    <button
                      onClick={onNext}
                      disabled={currentIndex === papers.length - 1}
                      class="btn btn-secondary px-2 py-2 disabled:opacity-30 hover:cursor-pointer flex-shrink-0"
                      title="Next Paper"
                    >
                      <ChevronRight size={16} />
                    </button>
                  </div>
                </>
              )}

              {/* Delete Current */}
              {hasPapers && (
                <button
                  onClick={() => {
                    onDeleteCurrent();
                    setShowMobileMenu(false);
                  }}
                  disabled={isDeleting}
                  class="w-full btn btn-secondary text-red-600 hover:bg-red-50 px-3 py-2 text-sm hover:cursor-pointer flex items-center justify-center gap-2"
                >
                  {isDeleting ? (
                    <>
                      <Loader size={14} class="animate-spin" />
                      <span>Deleting...</span>
                    </>
                  ) : (
                    <>
                      <Trash2 size={14} />
                      <span>Delete Current Paper</span>
                    </>
                  )}
                </button>
              )}

              {/* Delete All */}
              {hasPapers && (
                <button
                  onClick={() => {
                    onDeleteAll();
                    setShowMobileMenu(false);
                  }}
                  disabled={isDeletingAll}
                  class="w-full btn btn-secondary text-red-600 hover:bg-red-50 px-3 py-2 text-sm hover:cursor-pointer flex items-center justify-center gap-2"
                >
                  {isDeletingAll ? (
                    <>
                      <Loader size={14} class="animate-spin" />
                      <span>Deleting All...</span>
                    </>
                  ) : (
                    <>
                      <Trash2 size={14} />
                      <span>Delete All Papers ({papers.length})</span>
                    </>
                  )}
                </button>
              )}

              {/* Refresh */}
              {onRefresh && (
                <button
                  onClick={() => {
                    onRefresh();
                    setShowMobileMenu(false);
                  }}
                  disabled={isCheckingStorage}
                  class="w-full btn btn-secondary px-3 py-2 text-sm hover:cursor-pointer flex items-center justify-center gap-2"
                >
                  <RefreshCw size={14} class={isCheckingStorage ? 'animate-spin' : ''} />
                  <span>Refresh Storage</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Delete Current Confirmation (only in Papers tab) */}
      {showDeleteConfirm && topLevelTab === 'papers' && (
        <div class="px-responsive pb-3 border-t border-gray-200 bg-red-50">
          <div class="py-3">
            <p class="text-sm font-semibold text-red-900 mb-2">
              Delete "{currentPaperTitle}"?
            </p>
            <p class="text-xs text-red-800 mb-3">
              This will remove all data including Q&A history.
            </p>
            <div class="flex gap-2">
              <button
                onClick={onDeleteCurrent}
                disabled={isDeleting}
                class="btn btn-secondary text-red-600 hover:bg-red-100 px-4 py-2 text-sm hover:cursor-pointer flex-1"
              >
                {isDeleting ? 'Deleting...' : 'Confirm Delete'}
              </button>
              <button
                onClick={onCancelDelete}
                disabled={isDeleting}
                class="btn btn-secondary px-4 py-2 text-sm flex-1"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete All Confirmation (only in Papers tab) */}
      {showDeleteAllConfirm && topLevelTab === 'papers' && (
        <div class="px-responsive pb-3 border-t border-gray-200 bg-red-50">
          <div class="py-3">
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
                class="btn btn-secondary text-red-600 hover:bg-red-100 px-4 py-2 text-sm hover:cursor-pointer flex-1"
              >
                {isDeletingAll ? 'Deleting...' : 'Delete All'}
              </button>
              <button
                onClick={onCancelDeleteAll}
                disabled={isDeletingAll}
                class="btn btn-secondary px-4 py-2 text-sm flex-1"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
