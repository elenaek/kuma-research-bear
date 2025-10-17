import { useState, useEffect } from 'preact/hooks';
import { Copy, RefreshCw, ExternalLink, FileText, Calendar, BookOpen, Hash, Download, Database, Clock, AlertCircle, CheckCircle, TrendingUp, AlertTriangle, Loader } from 'lucide-preact';
import { ResearchPaper, ExplanationResult, SummaryResult, StoredPaper, PaperAnalysisResult, QuestionAnswer, MessageType } from '../types/index.ts';
import { getPaperByUrl } from '../utils/dbService.ts';

type ViewState = 'loading' | 'empty' | 'content';
type TabType = 'summary' | 'explanation' | 'qa' | 'analysis' | 'original';

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
  const [analysis, setAnalysis] = useState<PaperAnalysisResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // Q&A state
  const [question, setQuestion] = useState('');
  const [isAsking, setIsAsking] = useState(false);
  const [qaHistory, setQaHistory] = useState<QuestionAnswer[]>([]);

  useEffect(() => {
    loadExplanation();

    // Listen for storage changes
    const listener = (changes: any, namespace: string) => {
      if (namespace === 'local' && (changes.lastExplanation || changes.lastAnalysis)) {
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
      const result = await chrome.storage.local.get(['lastExplanation', 'lastAnalysis']);

      if (!result.lastExplanation) {
        setViewState('empty');
        return;
      }

      setData(result.lastExplanation);

      // Load analysis if available
      if (result.lastAnalysis) {
        setAnalysis(result.lastAnalysis.analysis);
      }

      // Check if paper is stored in IndexedDB
      try {
        const stored = await getPaperByUrl(result.lastExplanation.paper.url);
        setStoredPaper(stored);

        // Auto-trigger analysis if paper is stored and no analysis exists yet
        if (stored && (!result.lastAnalysis || result.lastAnalysis.paper?.url !== result.lastExplanation.paper.url)) {
          console.log('Paper is stored, triggering automatic analysis...');
          triggerAnalysis(result.lastExplanation.paper.url);
        }
      } catch (dbError) {
        console.warn('Could not check paper storage status:', dbError);
      }

      setViewState('content');
    } catch (error) {
      console.error('Error loading explanation:', error);
      setViewState('empty');
    }
  }

  async function triggerAnalysis(paperUrl: string) {
    try {
      setIsAnalyzing(true);
      console.log('Starting paper analysis for:', paperUrl);

      const response = await chrome.runtime.sendMessage({
        type: 'ANALYZE_PAPER',
        payload: { url: paperUrl },
      });

      if (response.success) {
        console.log('✓ Paper analysis completed successfully');
        // Analysis will be loaded automatically via storage change listener
      } else {
        console.error('Analysis failed:', response.error);
      }
    } catch (error) {
      console.error('Error triggering analysis:', error);
    } finally {
      setIsAnalyzing(false);
    }
  }

  async function handleAskQuestion() {
    if (!question.trim() || !data?.paper.url) {
      return;
    }

    if (!storedPaper) {
      alert('Paper must be stored before asking questions. Please wait for paper to be stored.');
      return;
    }

    try {
      setIsAsking(true);
      console.log('Asking question:', question);

      const response = await chrome.runtime.sendMessage({
        type: MessageType.ASK_QUESTION,
        payload: {
          paperUrl: data.paper.url,
          question: question.trim(),
        },
      });

      if (response.success) {
        console.log('✓ Question answered successfully');
        // Add to history
        setQaHistory([response.answer, ...qaHistory]);
        setQuestion(''); // Clear input
      } else {
        console.error('Question answering failed:', response.error);
        alert(`Failed to answer question: ${response.error}`);
      }
    } catch (error) {
      console.error('Error asking question:', error);
      alert('Failed to ask question. Please try again.');
    } finally {
      setIsAsking(false);
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
              onClick={() => setActiveTab('analysis')}
              class={`px-4 py-2 font-medium transition-colors border-b-2 flex items-center gap-2 ${
                activeTab === 'analysis'
                  ? 'border-bear-600 text-bear-600'
                  : 'border-transparent text-gray-600 hover:text-gray-800'
              } ${!analysis && !isAnalyzing ? 'opacity-50' : ''}`}
              title={isAnalyzing ? 'Analysis in progress...' : !analysis ? 'Analysis will start automatically when paper is stored' : ''}
            >
              <span>Analysis</span>
              {isAnalyzing && <Loader size={14} class="animate-spin" />}
            </button>
            <button
              onClick={() => setActiveTab('qa')}
              class={`px-4 py-2 font-medium transition-colors border-b-2 ${
                activeTab === 'qa'
                  ? 'border-bear-600 text-bear-600'
                  : 'border-transparent text-gray-600 hover:text-gray-800'
              } ${!storedPaper ? 'opacity-50' : ''}`}
              title={!storedPaper ? 'Paper must be stored to ask questions' : 'Ask questions about this paper'}
            >
              Q&A
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

            {activeTab === 'analysis' && (
              <>
                {/* Loading State */}
                {isAnalyzing && !analysis && (
                  <div class="card">
                    <div class="flex flex-col items-center justify-center gap-4 py-12">
                      <Loader size={32} class="animate-spin text-bear-600" />
                      <div class="text-center">
                        <p class="text-base font-medium text-gray-900 mb-2">Analyzing Paper...</p>
                        <p class="text-sm text-gray-600">
                          Evaluating methodology, identifying confounders, analyzing implications, and assessing limitations.
                        </p>
                        <p class="text-xs text-gray-500 mt-2">This may take 20-30 seconds</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Analysis Results */}
                {analysis && (
                  <>
                    {/* Methodology Analysis */}
                    <div class="card">
                  <div class="flex items-center gap-2 mb-3">
                    <FileText size={18} class="text-bear-600" />
                    <h3 class="text-base font-semibold text-gray-900">Methodology</h3>
                  </div>

                  <div class="space-y-3">
                    <div>
                      <p class="text-sm font-medium text-gray-700 mb-1">Study Design</p>
                      <p class="text-sm text-gray-600">{analysis.methodology.studyDesign}</p>
                    </div>

                    <div>
                      <p class="text-sm font-medium text-gray-700 mb-1">Data Collection</p>
                      <p class="text-sm text-gray-600">{analysis.methodology.dataCollection}</p>
                    </div>

                    <div>
                      <p class="text-sm font-medium text-gray-700 mb-1">Sample Size</p>
                      <p class="text-sm text-gray-600">{analysis.methodology.sampleSize}</p>
                    </div>

                    <div>
                      <p class="text-sm font-medium text-gray-700 mb-1">Statistical Methods</p>
                      <p class="text-sm text-gray-600">{analysis.methodology.statisticalMethods}</p>
                    </div>

                    <div>
                      <p class="text-sm font-medium text-green-700 mb-1 flex items-center gap-1">
                        <CheckCircle size={14} />
                        Strengths
                      </p>
                      <ul class="space-y-1">
                        {analysis.methodology.strengths.map((strength, idx) => (
                          <li key={idx} class="flex gap-2 text-sm text-gray-600">
                            <span class="text-green-600">•</span>
                            <span>{strength}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div>
                      <p class="text-sm font-medium text-yellow-700 mb-1 flex items-center gap-1">
                        <AlertCircle size={14} />
                        Concerns
                      </p>
                      <ul class="space-y-1">
                        {analysis.methodology.concerns.map((concern, idx) => (
                          <li key={idx} class="flex gap-2 text-sm text-gray-600">
                            <span class="text-yellow-600">•</span>
                            <span>{concern}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>

                {/* Confounders & Biases */}
                <div class="card">
                  <div class="flex items-center gap-2 mb-3">
                    <AlertTriangle size={18} class="text-orange-600" />
                    <h3 class="text-base font-semibold text-gray-900">Confounders & Biases</h3>
                  </div>

                  <div class="space-y-3">
                    <div>
                      <p class="text-sm font-medium text-gray-700 mb-1">Identified Confounders</p>
                      <ul class="space-y-1">
                        {analysis.confounders.identified.map((item, idx) => (
                          <li key={idx} class="flex gap-2 text-sm text-gray-600">
                            <span class="text-orange-600">•</span>
                            <span>{item}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div>
                      <p class="text-sm font-medium text-gray-700 mb-1">Potential Biases</p>
                      <ul class="space-y-1">
                        {analysis.confounders.biases.map((bias, idx) => (
                          <li key={idx} class="flex gap-2 text-sm text-gray-600">
                            <span class="text-red-600">•</span>
                            <span>{bias}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div>
                      <p class="text-sm font-medium text-gray-700 mb-1">Control Measures</p>
                      <ul class="space-y-1">
                        {analysis.confounders.controlMeasures.map((measure, idx) => (
                          <li key={idx} class="flex gap-2 text-sm text-gray-600">
                            <span class="text-blue-600">•</span>
                            <span>{measure}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>

                {/* Implications */}
                <div class="card">
                  <div class="flex items-center gap-2 mb-3">
                    <TrendingUp size={18} class="text-blue-600" />
                    <h3 class="text-base font-semibold text-gray-900">Implications</h3>
                  </div>

                  <div class="space-y-3">
                    <div>
                      <p class="text-sm font-medium text-gray-700 mb-1">Significance</p>
                      <p class="text-sm text-gray-600">{analysis.implications.significance}</p>
                    </div>

                    <div>
                      <p class="text-sm font-medium text-gray-700 mb-1">Real-World Applications</p>
                      <ul class="space-y-1">
                        {analysis.implications.realWorldApplications.map((app, idx) => (
                          <li key={idx} class="flex gap-2 text-sm text-gray-600">
                            <span class="text-blue-600">•</span>
                            <span>{app}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div>
                      <p class="text-sm font-medium text-gray-700 mb-1">Future Research Directions</p>
                      <ul class="space-y-1">
                        {analysis.implications.futureResearch.map((research, idx) => (
                          <li key={idx} class="flex gap-2 text-sm text-gray-600">
                            <span class="text-purple-600">•</span>
                            <span>{research}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>

                {/* Limitations */}
                <div class="card">
                  <div class="flex items-center gap-2 mb-3">
                    <AlertCircle size={18} class="text-red-600" />
                    <h3 class="text-base font-semibold text-gray-900">Limitations</h3>
                  </div>

                  <div class="space-y-3">
                    <div>
                      <p class="text-sm font-medium text-gray-700 mb-1">Study Limitations</p>
                      <ul class="space-y-1">
                        {analysis.limitations.studyLimitations.map((limitation, idx) => (
                          <li key={idx} class="flex gap-2 text-sm text-gray-600">
                            <span class="text-red-600">•</span>
                            <span>{limitation}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div>
                      <p class="text-sm font-medium text-gray-700 mb-1">Generalizability</p>
                      <p class="text-sm text-gray-600">{analysis.limitations.generalizability}</p>
                    </div>

                    <div>
                      <p class="text-sm font-medium text-gray-700 mb-1">Recommendations</p>
                      <ul class="space-y-1">
                        {analysis.limitations.recommendations.map((rec, idx) => (
                          <li key={idx} class="flex gap-2 text-sm text-gray-600">
                            <span class="text-green-600">•</span>
                            <span>{rec}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              </>
            )}
              </>
            )}

            {activeTab === 'qa' && (
              <>
                {/* Q&A Input */}
                <div class="card">
                  <h3 class="text-base font-semibold text-gray-900 mb-3">Ask a Question</h3>

                  {!storedPaper ? (
                    <div class="p-4 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-800">
                      Paper must be stored before asking questions. Please wait for the paper to be stored.
                    </div>
                  ) : (
                    <>
                      <div class="flex gap-2 mb-3">
                        <input
                          type="text"
                          value={question}
                          onInput={(e) => setQuestion((e.target as HTMLInputElement).value)}
                          onKeyPress={(e) => e.key === 'Enter' && !isAsking && handleAskQuestion()}
                          placeholder="Ask anything about this paper..."
                          disabled={isAsking}
                          class="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-bear-500 focus:border-transparent disabled:bg-gray-100"
                        />
                        <button
                          onClick={handleAskQuestion}
                          disabled={!question.trim() || isAsking}
                          class="btn btn-primary px-4 hover:cursor-pointer"
                        >
                          {isAsking ? (
                            <Loader size={16} class="animate-spin" />
                          ) : (
                            'Ask'
                          )}
                        </button>
                      </div>

                      <p class="text-xs text-gray-500">
                        Kuma will search through {storedPaper.chunkCount} content chunks to find relevant information.
                      </p>
                    </>
                  )}
                </div>

                {/* Q&A History */}
                {qaHistory.length > 0 ? (
                  <div class="space-y-4">
                    {qaHistory.map((qa, idx) => (
                      <div key={idx} class="card">
                        {/* Question */}
                        <div class="mb-3 pb-3 border-b border-gray-200">
                          <p class="text-sm font-semibold text-gray-900 mb-1">Question:</p>
                          <p class="text-sm text-gray-700">{qa.question}</p>
                        </div>

                        {/* Answer */}
                        <div class="mb-3">
                          <p class="text-sm font-semibold text-gray-900 mb-1">Answer:</p>
                          <div class="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
                            {qa.answer}
                          </div>
                        </div>

                        {/* Sources */}
                        {qa.sources.length > 0 && (
                          <div class="pt-3 border-t border-gray-200">
                            <p class="text-xs font-medium text-gray-600 mb-1">Sources:</p>
                            <div class="flex flex-wrap gap-1">
                              {qa.sources.map((source, sIdx) => (
                                <span
                                  key={sIdx}
                                  class="px-2 py-0.5 text-xs rounded bg-bear-100 text-bear-700"
                                >
                                  {source}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Timestamp */}
                        <div class="mt-2 text-xs text-gray-500">
                          {new Date(qa.timestamp).toLocaleString()}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : storedPaper ? (
                  <div class="card text-center py-8">
                    <p class="text-sm text-gray-600">No questions asked yet.</p>
                    <p class="text-xs text-gray-500 mt-1">Ask a question above to get started!</p>
                  </div>
                ) : null}
              </>
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
