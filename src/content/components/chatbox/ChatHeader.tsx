import { h } from 'preact';
import { ChatTab } from '../../../shared/types/index.ts';
import { CompassArrow } from './CompassArrow.tsx';

interface ChatHeaderProps {
  isMinimized: boolean;
  paperTitle?: string;
  activeTab?: ChatTab;
  isPdfCapture: boolean;
  compassArrowAngle?: number;
  transparencyEnabled: boolean;
  messagesCount: number;
  isStreaming: boolean;
  onToggleTransparency: () => void;
  onScrollToImage?: () => void;
  onClearMessages: () => void;
  onMinimize: () => void;
  onClose: () => void;
  handleDragStart: (e: MouseEvent) => void;
}

/**
 * Chat header component with controls
 * Supports both minimized and expanded states
 */
export const ChatHeader = ({
  isMinimized,
  paperTitle,
  activeTab,
  isPdfCapture,
  compassArrowAngle,
  transparencyEnabled,
  messagesCount,
  isStreaming,
  onToggleTransparency,
  onScrollToImage,
  onClearMessages,
  onMinimize,
  onClose,
  handleDragStart,
}: ChatHeaderProps) => {
  // Minimized header
  if (isMinimized) {
    return (
      <div
        class="chatbox-header-minimized"
        onMouseDown={handleDragStart}
      >
        <div class="flex items-center gap-2">
          {/* Compass arrow for image tabs (even when minimized) */}
          {activeTab && activeTab.type === 'image' && !isPdfCapture && (activeTab.imageButtonElement || activeTab.overlayPosition) && compassArrowAngle !== undefined && (
            <CompassArrow angle={compassArrowAngle} />
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
    );
  }

  // Expanded header
  return (
    <div
      class="chatbox-header"
      onMouseDown={handleDragStart}
    >
      <div class="flex items-center gap-2 flex-1 min-w-0" style={{margin: '5px'}}>
        {/* Compass arrow for image tabs */}
        {activeTab && activeTab.type === 'image' && !isPdfCapture && (activeTab.imageButtonElement || activeTab.overlayPosition) && compassArrowAngle !== undefined && (
          <CompassArrow angle={compassArrowAngle} />
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
        {/* Scroll to image button - for image tabs with button elements or overlay position */}
        {activeTab && activeTab.type === 'image' && !isPdfCapture && (activeTab.imageButtonElement || activeTab.overlayPosition) && onScrollToImage && (
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
          onClick={onClearMessages}
          disabled={messagesCount === 0 && !isStreaming}
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
  );
};
