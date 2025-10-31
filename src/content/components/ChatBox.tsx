import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import { ChatMessage, ChatboxPosition, ChatTab, SourceInfo } from '../../types/index.ts';
import { MarkdownRenderer } from '../../components/MarkdownRenderer.tsx';
import { LottiePlayer, LoopPurpose } from '../../shared/components/LottiePlayer.tsx';
import { AlertCircle } from 'lucide-preact';

interface ChatBoxProps {
  tabs: ChatTab[];
  activeTabId: string;
  compassArrowAngle?: number; // Angle for compass arrow (image tabs only)
  onSwitchTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;

  // Active tab messages
  messages: ChatMessage[];
  isStreaming: boolean;
  streamingMessage: string;

  // Message handlers
  onSendMessage: (message: string) => void;
  onClearMessages: () => void;
  onRegenerateExplanation?: () => void;
  isRegenerating?: boolean;
  onScrollToImage?: () => void;

  // Window controls
  onClose: () => void;
  onMinimize: () => void;
  isMinimized: boolean;

  // Position
  initialPosition: ChatboxPosition;
  onPositionChange: (position: ChatboxPosition, shouldSave?: boolean) => void;

  // State
  disabled: boolean; // Disable when no paper is ready
  paperTitle?: string;
  hasPaper: boolean;
  hasChunked: boolean;
  isGeneratingEmbeddings?: boolean; // Track if embeddings are being generated
  hasEmbeddings?: boolean; // Track if embeddings have been generated
  embeddingProgress?: string; // Progress message for embedding generation

  // Transparency
  transparencyEnabled: boolean;
  onToggleTransparency: () => void;
  hasInteractedSinceOpen: boolean;
  onFirstInteraction: () => void;

  // Initial input
  initialInputValue?: string;
}

