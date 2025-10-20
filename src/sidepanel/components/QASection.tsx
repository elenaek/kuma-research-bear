import { Loader } from 'lucide-preact';
import { QuestionAnswer, StoredPaper } from '../../types/index.ts';
import { MarkdownRenderer } from '../../components/MarkdownRenderer.tsx';

interface QASectionProps {
  question: string;
  setQuestion: (question: string) => void;
  isAsking: boolean;
  qaHistory: QuestionAnswer[];
  storedPaper: StoredPaper | null;
  onAskQuestion: () => void;
}

/**
 * Q&A Section Component
 * Displays question input form and Q&A history
 */
export function QASection(props: QASectionProps) {
  const { question, setQuestion, isAsking, qaHistory, storedPaper, onAskQuestion } = props;

  return (
    <>
      <div class="card animate-scale-in">
        <h3 class="text-base font-semibold text-gray-900 mb-3">Ask a Question</h3>
        <div class="flex gap-2 mb-3">
          <input
            type="text"
            value={question}
            onInput={(e) => setQuestion((e.target as HTMLInputElement).value)}
            onKeyPress={(e) => e.key === 'Enter' && !isAsking && onAskQuestion()}
            placeholder="Ask anything about this paper..."
            disabled={isAsking}
            class="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100"
            style={{ transition: 'all var(--duration-normal) var(--ease-out)' }}
          />
          <button
            onClick={onAskQuestion}
            disabled={!question.trim() || isAsking}
            class="btn btn-primary px-4 hover:cursor-pointer"
          >
            {isAsking ? (
              <Loader size={16} class="animate-spin spinner-fade-in" />
            ) : (
              'Ask'
            )}
          </button>
        </div>
        <p class="text-xs text-gray-500 animate-fade-in" style={{ animationDuration: '1000ms' }}>
          Kuma will search through {storedPaper?.chunkCount} content chunks to find relevant information.
        </p>
      </div>

      {/* Q&A History */}
      {qaHistory.length > 0 ? (
        <div class="space-y-4">
          {qaHistory.map((qa, idx) => (
            <div key={idx} class="card stagger-item" style={{ animationDelay: `${idx * 50}ms` }}>
              {/* Question */}
              <div class="mb-3 pb-3 border-b border-gray-200">
                <p class="text-sm font-semibold text-gray-900 mb-1">Question:</p>
                <p class="text-sm text-gray-700">{qa.question}</p>
              </div>

              {/* Answer */}
              <div class="mb-3">
                <p class="text-sm font-semibold text-gray-900 mb-1">Answer:</p>
                <MarkdownRenderer content={qa.answer} className="text-sm" />
              </div>

              {/* Sources */}
              {qa.sources.length > 0 && (
                <div class="pt-3 border-t border-gray-200">
                  <p class="text-xs font-medium text-gray-600 mb-1">Sources:</p>
                  <div class="flex flex-wrap gap-1">
                    {qa.sources.map((source, sIdx) => (
                      <span
                        key={sIdx}
                        class="px-2 py-0.5 text-xs rounded bg-blue-100 text-blue-700"
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
      ) : (
        <div class="card text-center py-8">
          <p class="text-sm text-gray-600">No questions asked yet.</p>
          <p class="text-xs text-gray-500 mt-1">Ask a question above to get started!</p>
        </div>
      )}
    </>
  );
}
