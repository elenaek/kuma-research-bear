import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import { ChatMessage, ChatboxPosition } from '../../types/index.ts';
import { MarkdownRenderer } from '../../components/MarkdownRenderer.tsx';

interface ChatBoxProps {
  messages: ChatMessage[];
  isStreaming: boolean;
  streamingMessage: string;
  onSendMessage: (message: string) => void;
  onClearMessages: () => void;
  onClose: () => void;
  onMinimize: () => void;
  isMinimized: boolean;
  initialPosition: ChatboxPosition;
  onPositionChange: (position: ChatboxPosition) => void;
  disabled: boolean; // Disable when no paper is ready
  paperTitle?: string;
  hasPaper: boolean;
  hasChunked: boolean;
  transparencyEnabled: boolean;
  onToggleTransparency: () => void;
  hasInteractedSinceOpen: boolean;
  onFirstInteraction: () => void;
}

export const ChatBox = ({
  messages,
  isStreaming,
  streamingMessage,
  onSendMessage,
  onClearMessages,
  onClose,
  onMinimize,
  isMinimized,
  initialPosition,
  onPositionChange,
  disabled,
  paperTitle,
  hasPaper,
  hasChunked,
  transparencyEnabled,
  onToggleTransparency,
  hasInteractedSinceOpen,
  onFirstInteraction
}: ChatBoxProps) => {
  const [inputValue, setInputValue] = useState('');
  const [position, setPosition] = useState(initialPosition);
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [resizeDirection, setResizeDirection] = useState<string | null>(null);
  const [isHovered, setIsHovered] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [showClearModal, setShowClearModal] = useState(false);

  const chatboxRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const savedScrollPosition = useRef<number | null>(null);
  const isUserNearBottomRef = useRef(true); // Start true (initially at bottom)

  // Threshold for "near bottom" detection (in pixels)
  const SCROLL_NEAR_BOTTOM_THRESHOLD = 100;

  // Helper to check if user is near bottom of scroll
  const checkIsNearBottom = (): boolean => {
    if (!messagesContainerRef.current) return false;
    const container = messagesContainerRef.current;
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    return distanceFromBottom < SCROLL_NEAR_BOTTOM_THRESHOLD;
  };

  // Helper to scroll to bottom
  const scrollToBottom = (behavior: 'smooth' | 'instant' = 'smooth') => {
    messagesEndRef.current?.scrollIntoView({ behavior });
  };

  // Auto-scroll to bottom when new messages arrive (only if already near bottom)
  useEffect(() => {
    if (messagesContainerRef.current) {
      const isNearBottom = checkIsNearBottom();

      // Only auto-scroll if user is already near the bottom
      if (isNearBottom) {
        scrollToBottom('smooth');
      }
    }
  }, [messages, streamingMessage]);

  // Force scroll to bottom when streaming ends (after DOM settles)
  useEffect(() => {
    if (!isStreaming && messages.length > 0) {
      // Delay ensures DOM has fully updated after streaming->final message transition
      const timer = setTimeout(() => {
        scrollToBottom('smooth');
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [isStreaming]);

  // Track scroll position and near-bottom state continuously
  useEffect(() => {
    if (!isMinimized && messagesContainerRef.current) {
      const container = messagesContainerRef.current;

      const handleScroll = () => {
        savedScrollPosition.current = container.scrollTop;
        isUserNearBottomRef.current = checkIsNearBottom(); // Track near-bottom state
      };

      container.addEventListener('scroll', handleScroll);

      // Set initial state
      isUserNearBottomRef.current = checkIsNearBottom();

      return () => {
        container.removeEventListener('scroll', handleScroll);
      };
    }
  }, [isMinimized]);

  // Restore scroll position when maximizing, or scroll to bottom on first open
  useEffect(() => {
    if (!isMinimized && messagesContainerRef.current) {
      // Wait for layout to complete
      const timer = setTimeout(() => {
        if (messagesContainerRef.current) {
          if (savedScrollPosition.current !== null) {
            // Restore saved position (returning from minimize)
            messagesContainerRef.current.scrollTop = savedScrollPosition.current;
          } else {
            // Scroll to bottom (first open)
            messagesEndRef.current?.scrollIntoView({ behavior: 'instant' });
          }
        }
      }, 50);

      return () => clearTimeout(timer);
    }
  }, [isMinimized]);

  // Auto-focus input when opening or maximizing
  useEffect(() => {
    if (!isMinimized && !disabled) {
      // Wait for layout to complete before focusing
      const timer = setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
        }
      }, 100); // Slightly longer delay to ensure input is fully rendered

      return () => clearTimeout(timer);
    }
  }, [isMinimized, disabled]);

  // Maintain scroll position at bottom when resizing (if user was near bottom)
  useEffect(() => {
    if (!isMinimized && messagesContainerRef.current && isUserNearBottomRef.current) {
      // Wait for layout to update after resize
      const timer = setTimeout(() => {
        if (checkIsNearBottom()) {
          // Already near bottom, ensure we stay pinned
          scrollToBottom('instant');
        } else if (isUserNearBottomRef.current) {
          // Was near bottom before resize, restore to bottom
          scrollToBottom('instant');
        }
      }, 0);

      return () => clearTimeout(timer);
    }
  }, [position.height, position.width, isMinimized]); // Trigger on size changes

  // Handle mouse down on header for dragging
  const handleDragStart = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('.chatbox-controls')) {
      return; // Don't drag when clicking controls
    }
    setIsDragging(true);
    setDragOffset({
      x: e.clientX - position.x,
      y: e.clientY - position.y,
    });
    e.preventDefault();
  };

  // Handle resize start
  const handleResizeStart = (e: MouseEvent, direction: string) => {
    setIsResizing(true);
    setResizeDirection(direction);
    e.preventDefault();
    e.stopPropagation();
  };

  // Handle mouse move for dragging and resizing
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        const newX = e.clientX - dragOffset.x;
        const newY = e.clientY - dragOffset.y;

        // Keep chatbox within viewport bounds
        const maxX = window.innerWidth - position.width;
        const maxY = window.innerHeight - position.height;

        setPosition({
          ...position,
          x: Math.max(0, Math.min(newX, maxX)),
          y: Math.max(0, Math.min(newY, maxY)),
        });
      } else if (isResizing && resizeDirection) {
        const newPosition = { ...position };

        if (resizeDirection.includes('e')) {
          newPosition.width = Math.max(300, e.clientX - position.x);
        }
        if (resizeDirection.includes('s')) {
          newPosition.height = Math.max(400, e.clientY - position.y);
        }
        if (resizeDirection.includes('w')) {
          const newWidth = Math.max(300, position.width + (position.x - e.clientX));
          newPosition.x = position.x + position.width - newWidth;
          newPosition.width = newWidth;
        }
        if (resizeDirection.includes('n')) {
          const newHeight = Math.max(400, position.height + (position.y - e.clientY));
          newPosition.y = position.y + position.height - newHeight;
          newPosition.height = newHeight;
        }

        setPosition(newPosition);
      }
    };

    const handleMouseUp = () => {
      if (isDragging || isResizing) {
        onPositionChange(position);
      }
      setIsDragging(false);
      setIsResizing(false);
      setResizeDirection(null);
    };

    if (isDragging || isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);

      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, isResizing, dragOffset, position, resizeDirection]);

  const handleSend = () => {
    if (inputValue.trim() && !disabled && !isStreaming) {
      onSendMessage(inputValue.trim());
      setInputValue('');
      if (inputRef.current) {
        inputRef.current.style.height = 'auto';
      }

      // Scroll to bottom after sending (user wants to see their message)
      setTimeout(() => scrollToBottom('smooth'), 50);
    }
  };

  const handleClearMessages = () => {
    setShowClearModal(true);
  };

  const handleConfirmClear = () => {
    setShowClearModal(false);
    onClearMessages();
  };

  const handleCancelClear = () => {
    setShowClearModal(false);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Auto-resize textarea
  const handleInputChange = (e: Event) => {
    const target = e.target as HTMLTextAreaElement;
    setInputValue(target.value);
    target.style.height = 'auto';
    target.style.height = Math.min(target.scrollHeight, 120) + 'px';
  };

  if (isMinimized) {
    return (
      <div
        ref={chatboxRef}
        class="kuma-chatbox-minimized"
        onClick={() => !hasInteractedSinceOpen && onFirstInteraction()}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        style={{
          position: 'fixed',
          left: `${position.x}px`,
          top: `${position.y}px`,
          zIndex: 2147483647,
          opacity: 1, // Never transparent when minimized
          transition: 'opacity 0.2s ease-in-out',
        }}
      >
        <div
          class="chatbox-header-minimized"
          onMouseDown={handleDragStart}
        >
          <div class="flex items-center gap-2">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
            </svg>
            <span class="font-medium">Kuma Chat</span>
          </div>
          <div class="chatbox-controls flex items-center gap-1">
            <button
              class="chatbox-control-btn"
              onClick={onToggleTransparency}
              title={transparencyEnabled ? "Disable auto-transparency" : "Enable auto-transparency"}
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {transparencyEnabled ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                )}
              </svg>
            </button>
            <button
              class="chatbox-control-btn"
              onClick={onMinimize}
              title="Maximize"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
              </svg>
            </button>
            <button
              class="chatbox-control-btn"
              onClick={onClose}
              title="Close"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={chatboxRef}
      class="kuma-chatbox"
      onClick={() => !hasInteractedSinceOpen && onFirstInteraction()}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
      style={{
        position: 'fixed',
        left: `${position.x}px`,
        top: `${position.y}px`,
        width: `${position.width}px`,
        height: `${position.height}px`,
        zIndex: 2147483647,
        opacity: (transparencyEnabled && hasInteractedSinceOpen) ? ((isHovered || isFocused || isResizing || isDragging || showClearModal) ? 1 : 0.3) : 1,
        transition: 'opacity 0.2s ease-in-out',
      }}
    >
      {/* Resize handles */}
      <div class="resize-handle resize-n" onMouseDown={(e) => handleResizeStart(e as any, 'n')} />
      <div class="resize-handle resize-s" onMouseDown={(e) => handleResizeStart(e as any, 's')} />
      <div class="resize-handle resize-e" onMouseDown={(e) => handleResizeStart(e as any, 'e')} />
      <div class="resize-handle resize-w" onMouseDown={(e) => handleResizeStart(e as any, 'w')} />
      <div class="resize-handle resize-ne" onMouseDown={(e) => handleResizeStart(e as any, 'ne')} />
      <div class="resize-handle resize-nw" onMouseDown={(e) => handleResizeStart(e as any, 'nw')} />
      <div class="resize-handle resize-se" onMouseDown={(e) => handleResizeStart(e as any, 'se')} />
      <div class="resize-handle resize-sw" onMouseDown={(e) => handleResizeStart(e as any, 'sw')} />

      {/* Header */}
      <div
        class="chatbox-header"
        onMouseDown={handleDragStart}
      >
        <div class="flex items-center gap-2 flex-1 min-w-0" style={{margin: '5px'}}>
          <svg class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
          </svg>
          <div class="flex-1 min-w-0">
            <div class="font-medium">Kuma Chat</div>
            {paperTitle && (
              <div class="text-xs opacity-75 truncate">{paperTitle}</div>
            )}
          </div>
        </div>
        <div class="chatbox-controls flex items-center gap-1">
          <button
            class="chatbox-control-btn"
            onClick={onToggleTransparency}
            title={transparencyEnabled ? "Disable auto-transparency" : "Enable auto-transparency"}
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {transparencyEnabled ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
              )}
            </svg>
          </button>
          <button
            class="chatbox-control-btn"
            onClick={handleClearMessages}
            disabled={messages.length === 0 && !isStreaming}
            title="Clear all messages"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
          <button
            class="chatbox-control-btn"
            onClick={onMinimize}
            title="Minimize"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
            </svg>
          </button>
          <button
            class="chatbox-control-btn"
            onClick={onClose}
            title="Close"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Messages area */}
      <div ref={messagesContainerRef} class="chatbox-messages">
        {messages.length === 0 && !isStreaming && (
          <div class="chatbox-empty">
            <svg class="w-12 h-12 mb-4 opacity-20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
            </svg>
            <p class="text-sm opacity-50">
              {disabled
                ? 'No paper loaded. Navigate to a research paper to start chatting.'
                : 'Start a conversation about this paper!'}
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
            <div class="chatbox-message-content"><MarkdownRenderer content={msg.content} /></div>
            {msg.sources && msg.sources.length > 0 && (
              <div class="chatbox-message-sources">
                <span class="text-xs opacity-75">{msg.sources && msg.sources.length > 0 ? "Sources: " + msg.sources.join(', ') : ''}</span>
              </div>
            )}
          </div>
        ))}

        {isStreaming && (
          <div class="chatbox-message chatbox-message-assistant">
            <div class="chatbox-message-role">Kuma</div>
            <div class="chatbox-message-content">
              <MarkdownRenderer content={streamingMessage} />
              <span class="chatbox-cursor">▊</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div class="chatbox-input-container">
        <textarea
          ref={inputRef}
          class="chatbox-input"
          value={inputValue}
          onInput={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder={disabled ? 'Load a paper to start chatting...' : 'Ask about this paper...'}
          disabled={disabled || isStreaming}
          rows={1}
        />
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

      {/* Clear messages confirmation modal */}
      {showClearModal && (
        <div class="modal-overlay" onClick={handleCancelClear}>
          <div class="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <div class="modal-header">Confirm Delete</div>
            <div class="modal-body">
              Are you sure you want to clear all messages? This cannot be undone.
            </div>
            <div class="modal-footer">
              <button class="modal-btn modal-btn-cancel" onClick={handleCancelClear}>
                Cancel
              </button>
              <button class="modal-btn modal-btn-confirm" onClick={handleConfirmClear}>
                Clear Messages
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
