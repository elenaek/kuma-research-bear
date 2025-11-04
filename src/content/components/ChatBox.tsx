import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import { ChatMessage, ChatboxPosition, ChatTab } from '../../shared/types/index.ts';
import { isPDFPage } from '../../shared/utils/contentExtractor.ts';
import { logger } from '../../shared/utils/logger.ts';

// Hooks
import { useDragResize } from '../hooks/useDragResize.ts';
import { useScrollManagement } from '../hooks/useScrollManagement.ts';
import { useMessageHandling } from '../hooks/useMessageHandling.ts';

// Components
import { ChatHeader } from './chatbox/ChatHeader.tsx';
import { TabBar } from './chatbox/TabBar.tsx';
import { MessageList } from './chatbox/MessageList.tsx';
import { ChatInput } from './chatbox/ChatInput.tsx';
import { ConfirmationModal } from './chatbox/ConfirmationModal.tsx';

interface ChatBoxProps {
  tabs: ChatTab[];
  activeTabId: string;
  compassArrowAngle?: number;
  onSwitchTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  messages: ChatMessage[];
  isStreaming: boolean;
  streamingMessage: string;
  onSendMessage: (message: string) => void;
  onClearMessages: () => void;
  onRegenerateExplanation?: () => void;
  isRegenerating?: boolean;
  onScrollToImage?: () => void;
  onClose: () => void;
  onMinimize: () => void;
  isMinimized: boolean;
  initialPosition: ChatboxPosition;
  onPositionChange: (position: ChatboxPosition, shouldSave?: boolean) => void;
  disabled: boolean;
  paperTitle?: string;
  hasPaper: boolean;
  hasChunked: boolean;
  isGeneratingEmbeddings?: boolean;
  hasEmbeddings?: boolean;
  embeddingProgress?: string;
  transparencyEnabled: boolean;
  onToggleTransparency: () => void;
  hasInteractedSinceOpen: boolean;
  onFirstInteraction: () => void;
  initialInputValue?: string;
}

