import { useEffect, useRef } from 'preact/hooks';
import { ChatMessage, ChatboxPosition } from '../../shared/types/index.ts';

interface UseScrollManagementOptions {
  isMinimized: boolean;
  messages: ChatMessage[];
  isStreaming: boolean;
  streamingMessage: string;
  activeTabId: string;
  position: ChatboxPosition;
  messagesContainerRef: { current: HTMLDivElement | null };
  messagesEndRef: { current: HTMLDivElement | null };
}

interface UseScrollManagementReturn {
  checkIsNearBottom: () => boolean;
  scrollToBottom: (behavior?: 'smooth' | 'instant') => void;
}

/**
 * Custom hook for managing chatbox scroll behavior
 *
 * Features:
 * - Auto-scroll to bottom when new messages arrive (only if user is near bottom)
 * - Force scroll to bottom when streaming ends
 * - Track scroll position and near-bottom state continuously
 * - Restore scroll position when maximizing
 * - Scroll to bottom when switching tabs
 * - Maintain scroll at bottom when resizing (if user was near bottom)
 */
export function useScrollManagement({
  isMinimized,
  messages,
  isStreaming,
  streamingMessage,
  activeTabId,
  position,
  messagesContainerRef,
  messagesEndRef,
}: UseScrollManagementOptions): UseScrollManagementReturn {
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

  // Scroll to bottom when switching tabs (ensures DOM has rendered new messages)
  useEffect(() => {
    if (!isMinimized && messagesContainerRef.current) {
      const timer = setTimeout(() => {
        scrollToBottom('instant');
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [activeTabId, isMinimized]);

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

  return {
    checkIsNearBottom,
    scrollToBottom,
  };
}
