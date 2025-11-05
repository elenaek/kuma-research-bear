import { h } from 'preact';
import { ChatMessage, ChatTab, SourceInfo } from '../../../shared/types/index.ts';
import { MarkdownRenderer } from '../../../components/MarkdownRenderer.tsx';
import { LottiePlayer, LoopPurpose } from '../../../shared/components/LottiePlayer.tsx';

interface MessageListProps {
  messages: ChatMessage[];
  isStreaming: boolean;
  streamingMessage: string;
  disabled: boolean;
  isGeneratingEmbeddings?: boolean;
  hasEmbeddings?: boolean;
  embeddingProgress?: string;
  activeTab?: ChatTab;
  screenCaptureUrl: string | null;
  isPdfCapture: boolean;
  expandedSources: Set<number>;
  messagesContainerRef: { current: HTMLDivElement | null };
  messagesEndRef: { current: HTMLDivElement | null };
  isRegenerating?: boolean;
  onRegenerateExplanation?: () => void;
  onScrollToImage?: () => void;
  toggleSourceExpansion: (messageIndex: number) => void;
  handleScrollToSource: (sourceInfo: SourceInfo | undefined) => void;
}

/**
 * Message list component displaying all chat messages
 * Includes embedding indicator, empty state, and streaming support
 */
