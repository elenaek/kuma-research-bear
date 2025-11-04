import { h } from 'preact';
import { AlertCircle } from 'lucide-preact';
import { ChatTab } from '../../../shared/types/index.ts';

interface ChatInputProps {
  inputValue: string;
  disabled: boolean;
  isStreaming: boolean;
  isGeneratingEmbeddings?: boolean;
  hasEmbeddings?: boolean;
  embeddingProgress?: string;
  activeTab?: ChatTab;
  inputRef: { current: HTMLTextAreaElement | null };
  handleInputChange: (e: Event) => void;
  handleKeyDown: (e: KeyboardEvent) => void;
  handleClearInput: () => void;
  handleSend: () => void;
}

/**
 * Chat input component with textarea, send button, and embedding disclaimer
 */
export const ChatInput = ({
  inputValue,
  disabled,
  isStreaming,
  isGeneratingEmbeddings,
  hasEmbeddings,
  embeddingProgress,
  activeTab,
  inputRef,
  handleInputChange,
  handleKeyDown,
  handleClearInput,
  handleSend,
}: ChatInputProps) => {
  return (
    <>
      {/* Embedding disclaimer above input */}
      <div class={`chatbox-input-disclaimer ${isGeneratingEmbeddings && !hasEmbeddings && activeTab?.type === 'paper' ? 'visible' : ''}`}>
        <AlertCircle size={14} />
        <span>Kuma is still digesting the information from this paper - answers may be limited until he's ready</span>
      </div>

      {/* Input area */}
      <div class="chatbox-input-container">
        <div class="chatbox-input-wrapper">
          <textarea
            ref={inputRef}
            class="chatbox-input"
            value={inputValue}
            onInput={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder={disabled ? 'Load a paper to start chatting...' : 'Ask about this paper...'}
            disabled={disabled}
            rows={1}
          />
          {inputValue.trim() && !disabled && (
            <button
              class="chatbox-input-clear-btn"
              onClick={handleClearInput}
              title="Clear input"
              type="button"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
        <button
          class="chatbox-send-btn"
          onClick={handleSend}
          disabled={disabled || !inputValue.trim() || isStreaming}
          title={disabled ? 'Load a paper first' : 'Send message'}
        >
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
          </svg>
        </button>
      </div>
    </>
  );
};
