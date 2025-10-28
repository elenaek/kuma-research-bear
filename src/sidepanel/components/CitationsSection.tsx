import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import { Citation, CitationFormat } from '../../types/index.ts';
import {
  getAllCitations,
  getSelectedFormat,
  setSelectedFormat,
  getCitationCount,
  resetCitationsOrder
} from '../../services/citationsStorage.ts';
import { CitationItem } from './CitationItem.tsx';
import { ReferenceItem } from './ReferenceItem.tsx';
import { generateInlineCitation, generateReferenceCitation } from '../../utils/citationFormatters.ts';

export function CitationsSection() {
  const [citations, setCitations] = useState<Citation[]>([]);
  const [format, setFormat] = useState<CitationFormat>('apa');
  const [loading, setLoading] = useState(true);
  const [copiedAll, setCopiedAll] = useState(false);

  // Load citations and format on mount
  useEffect(() => {
    loadCitations();
    loadFormat();

    // Listen for citation added events via Chrome runtime messaging
    const handleMessage = (message: any) => {
      if (message.type === 'CITATION_ADDED') {
        console.log('[Citations Tab] Citation added, reloading...');
        loadCitations();
      }
    };

    chrome.runtime.onMessage.addListener(handleMessage);

    return () => {
      chrome.runtime.onMessage.removeListener(handleMessage);
    };
  }, []);

  const loadCitations = async () => {
    try {
      setLoading(true);
      const allCitations = await getAllCitations();
      setCitations(allCitations);
    } catch (error) {
      console.error('[Citations Tab] Error loading citations:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadFormat = async () => {
    try {
      const savedFormat = await getSelectedFormat();
      setFormat(savedFormat);
    } catch (error) {
      console.error('[Citations Tab] Error loading format:', error);
    }
  };

  const handleFormatChange = async (newFormat: CitationFormat) => {
    setFormat(newFormat);
    try {
      await setSelectedFormat(newFormat);
    } catch (error) {
      console.error('[Citations Tab] Error saving format:', error);
    }
  };

  const handleDelete = async (citationId: string) => {
    // CitationItem will handle the deletion
    // Just reload after deletion
    await loadCitations();
  };

  const handleCopyAll = async () => {
    if (citations.length === 0) return;

    // Generate all references in the selected format
    const references = citations.map((citation, index) =>
      generateReferenceCitation(citation, format, index + 1)
    );

    const referencesText = references.join('\n\n');

    try {
      await navigator.clipboard.writeText(referencesText);
      setCopiedAll(true);
      setTimeout(() => setCopiedAll(false), 2000);
    } catch (error) {
      console.error('[Citations Tab] Error copying all references:', error);
    }
  };

  const handleResetOrder = async () => {
    try {
      await resetCitationsOrder();
      await loadCitations();
    } catch (error) {
      console.error('[Citations Tab] Error resetting order:', error);
    }
  };

  if (loading) {
    return (
      <div class="flex items-center justify-center py-12">
        <div class="text-gray-500">Loading citations...</div>
      </div>
    );
  }

  if (citations.length === 0) {
    return (
      <div class="text-center py-12 px-4">
        <div class="text-gray-400 mb-2">
          <svg class="w-16 h-16 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
        </div>
        <h3 class="text-lg font-medium text-gray-700 mb-2">No citations yet</h3>
        <p class="text-sm text-gray-500 max-w-md mx-auto">
          Highlight text in any paper and click "Add Citation" to create citations for your research.
        </p>
      </div>
    );
  }

  return (
    <div class="citations-section">
      {/* Format Selector */}
      <div class="mb-4 flex items-center justify-between">
        <div>
          <label class="text-sm font-medium text-gray-700 mr-3">Citation Format:</label>
          <select
            class="px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={format}
            onChange={(e) => handleFormatChange((e.target as HTMLSelectElement).value as CitationFormat)}
          >
            <option value="apa">APA (7th Edition)</option>
            <option value="mla">MLA (9th Edition)</option>
            <option value="chicago">Chicago (17th Edition)</option>
            <option value="ieee">IEEE</option>
          </select>
        </div>
        <div class="text-sm text-gray-500">
          {citations.length} {citations.length === 1 ? 'citation' : 'citations'}
        </div>
      </div>

      {/* Two-pane layout */}
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Left Pane: Inline Citations */}
        <div class="citations-pane border border-gray-200 rounded-lg p-4 bg-white">
          <div class="flex items-center justify-between mb-3">
            <h3 class="text-sm font-semibold text-gray-700">Inline Citations</h3>
            <button
              class="text-xs hover:cursor-pointer text-blue-600 hover:text-blue-700"
              onClick={handleResetOrder}
              title="Reset to alphabetical order"
            >
              Reset Order
            </button>
          </div>
          <div class="space-y-2">
            {citations.map((citation) => (
              <CitationItem
                key={citation.id}
                citation={citation}
                format={format}
                onDelete={handleDelete}
              />
            ))}
          </div>
        </div>

        {/* Right Pane: References List */}
        <div class="references-pane border border-gray-200 rounded-lg p-4 bg-white">
          <div class="flex items-center justify-between mb-3">
            <h3 class="text-sm font-semibold text-gray-700">References</h3>
            <button
              class="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors hover:cursor-pointer"
              onClick={handleCopyAll}
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              {copiedAll ? 'Copied!' : 'Copy All'}
            </button>
          </div>
          <div class="space-y-3">
            {citations.map((citation, index) => (
              <ReferenceItem
                key={citation.id}
                citation={citation}
                format={format}
                index={index + 1}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Help text */}
      <div class="mt-4 text-xs text-gray-500 text-center">
        Click any citation to copy it to your clipboard. Citations are sorted alphabetically by author.
      </div>
    </div>
  );
}
