import { memo } from 'preact/compat';
import { Loader, InfoIcon } from 'lucide-preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import { ChevronDown, ChevronUp } from 'lucide-preact';
import { QuestionAnswer, StoredPaper } from '../../types/index.ts';
import { MarkdownRenderer } from '../../components/MarkdownRenderer.tsx';
import { LottiePlayer, LoopPurpose } from '../../shared/components/LottiePlayer.tsx';

interface QASectionProps {
  question: string;
  setQuestion: (question: string) => void;
  isAsking: boolean;
  qaHistory: QuestionAnswer[];
  storedPaper: StoredPaper | null;
  onAskQuestion: () => void;
  newlyAddedQAIndex?: number | null;
}

interface QACardProps {
  qa: QuestionAnswer;
  index: number;
  defaultOpen: boolean;
}

/**
 * Individual Q&A Card Component
 * Collapsible card for each question-answer pair
 * Memoized to prevent unnecessary re-renders
 */
const QACard = memo(function QACard(props: QACardProps) {
  const { qa, index, defaultOpen } = props;
  const [isExpanded, setIsExpanded] = useState(qa.question.length > 0 && qa.answer.length === 0 ? true : defaultOpen);
  const containerRef = useRef<HTMLDivElement>(null);
  const prevExpandedRef = useRef(defaultOpen);

  // Auto-scroll when Q&A card expands
  useEffect(() => {
    const wasExpanded = prevExpandedRef.current;
    const isNowExpanded = isExpanded;

    // Only scroll when transitioning from collapsed to expanded
    if (!wasExpanded && isNowExpanded && containerRef.current) {
      // Small delay to allow expand animation to start
      setTimeout(() => {
        containerRef.current?.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
          inline: 'nearest'
        });
      }, 100);
    }

    // Update previous state
    prevExpandedRef.current = isExpanded;
  }, [isExpanded]);

  return (
    <div ref={containerRef} class="card stagger-item" style={{ animationDelay: `${index * 50}ms` }}>
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        class="w-full text-left focus:outline-none hover:cursor-pointer"
        aria-expanded={isExpanded}
      >
        <div class="flex items-start justify-between gap-2 mb-3 pb-3 border-b border-gray-200">
          <div class="flex-grow">
          <p class="text-sm font-semibold text-gray-900 mb-1 inline-block">
              Question:
              {!qa.answer && (
                <Loader size={16} class="animate-spin text-blue-400 ml-2 inline-block" />
              )}
            </p>
            <p class="text-sm text-gray-700">{qa.question}</p>
          </div>
          <div class="flex-shrink-0 mt-1">
            {isExpanded ? (
              <ChevronUp size={16} class="text-gray-500" />
            ) : (
              <ChevronDown size={16} class="text-gray-500" />
            )}
          </div>
        </div>
      </button>

      {isExpanded && (
        qa.answer ? (
          <>
            <div class="animate-fadeIn" style={{ animationDuration: '1000ms' }}>
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
          </>
        ) : (
          <div class="text-center">
            <LottiePlayer path="/lotties/kuma-qanda.lottie" size={80} className="mx-auto mt-2 mb-3" autoStartLoop={true} loopPurpose={LoopPurpose.QASection} />
            <p class="text-gray-900 font-medium text-base">Kuma is thinking about your question...</p>
            <p class="text-sm text-gray-600 mb-2">
              Researching an answer to your question using the research paper.
            </p>
        </div>
        )
      )}
    </div>
  );
});

/**
 * Q&A Section Component
 * Displays question input form and Q&A history
 * Memoized to prevent unnecessary re-renders
 */
export const QASection = memo(function QASection(props: QASectionProps) {
  const { question, setQuestion, isAsking, qaHistory, storedPaper, onAskQuestion, newlyAddedQAIndex } = props;

  return (
    <>
      <div class="card animate-scale-in">
        <h3 class="text-responsive-base font-semibold text-gray-900 mb-3">Ask a Question</h3>
        <div class="flex flex-col xs:flex-row gap-2 mb-3">
          <input
            type="text"
            value={question}
            onInput={(e) => setQuestion((e.target as HTMLInputElement).value)}
            onKeyPress={(e) => e.key === 'Enter' && !isAsking && onAskQuestion()}
            placeholder="Ask anything about this paper..."
            disabled={isAsking}
            class="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100 min-h-[44px]"
            style={{ transition: 'all var(--duration-normal) var(--ease-out)' }}
          />
          <button
            onClick={onAskQuestion}
            disabled={!question.trim() || isAsking}
            class="btn btn-primary px-4 hover:cursor-pointer w-full xs:w-auto"
          >
            {isAsking ? (
              <Loader size={16} class="animate-spin" />
            ) : (
              'Ask'
            )}
          </button>
        </div>
        <p class="text-responsive-xs text-gray-500 animate-fade-in" style={{ animationDuration: '1000ms' }}>
          <InfoIcon size={16} class="text-gray-500 inline-block mr-1" /> 
          Kuma has more room to think here than in the chatbox and will search through {storedPaper?.chunkCount} content chunks to answer your question.
        </p>
      </div>

      {/* Q&A History */}
      {qaHistory.length > 0 ? (
        <div class="space-y-4">
          {qaHistory.map((qa, idx) => (
            <QACard
              key={idx}
              qa={qa}
              index={idx}
              defaultOpen={idx === newlyAddedQAIndex}
            />
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
});