export const ChatBox = ({
  tabs, activeTabId, compassArrowAngle, onSwitchTab, onCloseTab,
  messages, isStreaming, streamingMessage,
  onSendMessage, onClearMessages, onRegenerateExplanation, isRegenerating, onScrollToImage,
  onClose, onMinimize, isMinimized,
  initialPosition, onPositionChange,
  disabled, paperTitle, hasPaper, hasChunked,
  isGeneratingEmbeddings, hasEmbeddings, embeddingProgress,
  transparencyEnabled, onToggleTransparency,
  hasInteractedSinceOpen, onFirstInteraction,
  initialInputValue
}: ChatBoxProps) => {
  // Local UI state
  const [inputValue, setInputValue] = useState('');
  const [isHovered, setIsHovered] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [showClearModal, setShowClearModal] = useState(false);
  const [showTabCloseModal, setShowTabCloseModal] = useState(false);
  const [tabToClose, setTabToClose] = useState<string | null>(null);
  const [expandedSources, setExpandedSources] = useState<Set<number>>(new Set());
  const [isOnPdfPage] = useState<boolean>(() => isPDFPage());
  const [screenCaptureUrl, setScreenCaptureUrl] = useState<string | null>(null);

  // Refs
  const chatboxRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Custom hooks
  const {
    position, isDragging, isResizing, resizeDirection,
    handleDragStart, handleTabMouseDown, handleTabMouseUp, handleResizeStart,
  } = useDragResize({ initialPosition, onPositionChange, chatboxRef });

  const { checkIsNearBottom, scrollToBottom } = useScrollManagement({
    isMinimized, messages, isStreaming, streamingMessage, activeTabId, position,
    messagesContainerRef, messagesEndRef,
  });

  const {
    handleSend, handleClearMessages, handleConfirmClear, handleCancelClear,
    handleKeyDown, handleInputChange, handleClearInput,
    handleTabCloseClick, confirmTabClose, cancelTabClose,
    toggleSourceExpansion, handleScrollToSource,
  } = useMessageHandling({
    inputValue, setInputValue, setShowClearModal, setShowTabCloseModal,
    setTabToClose, setExpandedSources, disabled, isStreaming,
    onSendMessage, onClearMessages, onCloseTab, inputRef, scrollToBottom,
  });

  // Create object URL for PDF capture thumbnails
  useEffect(() => {
    const activeTab = tabs.find(t => t.id === activeTabId);
    if (screenCaptureUrl) {
      URL.revokeObjectURL(screenCaptureUrl);
      setScreenCaptureUrl(null);
    }
    if (activeTab?.type === 'image' &&
        (activeTab?.imageUrl?.startsWith('pdf-capture-') ||
          activeTab?.imageUrl?.startsWith('screen-capture-')) &&
        activeTab?.imageBlob) {
      const objectUrl = URL.createObjectURL(activeTab.imageBlob);
      setScreenCaptureUrl(objectUrl);
    }
    return () => {
      if (screenCaptureUrl) URL.revokeObjectURL(screenCaptureUrl);
    };
  }, [activeTabId, tabs]);

  // Auto-focus input when opening or maximizing
  useEffect(() => {
    if (!isMinimized && !disabled) {
      const timer = setTimeout(() => {
        if (inputRef.current) inputRef.current.focus();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [isMinimized, disabled]);

  // Handle initial input value from text selection
  useEffect(() => {
    if (initialInputValue && initialInputValue !== inputValue) {
      setInputValue(initialInputValue);
      if (inputRef.current) {
        inputRef.current.style.height = 'auto';
        inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, 120) + 'px';
      }
      const timer = setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
          inputRef.current.setSelectionRange(initialInputValue.length, initialInputValue.length);
        }
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [initialInputValue]);

  // Get active tab
  const activeTab = tabs.find(t => t.id === activeTabId);
  const isPdfCapture = activeTab?.type === 'image' && isOnPdfPage;

  // Debug logging
  if (activeTab?.type === 'image') {
    logger.debug('CHATBOX', 'Image tab detected:', {
      imageUrl: activeTab.imageUrl, isPdfPage: isOnPdfPage,
      isPdfCapture, hasCompassAngle: compassArrowAngle !== undefined,
    });
  }

  // Minimized view
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
          opacity: 1,
          transition: 'opacity 0.2s ease-in-out',
        }}
      >
        <ChatHeader
          isMinimized={true}
          paperTitle={paperTitle}
          activeTab={activeTab}
          isPdfCapture={isPdfCapture}
          compassArrowAngle={compassArrowAngle}
          transparencyEnabled={transparencyEnabled}
          messagesCount={messages.length}
          isStreaming={isStreaming}
          onToggleTransparency={onToggleTransparency}
          onScrollToImage={onScrollToImage}
          onClearMessages={handleClearMessages}
          onMinimize={onMinimize}
          onClose={onClose}
          handleDragStart={handleDragStart}
        />
      </div>
    );
  }

  // Expanded view
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
        opacity: (transparencyEnabled && hasInteractedSinceOpen) ?
          ((isHovered || isFocused || isResizing || isDragging || showClearModal) ? 1 : 0.3) : 1,
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

      {/* Transparent overlay for PDF pages */}
      {(isDragging || isResizing) && isOnPdfPage && (
        <div
          class="drag-resize-overlay"
          style={{
            cursor: isDragging ? 'move' : resizeDirection ? `${resizeDirection}-resize` : 'default',
          }}
        />
      )}

      {/* Tab Bar */}
      <TabBar
        tabs={tabs}
        activeTabId={activeTabId}
        isDragging={isDragging}
        onSwitchTab={onSwitchTab}
        handleDragStart={handleDragStart}
        handleTabMouseDown={handleTabMouseDown}
        handleTabMouseUp={handleTabMouseUp}
        handleTabCloseClick={handleTabCloseClick}
      />

      {/* Header */}
      <ChatHeader
        isMinimized={false}
        paperTitle={paperTitle}
        activeTab={activeTab}
        isPdfCapture={isPdfCapture}
        compassArrowAngle={compassArrowAngle}
        transparencyEnabled={transparencyEnabled}
        messagesCount={messages.length}
        isStreaming={isStreaming}
        onToggleTransparency={onToggleTransparency}
        onScrollToImage={onScrollToImage}
        onClearMessages={handleClearMessages}
        onMinimize={onMinimize}
        onClose={onClose}
        handleDragStart={handleDragStart}
      />

      {/* Messages area */}
      <MessageList
        messages={messages}
        isStreaming={isStreaming}
        streamingMessage={streamingMessage}
        disabled={disabled}
        isGeneratingEmbeddings={isGeneratingEmbeddings}
        hasEmbeddings={hasEmbeddings}
        embeddingProgress={embeddingProgress}
        activeTab={activeTab}
        screenCaptureUrl={screenCaptureUrl}
        isPdfCapture={isPdfCapture}
        expandedSources={expandedSources}
        messagesContainerRef={messagesContainerRef}
        messagesEndRef={messagesEndRef}
        isRegenerating={isRegenerating}
        onRegenerateExplanation={onRegenerateExplanation}
        onScrollToImage={onScrollToImage}
        toggleSourceExpansion={toggleSourceExpansion}
        handleScrollToSource={handleScrollToSource}
      />

      {/* Input area */}
      <ChatInput
        inputValue={inputValue}
        disabled={disabled}
        isStreaming={isStreaming}
        isGeneratingEmbeddings={isGeneratingEmbeddings}
        hasEmbeddings={hasEmbeddings}
        embeddingProgress={embeddingProgress}
        activeTab={activeTab}
        inputRef={inputRef}
        handleInputChange={handleInputChange}
        handleKeyDown={handleKeyDown}
        handleClearInput={handleClearInput}
        handleSend={handleSend}
      />

      {/* Clear messages confirmation modal */}
      {showClearModal && (
        <ConfirmationModal
          title="Confirm Delete"
          message="Are you sure you want to clear all messages? This cannot be undone."
          confirmText="Clear Messages"
          onConfirm={handleConfirmClear}
          onCancel={handleCancelClear}
        />
      )}

      {/* Tab close confirmation modal */}
      {showTabCloseModal && (
        <ConfirmationModal
          title="Close Tab"
          message="Are you sure you want to close this tab? All chat history for this image will be permanently deleted."
          confirmText="Close Tab"
          onConfirm={confirmTabClose}
          onCancel={cancelTabClose}
        />
      )}
    </div>
  );
};