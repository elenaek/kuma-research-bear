import { logger } from '../../shared/utils/logger.ts';
import { SourceInfo } from '../../shared/types/index.ts';

interface UseMessageHandlingOptions {
  inputValue: string;
  setInputValue: (value: string) => void;
  setShowClearModal: (show: boolean) => void;
  setShowTabCloseModal: (show: boolean) => void;
  setTabToClose: (tabId: string | null) => void;
  setExpandedSources: (update: (prev: Set<number>) => Set<number>) => void;
  disabled: boolean;
  isStreaming: boolean;
  onSendMessage: (message: string) => void;
  onClearMessages: () => void;
  onCloseTab: (tabId: string) => void;
  inputRef: { current: HTMLTextAreaElement | null };
  scrollToBottom: (behavior?: 'smooth' | 'instant') => void;
}

interface UseMessageHandlingReturn {
  handleSend: () => void;
  handleClearMessages: () => void;
  handleConfirmClear: () => void;
  handleCancelClear: () => void;
  handleKeyDown: (e: KeyboardEvent) => void;
  handleInputChange: (e: Event) => void;
  handleClearInput: () => void;
  handleTabCloseClick: (tabId: string, e: Event) => void;
  confirmTabClose: () => void;
  cancelTabClose: () => void;
  toggleSourceExpansion: (messageIndex: number) => void;
  handleScrollToSource: (sourceInfo: SourceInfo | undefined) => void;
}

/**
 * Custom hook for handling chatbox messages and input
 *
 * Features:
 * - Send message handling (with scroll to bottom)
 * - Input change and clear handlers
 * - Clear messages confirmation flow
 * - Tab close confirmation flow
 * - Source expansion toggle
 * - Scroll to source on page (with highlighting)
 * - Keyboard shortcuts (Enter to send)
 * - Auto-resize textarea
 */
export function useMessageHandling({
  inputValue,
  setInputValue,
  setShowClearModal,
  setShowTabCloseModal,
  setTabToClose,
  setExpandedSources,
  disabled,
  isStreaming,
  onSendMessage,
  onClearMessages,
  onCloseTab,
  inputRef,
  scrollToBottom,
}: UseMessageHandlingOptions): UseMessageHandlingReturn {

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
    setTabToClose((currentTabToClose) => {
      if (currentTabToClose) {
        onCloseTab(currentTabToClose);
      }
      return null;
    });
    setShowTabCloseModal(false);
  };

  const cancelTabClose = () => {
    setShowTabCloseModal(false);
    setTabToClose(null);
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
        logger.debug('CHATBOX', 'CSS selector found element:', !!element);
      } catch (e) {
        logger.warn('CHATBOX', 'Invalid CSS selector:', sourceInfo.cssSelector, e);
      }
    }

    // Try 2: Element ID (direct lookup)
    if (!element && sourceInfo.elementId) {
      element = document.getElementById(sourceInfo.elementId);
      logger.debug('CHATBOX', 'Element ID found element:', !!element);
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
        logger.debug('CHATBOX', 'XPath found element:', !!element);
      } catch (e) {
        logger.warn('CHATBOX', 'Invalid XPath:', sourceInfo.xPath, e);
      }
    }

    // Try 4: Text search fallback (search for section heading text)
    if (!element && sourceInfo.sectionHeading) {
      logger.debug('CHATBOX', 'Falling back to text search for:', sourceInfo.sectionHeading);
      element = findElementByText(sourceInfo.sectionHeading);
      logger.debug('CHATBOX', 'Text search found element:', !!element);
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

      logger.debug('CHATBOX', 'Successfully scrolled to and highlighted element');
    } else {
      logger.debug('CHATBOX', 'Could not find element for source:', sourceInfo.text);
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

  return {
    handleSend,
    handleClearMessages,
    handleConfirmClear,
    handleCancelClear,
    handleKeyDown,
    handleInputChange,
    handleClearInput,
    handleTabCloseClick,
    confirmTabClose,
    cancelTabClose,
    toggleSourceExpansion,
    handleScrollToSource,
  };
}