export const ChatBox = ({
  // Multi-tab props
  tabs,
  activeTabId,
  compassArrowAngle,
  onSwitchTab,
  onCloseTab,

  // Active tab messages
  messages,
  isStreaming,
  streamingMessage,

  // Message handlers
  onSendMessage,
  onClearMessages,
  onRegenerateExplanation,
  isRegenerating,
  onScrollToImage,

  // Window controls
  onClose,
  onMinimize,
  isMinimized,

  // Position
  initialPosition,
  onPositionChange,

  // State
  disabled,
  paperTitle,
  hasPaper,
  hasChunked,
  isGeneratingEmbeddings,
  hasEmbeddings,
  embeddingProgress,

  // Transparency
  transparencyEnabled,
  onToggleTransparency,
  hasInteractedSinceOpen,
  onFirstInteraction,

  // Initial input
  initialInputValue
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
  const [showTabCloseModal, setShowTabCloseModal] = useState(false);
  const [tabToClose, setTabToClose] = useState<string | null>(null);
  const [dragTimer, setDragTimer] = useState<number | null>(null);
  const [dragStartPos, setDragStartPos] = useState<{ x: number; y: number } | null>(null);
  const [expandedSources, setExpandedSources] = useState<Set<number>>(new Set()); // Track which message indices have sources expanded
  const [isOnPdfPage] = useState<boolean>(() => {
    // Detect PDF page on mount
    // Check 1: document contentType
    if (document.contentType === 'application/pdf') return true;
    // Check 2: URL ends with .pdf
    if (window.location.href.match(/\.pdf(\?|#|$)/i)) return true;
    // Check 3: Check for PDF embed elements
    const pdfEmbed = document.querySelector('embed[type="application/pdf"]');
    if (pdfEmbed) return true;
    return false;
  });

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

  // Toggle source expansion for a specific message
  const toggleSourceExpansion = (messageIndex: number) => {
    setExpandedSources(prev => {
      const newSet = new Set(prev);
      if (newSet.has(messageIndex)) {
        newSet.delete(messageIndex);
      } else {
        newSet.add(messageIndex);
      }
      return newSet;
    });
  };

  // Scroll to source on the page with highlight effect (hybrid approach with fallback)
  const handleScrollToSource = (sourceInfo: SourceInfo | undefined) => {
    if (!sourceInfo) return;

    let element: Element | null = null;

    // Try 1: CSS selector
    if (sourceInfo.cssSelector) {
      try {
        element = document.querySelector(sourceInfo.cssSelector);
        console.log('[ScrollToSource] CSS selector found element:', !!element);
      } catch (e) {
        console.warn('[ScrollToSource] Invalid CSS selector:', sourceInfo.cssSelector, e);
      }
    }

    // Try 2: Element ID (direct lookup)
    if (!element && sourceInfo.elementId) {
      element = document.getElementById(sourceInfo.elementId);
      console.log('[ScrollToSource] Element ID found element:', !!element);
    }

    // Try 3: XPath
    if (!element && sourceInfo.xPath) {
      try {
        const xpathResult = document.evaluate(
          sourceInfo.xPath,
          document,
          null,
          XPathResult.FIRST_ORDERED_NODE_TYPE,
          null
        );
        element = xpathResult.singleNodeValue as Element | null;
        console.log('[ScrollToSource] XPath found element:', !!element);
      } catch (e) {
        console.warn('[ScrollToSource] Invalid XPath:', sourceInfo.xPath, e);
      }
    }

    // Try 4: Text search fallback (search for section heading text)
    if (!element && sourceInfo.sectionHeading) {
      console.log('[ScrollToSource] Falling back to text search for:', sourceInfo.sectionHeading);
      element = findElementByText(sourceInfo.sectionHeading);
      console.log('[ScrollToSource] Text search found element:', !!element);
    }

    // If we found an element, scroll to it and highlight
    if (element && element instanceof HTMLElement) {
      // Scroll into view
      element.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
        inline: 'center'
      });

      // Apply highlight effect (same as image scroll)
      const originalOutline = element.style.outline;
      const originalOutlineOffset = element.style.outlineOffset;

      element.style.outline = '3px solid #60a5fa';
      element.style.outlineOffset = '2px';

      setTimeout(() => {
        element!.style.outline = originalOutline;
        element!.style.outlineOffset = originalOutlineOffset;
      }, 2000);

      console.log('[ScrollToSource] Successfully scrolled to and highlighted element');
    } else {
      console.log('[ScrollToSource] Could not find element for source:', sourceInfo.text);
    }
  };

  // Helper function to find an element by text content (for fallback)
  const findElementByText = (text: string): HTMLElement | null => {
    // Search through all headings first (most likely to be section headings)
    const headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
    for (const heading of Array.from(headings)) {
      if (heading.textContent?.trim() === text.trim()) {
        return heading as HTMLElement;
      }
    }

    // If not found in headings, search all text nodes (slower but more thorough)
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      null
    );

    let node: Node | null;
    while ((node = walker.nextNode())) {
      if (node.textContent?.trim() === text.trim()) {
        return node.parentElement;
      }
    }

    return null;
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

  // Scroll to bottom when switching tabs (ensures DOM has rendered new messages)
  useEffect(() => {
    if (!isMinimized && messagesContainerRef.current) {
      const timer = setTimeout(() => {
        scrollToBottom('instant');
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [activeTabId, isMinimized]);

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

  // Handle initial input value from text selection
  useEffect(() => {
    if (initialInputValue && initialInputValue !== inputValue) {
      setInputValue(initialInputValue);

      // Auto-resize textarea to fit content
      if (inputRef.current) {
        inputRef.current.style.height = 'auto';
        inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, 120) + 'px';
      }

      // Focus the input so user can immediately edit or send
      const timer = setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
          // Place cursor at end of text
          inputRef.current.setSelectionRange(initialInputValue.length, initialInputValue.length);
        }
      }, 150);

      return () => clearTimeout(timer);
    }
  }, [initialInputValue]);

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

  // Handle mouse down on header or tab bar for dragging
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

  // Handle long press on tab to initiate drag
  const handleTabMouseDown = (e: MouseEvent) => {
    e.stopPropagation(); // Prevent immediate drag from parent

    const startX = e.clientX;
    const startY = e.clientY;
    setDragStartPos({ x: startX, y: startY });

    // Start timer for long press (500ms)
    const timer = window.setTimeout(() => {
      // Start dragging after delay
      setIsDragging(true);
      setDragOffset({
        x: e.clientX - position.x,
        y: e.clientY - position.y,
      });
      setDragTimer(null);
    }, 500);

    setDragTimer(timer);
  };

  // Clean up timer on mouse up or mouse leave
  const handleTabMouseUp = () => {
    if (dragTimer) {
      clearTimeout(dragTimer);
      setDragTimer(null);
    }
    setDragStartPos(null);
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
        // Use actual rendered dimensions (handles minimized vs expanded state)
        const actualWidth = chatboxRef.current?.getBoundingClientRect().width ?? position.width;
        const actualHeight = chatboxRef.current?.getBoundingClientRect().height ?? position.height;
        const maxX = window.innerWidth - actualWidth;
        const maxY = window.innerHeight - actualHeight;

        const newPosition = {
          ...position,
          x: Math.max(0, Math.min(newX, maxX)),
          y: Math.max(0, Math.min(newY, maxY)),
        };

        setPosition(newPosition);
        // Update compass in real-time during drag without saving to storage
        onPositionChange(newPosition, false);
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
        // Update compass in real-time during resize without saving to storage
        onPositionChange(newPosition, false);
      }
    };

    const handleMouseUp = () => {
      if (isDragging || isResizing) {
        // Save final position to storage on mouseup
        onPositionChange(position, true);
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

  // Clean up drag timer on unmount
  useEffect(() => {
    return () => {
      if (dragTimer) {
        clearTimeout(dragTimer);
      }
    };
  }, [dragTimer]);

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

  // Clear input handler
  const handleClearInput = () => {
    setInputValue('');
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      inputRef.current.focus();
    }
  };

  // Tab close handlers
  const handleTabCloseClick = (tabId: string, e: Event) => {
    e.stopPropagation();
    // Cannot close paper tab
    if (tabId === 'paper') {
      return;
    }
    setTabToClose(tabId);
    setShowTabCloseModal(true);
  };

  const confirmTabClose = () => {
    if (tabToClose) {
      onCloseTab(tabToClose);
    }
    setShowTabCloseModal(false);
    setTabToClose(null);
  };

  const cancelTabClose = () => {
    setShowTabCloseModal(false);
    setTabToClose(null);
  };

  // Get active tab
  const activeTab = tabs.find(t => t.id === activeTabId);

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
            {/* Compass arrow for image tabs (even when minimized) */}
            {activeTab && activeTab.type === 'image' && compassArrowAngle !== undefined && (
              <svg
                class="chatbox-compass-arrow"
                width="20"
                height="20"
                viewBox="0 0 20 20"
                fill="currentColor"
                style={{
                  transform: `rotate(${compassArrowAngle}deg)`,
                  flexShrink: 0,
                }}
                title="Points to source image"
              >
                <path
                  d="M 17 10 L 5 3 L 11 10 L 5 17 Z"
                  fill="currentColor"
                />
              </svg>
            )}
            <img
              src={chrome.runtime.getURL('icons/icon32.png')}
              class="w-5 h-5"
              alt="Kuma icon"
            />
            <div class="flex-1 min-w-0">
              <div class="font-medium">Kuma Chat</div>
              {activeTab && activeTab.type === 'image' && activeTab.title && (
                <div class="text-xs opacity-60 truncate">{activeTab.title}</div>
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

      {/* Transparent overlay for PDF pages - captures mouse events during drag/resize */}
      {(isDragging || isResizing) && isOnPdfPage && (
        <div
          class="drag-resize-overlay"
          style={{
            cursor: isDragging ? 'move' : resizeDirection ? `${resizeDirection}-resize` : 'default',
          }}
        />
      )}

      {/* Tab Bar (NEW - Multi-tab support) */}
      {tabs.length > 1 && (
        <div
          class="chatbox-tab-bar"
          onMouseDown={handleDragStart}
          style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
        >
          <div class="chatbox-tabs">
            {tabs.map(tab => (
              <div
                key={tab.id}
                class={`chatbox-tab ${tab.id === activeTabId ? 'chatbox-tab-active' : ''}`}
                onClick={() => onSwitchTab(tab.id)}
                onMouseDown={(e) => handleTabMouseDown(e as any)}
                onMouseUp={handleTabMouseUp}
                onMouseLeave={handleTabMouseUp}
              >
                <span class="chatbox-tab-title">{tab.title}</span>
                {tab.type === 'image' && (
                  <button
                    class="chatbox-tab-close"
                    onClick={(e) => handleTabCloseClick(tab.id, e)}
                    title="Close tab"
                    aria-label="Close tab"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Header */}
      <div
        class="chatbox-header"
        onMouseDown={handleDragStart}
      >
        <div class="flex items-center gap-2 flex-1 min-w-0" style={{margin: '5px'}}>
          {/* Compass arrow for image tabs */}
          {activeTab && activeTab.type === 'image' && compassArrowAngle !== undefined && (
            <svg
              class="chatbox-compass-arrow"
              width="20"
              height="20"
              viewBox="0 0 20 20"
              fill="currentColor"
              style={{
                transform: `rotate(${compassArrowAngle}deg)`,
                flexShrink: 0,
              }}
              title="Points to source image"
            >
              <path
                d="M 17 10 L 5 3 L 11 10 L 5 17 Z"
                fill="currentColor"
              />
            </svg>
          )}
          <img
            src={chrome.runtime.getURL('icons/icon32.png')}
            class="w-xl h-xl flex-shrink-0"
            alt="Kuma icon"
          />
          <div class="flex-1 min-w-0">
            <div class="font-medium">Kuma Chat</div>
            {paperTitle && (
              <div class="text-xs opacity-75 truncate">{paperTitle}</div>
            )}
            {activeTab && activeTab.type === 'image' && activeTab.title && (
              <div class="text-xs opacity-60 truncate">{activeTab.title}</div>
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
          {/* Scroll to image button - only for image tabs */}
          {activeTab && activeTab.type === 'image' && onScrollToImage && (
            <button
              class="chatbox-control-btn"
              onClick={onScrollToImage}
              title="Scroll page to show this image"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </button>
          )}
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
                  {idx === 0 && msg.role === 'assistant' && activeTab?.type === 'image' && activeTab?.imageUrl && (
                    <img
                      src={activeTab.imageUrl}
                      alt="Explained image"
                      class="chatbox-image-thumbnail"
                      title="Click to scroll to this image in the page"
                      onClick={onScrollToImage}
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

      {/* Tab close confirmation modal (NEW) */}
      {showTabCloseModal && (
        <div class="modal-overlay" onClick={cancelTabClose}>
          <div class="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <div class="modal-header">Close Tab</div>
            <div class="modal-body">
              Are you sure you want to close this tab? All chat history for this image will be permanently deleted.
            </div>
            <div class="modal-footer">
              <button class="modal-btn modal-btn-cancel" onClick={cancelTabClose}>
                Cancel
              </button>
              <button class="modal-btn modal-btn-confirm" onClick={confirmTabClose}>
                Close Tab
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
