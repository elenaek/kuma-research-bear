import { useState, useEffect } from 'preact/hooks';
import { Copy, RefreshCw, ExternalLink, FileText, Calendar, BookOpen, Hash, Download, Database, Clock } from 'lucide-preact';
import { ResearchPaper, ExplanationResult, SummaryResult, StoredPaper } from '../types/index.ts';
import { getPaperByUrl } from '../utils/dbService.ts';

type ViewState = 'loading' | 'empty' | 'content';
type TabType = 'summary' | 'explanation' | 'original';

interface ExplanationData {
  paper: ResearchPaper;
  explanation: ExplanationResult;
  summary: SummaryResult;
}

export function Sidepanel() {
  const [viewState, setViewState] = useState<ViewState>('loading');
  const [activeTab, setActiveTab] = useState<TabType>('summary');
  const [data, setData] = useState<ExplanationData | null>(null);
  const [copied, setCopied] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [storedPaper, setStoredPaper] = useState<StoredPaper | null>(null);

  useEffect(() => {
    loadExplanation();

    // Listen for storage changes
    const listener = (changes: any, namespace: string) => {
      if (namespace === 'local' && changes.lastExplanation) {
        loadExplanation();
      }
    };

    chrome.storage.onChanged.addListener(listener);

    return () => {
      chrome.storage.onChanged.removeListener(listener);
    };
  }, []);

  async function loadExplanation() {
    try {
      const result = await chrome.storage.local.get(['lastExplanation']);

      if (!result.lastExplanation) {
        setViewState('empty');
        return;
      }

      setData(result.lastExplanation);

      // Check if paper is stored in IndexedDB
      try {
        const stored = await getPaperByUrl(result.lastExplanation.paper.url);
        setStoredPaper(stored);
      } catch (dbError) {
        console.warn('Could not check paper storage status:', dbError);
      }

      setViewState('content');
    } catch (error) {
      console.error('Error loading explanation:', error);
      setViewState('empty');
    }
  }

  async function handleCopy() {
    if (!data) {
      alert('No explanation to copy');
      return;
    }

    try {
      const { paper, explanation, summary } = data;

      const text = `
${paper.title}
${paper.authors.join(', ')}

SUMMARY:
${summary.summary}

KEY POINTS:
${summary.keyPoints.map(p => `- ${p}`).join('\n')}

EXPLANATION:
${explanation.explanation}

Source: ${paper.url}
      `.trim();

      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Error copying:', error);
      alert('Failed to copy explanation');
    }
  }

  async function handleRegenerate() {
    try {
      const result = await chrome.storage.local.get(['currentPaper']);

      if (!result.currentPaper) {
        alert('No paper found. Please detect a paper first.');
        return;
      }

      setIsRegenerating(true);
      setViewState('loading');

      const response = await chrome.runtime.sendMessage({
        type: 'EXPLAIN_PAPER',
        payload: { paper: result.currentPaper },
      });

      if (response.success) {
        await loadExplanation();
      } else {
        alert('Failed to regenerate explanation');
        setViewState('empty');
      }
    } catch (error) {
      console.error('Error regenerating:', error);
      alert('Failed to regenerate explanation');
      setViewState('empty');
    } finally {
      setIsRegenerating(false);
    }
  }

  if (viewState === 'loading') {
    return (
      <div class="h-screen flex items-center justify-center bg-gray-50">
        <div class="text-center">
          <div class="inline-block animate-spin rounded-full h-12 w-12 border-4 border-gray-200 border-t-bear-600 mb-4" />
          <p class="text-gray-600">Loading explanation...</p>
        </div>
      </div>
    );
  }

  if (viewState === 'empty') {
    return (
      <div class="h-screen flex items-center justify-center bg-gray-50 p-8">
        <div class="text-center max-w-md">
          <div class="w-16 h-16 mx-auto mb-4 rounded-full bg-gray-200 flex items-center justify-center">
            <FileText size={32} class="text-gray-400" />
          </div>
          <h2 class="text-xl font-semibold text-gray-800 mb-2">No Explanation Yet</h2>
          <p class="text-gray-600">Click "Explain Paper" in the popup to generate an explanation</p>
        </div>
      </div>
    );
  }

  return (
    <div class="h-screen flex flex-col bg-gray-50">
      {/* Header */}
      <header class="bg-white border-b border-gray-200 px-6 py-4">
        <h1 class="text-xl font-bold text-gray-800">Kuma the Research Bear</h1>
        <p class="text-sm text-gray-600">Kuma the Research Bear - Paper Explanations</p>
      </header>

      {/* Content */}
      <div class="flex-1 overflow-auto">
        <div class="max-w-4xl mx-auto p-6">
          {/* Paper Info - Enhanced Title Card */}
          <div class="card mb-6">
            {/* Title and Badges */}
            <div class="flex items-start justify-between gap-4 mb-3">
              <h2 class="text-lg font-semibold text-gray-900 flex-1">{data?.paper.title}</h2>
              <div class="flex gap-2 shrink-0">
                <span class="px-2 py-1 text-xs font-medium rounded-full bg-bear-100 text-bear-700 capitalize">
                  {data?.paper.source.replace('-', ' ')}
                </span>
                {storedPaper && (
                  <span class="px-2 py-1 text-xs font-medium rounded-full bg-green-100 text-green-700 flex items-center gap-1">
                    <Database size={12} />
                    Stored
                  </span>
                )}
              </div>
            </div>

            {/* Authors */}
            <p class="text-sm text-gray-600 mb-4">{data?.paper.authors.join(', ')}</p>

            {/* Metadata Grid */}
            {(data?.paper.metadata || storedPaper) && (
              <div class="grid grid-cols-1 gap-2 mb-4 pb-4 border-b border-gray-200">
                {/* Storage Info */}
                {storedPaper && (
                  <>
                    <div class="flex items-center gap-2 text-sm text-gray-700">
                      <Clock size={14} class="text-gray-400" />
                      <span class="font-medium">Stored:</span>
                      <span>{new Date(storedPaper.storedAt).toLocaleString()}</span>
                    </div>
                    <div class="flex items-center gap-2 text-sm text-gray-700">
                      <Database size={14} class="text-gray-400" />
                      <span class="font-medium">Chunks:</span>
                      <span>{storedPaper.chunkCount} content chunks for Q&A</span>
                    </div>
                  </>
                )}

                {data?.paper.metadata && (
                  <>
                    {/* Publication Date */}
                    {data.paper.metadata.publishDate && (
                      <div class="flex items-center gap-2 text-sm text-gray-700">
                        <Calendar size={14} class="text-gray-400" />
                        <span class="font-medium">Published:</span>
                        <span>{new Date(data.paper.metadata.publishDate).toLocaleDateString()}</span>
                      </div>
                    )}

                    {/* Journal/Venue */}
                    {(data.paper.metadata.journal || data.paper.metadata.venue) && (
                      <div class="flex items-center gap-2 text-sm text-gray-700">
                        <BookOpen size={14} class="text-gray-400" />
                        <span class="font-medium">Published in:</span>
                        <span>{data.paper.metadata.journal || data.paper.metadata.venue}</span>
                      </div>
                    )}

                    {/* DOI */}
                    {data.paper.metadata.doi && (
                      <div class="flex items-center gap-2 text-sm text-gray-700">
                        <Hash size={14} class="text-gray-400" />
                        <span class="font-medium">DOI:</span>
                        <a
                          href={`https://doi.org/${data.paper.metadata.doi}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          class="text-bear-600 hover:text-bear-700 hover:underline"
                        >
                          {data.paper.metadata.doi}
                        </a>
                      </div>
                    )}

                    {/* arXiv ID */}
                    {data.paper.metadata.arxivId && (
                      <div class="flex items-center gap-2 text-sm text-gray-700">
                        <Hash size={14} class="text-gray-400" />
                        <span class="font-medium">arXiv:</span>
                        <a
                          href={`https://arxiv.org/abs/${data.paper.metadata.arxivId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          class="text-bear-600 hover:text-bear-700 hover:underline"
                        >
                          {data.paper.metadata.arxivId}
                        </a>
                      </div>
                    )}

                    {/* PubMed IDs */}
                    {data.paper.metadata.pmid && (
                      <div class="flex items-center gap-2 text-sm text-gray-700">
                        <Hash size={14} class="text-gray-400" />
                        <span class="font-medium">PMID:</span>
                        <a
                          href={`https://pubmed.ncbi.nlm.nih.gov/${data.paper.metadata.pmid}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          class="text-bear-600 hover:text-bear-700 hover:underline"
                        >
                          {data.paper.metadata.pmid}
                        </a>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Action Links */}
            <div class="flex gap-3">
              <a
                href={data?.paper.url}
                target="_blank"
                rel="noopener noreferrer"
                class="inline-flex items-center gap-1 text-sm text-bear-600 hover:text-bear-700 font-medium"
              >
                <ExternalLink size={14} />
                View Original
              </a>

              {data?.paper.metadata?.pdfUrl && (
                <a
                  href={data.paper.metadata.pdfUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="inline-flex items-center gap-1 text-sm text-bear-600 hover:text-bear-700 font-medium"
                >
                  <Download size={14} />
                  Download PDF
                </a>
              )}
            </div>
          </div>

          {/* Tabs */}
          <div class="flex gap-2 mb-4 border-b border-gray-200">
            <button
              onClick={() => setActiveTab('summary')}
              class={`px-4 py-2 font-medium transition-colors border-b-2 ${
                activeTab === 'summary'
                  ? 'border-bear-600 text-bear-600'
                  : 'border-transparent text-gray-600 hover:text-gray-800'
              }`}
            >
              Summary
            </button>
            <button
              onClick={() => setActiveTab('explanation')}
              class={`px-4 py-2 font-medium transition-colors border-b-2 ${
                activeTab === 'explanation'
                  ? 'border-bear-600 text-bear-600'
                  : 'border-transparent text-gray-600 hover:text-gray-800'
              }`}
            >
              Explanation
            </button>
            <button
              onClick={() => setActiveTab('original')}
              class={`px-4 py-2 font-medium transition-colors border-b-2 ${
                activeTab === 'original'
                  ? 'border-bear-600 text-bear-600'
                  : 'border-transparent text-gray-600 hover:text-gray-800'
              }`}
            >
              Original
            </button>
          </div>

          {/* Tab Content */}
          <div class="space-y-4">
            {activeTab === 'summary' && (
              <>
                <div class="card">
                  <h3 class="text-base font-semibold text-gray-900 mb-3">Quick Summary</h3>
                  <p class="text-gray-700 leading-relaxed">{data?.summary.summary}</p>
                </div>

                <div class="card">
                  <h3 class="text-base font-semibold text-gray-900 mb-3">Key Points</h3>
                  <ul class="space-y-2">
                    {data?.summary.keyPoints.map((point, index) => (
                      <li key={index} class="flex gap-2 text-gray-700">
                        <span class="text-bear-600 font-bold">•</span>
                        <span>{point}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            )}

            {activeTab === 'explanation' && (
              <div class="card">
                <h3 class="text-base font-semibold text-gray-900 mb-3">Simplified Explanation</h3>
                <div class="text-gray-700 leading-relaxed whitespace-pre-wrap">
                  {data?.explanation.explanation}
                </div>
              </div>
            )}

            {activeTab === 'original' && (
              <div class="card">
                <h3 class="text-base font-semibold text-gray-900 mb-3">Original Abstract</h3>
                <div class="text-gray-700 leading-relaxed">
                  {data?.paper.abstract}
                </div>
              </div>
            )}
          </div>

          {/* Actions */}
          <div class="flex gap-3 mt-6">
            <button onClick={handleCopy} class="btn btn-secondary flex-1">
              <Copy size={16} />
              {copied ? 'Copied!' : 'Copy Explanation'}
            </button>

            <button
              onClick={handleRegenerate}
              disabled={isRegenerating}
              class="btn btn-secondary flex-1"
            >
              <RefreshCw size={16} class={isRegenerating ? 'animate-spin' : ''} />
              {isRegenerating ? 'Regenerating...' : 'Regenerate'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
