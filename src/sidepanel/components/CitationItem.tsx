import { h } from 'preact';
import { useState, useRef, useEffect } from 'preact/hooks';
import { Citation, CitationFormat } from '../../types/index.ts';
import { generateInlineCitation, generateQuoteCitation } from '../../utils/citationFormatters.ts';
import { logger } from '../../utils/logger.ts';

interface CitationItemProps {
  citation: Citation;
  format: CitationFormat;
  onDelete: (citationId: string) => void;
}

export function CitationItem({ citation, format, onDelete }: CitationItemProps) {
  const [copied, setCopied] = useState(false);
  const [showQuote, setShowQuote] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [copyMode, setCopyMode] = useState<'citation' | 'quote'>('citation');
  const [showCopyMenu, setShowCopyMenu] = useState(false);
  const deleteTimerRef = useRef<number | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const inlineCitation = generateInlineCitation(citation, format);
  const quoteCitation = generateQuoteCitation(citation, format);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (deleteTimerRef.current) {
        window.clearTimeout(deleteTimerRef.current);
      }
    };
  }, []);

  // Handle click outside menu to close it
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowCopyMenu(false);
      }
    };

    if (showCopyMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showCopyMenu]);

  const handleCopy = async () => {
    try {
      const textToCopy = copyMode === 'quote' ? quoteCitation : inlineCitation;
      await navigator.clipboard.writeText(textToCopy);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      logger.error('UI_COMPONENTS', 'Error copying citation:', error);
    }
  };

  const handleCopyModeSelect = (mode: 'citation' | 'quote') => {
    setCopyMode(mode);
    setShowCopyMenu(false);
  };

  const toggleCopyMenu = (e: Event) => {
    e.stopPropagation();
    setShowCopyMenu(!showCopyMenu);
  };

  const handleDelete = async () => {
    // First click: Enter confirm mode
    if (!confirmDelete) {
      setConfirmDelete(true);

      // Auto-reset after 3 seconds
      deleteTimerRef.current = window.setTimeout(() => {
        setConfirmDelete(false);
        deleteTimerRef.current = null;
      }, 3000);

      return;
    }

    // Second click: Actually delete
    try {
      // Clear the auto-reset timer
      if (deleteTimerRef.current) {
        window.clearTimeout(deleteTimerRef.current);
        deleteTimerRef.current = null;
      }

      // Send delete request to background service worker
      chrome.runtime.sendMessage({
        type: 'DELETE_CITATION',
        payload: { citationId: citation.id },
      }, (response) => {
        if (chrome.runtime.lastError) {
          logger.error('UI_COMPONENTS', 'Error deleting citation:', chrome.runtime.lastError);
          return;
        }

        if (response && response.success) {
          logger.debug('UI', '[Citation Item] Citation deleted successfully');
          onDelete(citation.id);
        } else {
          logger.error('UI_COMPONENTS', 'Failed to delete citation');
        }
      });

      // Reset confirm state
      setConfirmDelete(false);
    } catch (error) {
      logger.error('UI_COMPONENTS', 'Error deleting citation:', error);
      setConfirmDelete(false);
    }
  };

  // Truncate paper title for display
  const truncatedTitle = citation.paperTitle.length > 50
    ? citation.paperTitle.substring(0, 50) + '...'
    : citation.paperTitle;

  // Truncate quote for preview
  const truncatedQuote = citation.selectedText.length > 80
    ? citation.selectedText.substring(0, 80) + '...'
    : citation.selectedText;

  return (
    <div class="citation-item group relative border border-gray-200 rounded-md p-3 hover:border-blue-300 hover:bg-blue-50 transition-colors">
      {/* Citation text - clickable to copy */}
      <button
        class="w-full text-left"
        onClick={handleCopy}
        title="Click to copy"
      >
        <div class="font-mono text-sm text-gray-800 mb-2">
          {inlineCitation}
        </div>
      </button>

      {/* Paper info */}
      <div class="text-xs text-gray-600 mb-1">
        <span class="font-medium">{truncatedTitle}</span>
      </div>

      {/* Quote preview */}
      <div class="text-xs text-gray-500 italic mb-2">
        "{truncatedQuote}"
        {citation.selectedText.length > 80 && (
          <button
            class="ml-1 text-blue-600 hover:text-blue-700 hover:cursor-pointer"
            onClick={() => setShowQuote(!showQuote)}
          >
            {showQuote ? 'less' : 'more'}
          </button>
        )}
      </div>

      {/* Full quote (shown on demand) */}
      {showQuote && (
        <div class="text-xs text-gray-600 italic mb-2 p-2 bg-gray-50 rounded border border-gray-200">
          "{citation.selectedText}"
        </div>
      )}

      {/* Page/Section info */}
      {citation.pageNumber && (
        <div class="text-xs text-gray-500">
          {typeof citation.pageNumber === 'number' || /^\d+$/.test(citation.pageNumber.toString())
            ? `Page ${citation.pageNumber}`
            : citation.pageNumber}
        </div>
      )}

      {/* Action buttons */}
      <div class="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        {/* Copy button group with dropdown */}
        <div class="relative" ref={menuRef}>
          <div class="flex items-center bg-white rounded shadow-sm">
            {/* Main copy button */}
            <button
              class="p-1.5 rounded-l hover:bg-gray-100 transition-colors hover:cursor-pointer"
              onClick={handleCopy}
              title={copyMode === 'quote' ? 'Copy quote with citation' : 'Copy citation only'}
            >
              {copied ? (
                <svg class="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <svg class="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              )}
            </button>
            {/* Dropdown toggle button */}
            <button
              class="p-1.5 pl-0 pr-1.5 rounded-r hover:bg-gray-100 transition-colors hover:cursor-pointer border-l border-gray-200"
              onClick={toggleCopyMenu}
              title="Choose copy mode"
            >
              <svg class="w-3 h-3 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          </div>

          {/* Dropdown menu */}
          {showCopyMenu && (
            <div class="absolute top-full right-0 mt-1 bg-white rounded-md shadow-lg border border-gray-200 py-1 z-50 min-w-[180px]">
              <button
                class="w-full px-3 py-2 text-left text-sm hover:bg-gray-100 transition-colors flex items-center justify-between"
                onClick={() => handleCopyModeSelect('citation')}
              >
                <span>Citation only</span>
                {copyMode === 'citation' && (
                  <svg class="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </button>
              <button
                class="w-full px-3 py-2 text-left text-sm hover:bg-gray-100 transition-colors flex items-center justify-between"
                onClick={() => handleCopyModeSelect('quote')}
              >
                <span>Quote + citation</span>
                {copyMode === 'quote' && (
                  <svg class="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </button>
            </div>
          )}
        </div>

        {/* Delete button */}
        <button
          class={`p-1.5 rounded transition-all hover:cursor-pointer ${
            confirmDelete
              ? 'bg-red-600 hover:bg-red-700 scale-105'
              : 'bg-white hover:bg-gray-100'
          }`}
          onClick={handleDelete}
          title={confirmDelete ? 'Click again to confirm deletion' : 'Delete citation'}
        >
          {confirmDelete ? (
            <svg class="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          ) : (
            <svg class="w-4 h-4 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}