export const MessageList = ({
  messages,
  isStreaming,
  streamingMessage,
  disabled,
  isGeneratingEmbeddings,
  hasEmbeddings,
  embeddingProgress,
  activeTab,
  screenCaptureUrl,
  isPdfCapture,
  expandedSources,
  messagesContainerRef,
  messagesEndRef,
  isRegenerating,
  onRegenerateExplanation,
  onScrollToImage,
  toggleSourceExpansion,
  handleScrollToSource,
}: MessageListProps) => {
  return (
    <div ref={messagesContainerRef} class="chatbox-messages">
      {/* Embedding generation indicator */}
      <div class={`chatbox-embedding-indicator ${isGeneratingEmbeddings && !hasEmbeddings && activeTab?.type === 'paper' ? 'visible' : ''}`}>
        <LottiePlayer
          path={chrome.runtime.getURL('lotties/kuma-thinking-glasses.lottie')}
          size={40}
          autoStartLoop={true}
          loopPurpose={LoopPurpose.QASection}
        />
        <span>
          {embeddingProgress || 'Kuma is still digesting the information from this paper - answers may be limited until he\'s ready'}
        </span>
      </div>

      {messages.length === 0 && !isStreaming && (
        <div class="chatbox-empty">
          <svg class="w-12 h-12 mb-4 opacity-20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
          </svg>
          <p class="text-sm opacity-50">
            {disabled
              ? 'No paper loaded. Navigate to a research paper to start chatting.'
              : 'Start a conversation with Kuma about this paper!'}
          </p>
        </div>
      )}

      {messages.map((msg, idx) => (
        <div
          key={idx}
          class={`chatbox-message ${msg.role === 'user' ? 'chatbox-message-user' : 'chatbox-message-assistant'}`}
        >
          <div class="chatbox-message-role">
            {msg.role === 'user' ? 'You' : 'Kuma'}
          </div>
          <div class="chatbox-message-content">
            {msg.content === '___LOADING_EXPLANATION___' ? (
              <div style="display: flex; flex-direction: column; align-items: center; gap: 8px;">
                <LottiePlayer
                  path={chrome.runtime.getURL('lotties/kuma-thinking-glasses.lottie')}
                  size={60}
                  autoStartLoop={true}
                  loopPurpose={LoopPurpose.QASection}
                />
                <span style="font-size: 13px; color: #6b7280;">Kuma is analyzing the image...</span>
              </div>
            ) : (
              <>
                {/* Show thumbnail for first message in image tabs */}
                {idx === 0 && msg.role === 'assistant' && activeTab?.type === 'image' && (screenCaptureUrl || activeTab?.imageUrl) && (
                  <img
                    src={screenCaptureUrl || activeTab.imageUrl}
                    alt="Explained image"
                    class="chatbox-image-thumbnail"
                    title={isPdfCapture ? "PDF capture" : "Click to scroll to this image in the page"}
                    onClick={isPdfCapture ? undefined : onScrollToImage}
                    onError={(e) => {
                      // Hide image if it fails to load
                      (e.target as HTMLElement).style.display = 'none';
                    }}
                  />
                )}
                <MarkdownRenderer content={msg.content} />
              </>
            )}
          </div>
          {msg.sources && msg.sources.length > 0 && (
            <div class="chatbox-message-sources">
              <button
                class="chatbox-sources-header"
                onClick={() => toggleSourceExpansion(idx)}
                aria-expanded={expandedSources.has(idx)}
              >
                <span class="chatbox-sources-label">
                  Sources ({msg.sources.length})
                </span>
                <svg
                  class={`chatbox-sources-chevron ${expandedSources.has(idx) ? 'expanded' : ''}`}
                  width="12"
                  height="12"
                  viewBox="0 0 12 12"
                  fill="none"
                >
                  <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </button>
              {expandedSources.has(idx) && (
                <ul class="chatbox-sources-list">
                  {msg.sources.map((source, sourceIdx) => {
                    // Normalize source text by stripping paragraph numbers for lookup
                    // E.g., "Section: I Introduction > P 2" → "Section: I Introduction"
                    const normalizedSource = source.replace(/\s*>\s*P\s+\d+(\s*>\s*Sentences)?$/, '');
                    const sourceInfo = msg.sourceInfo?.find(info => info.text === normalizedSource);
                    // Make clickable if we have ANY way to locate the source (CSS selector, ID, XPath, or section heading for text search)
                    const isClickable = sourceInfo?.cssSelector || sourceInfo?.elementId || sourceInfo?.xPath || sourceInfo?.sectionHeading;

                    return (
                      <li
                        key={sourceIdx}
                        class={`chatbox-sources-item ${isClickable ? 'clickable' : ''}`}
                        onClick={isClickable ? () => handleScrollToSource(sourceInfo) : undefined}
                        style={isClickable ? { cursor: 'pointer' } : {}}
                        title={isClickable ? 'Click to scroll to this section' : undefined}
                      >
                        {source}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
          {/* Regenerate button for first message in image tabs */}
          {idx === 0 && msg.role === 'assistant' && msg.content !== '___LOADING_EXPLANATION___' && activeTab?.type === 'image' && onRegenerateExplanation && (
            <button
              class="chatbox-regenerate-btn"
              onClick={onRegenerateExplanation}
              disabled={isRegenerating || isStreaming}
              title={isRegenerating ? "Regenerating..." : "Regenerate explanation"}
            >
              {isRegenerating ? (
                <>
                  <svg class="chatbox-regenerate-spinner" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                    <circle cx="12" cy="12" r="10" opacity="0.25"/>
                    <path d="M12 2a10 10 0 0 1 10 10" stroke-linecap="round"/>
                  </svg>
                  Regenerating...
                </>
              ) : (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
                  </svg>
                  Regenerate explanation
                </>
              )}
            </button>
          )}
        </div>
      ))}

      {isStreaming && (
        <div class="chatbox-message chatbox-message-assistant">
          <div class="chatbox-message-role">Kuma</div>
          <div class="chatbox-message-content">
            {streamingMessage.trim() === '' ? (
              <LottiePlayer
                path={chrome.runtime.getURL('lotties/kuma-thinking.lottie')}
                size={40}
                autoStartLoop={true}
                loopPurpose={LoopPurpose.QASection}
              />
            ) : (
              <>
                <MarkdownRenderer content={streamingMessage} />
                <span class="chatbox-cursor">▊</span>
              </>
            )}
          </div>
        </div>
      )}

      <div ref={messagesEndRef} />
    </div>
  );
};
