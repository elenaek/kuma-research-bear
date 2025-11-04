/**
 * ChatboxRenderer - Handles Preact rendering of the chatbox UI
 *
 * Responsibilities:
 * - Render ChatBox component with proper props
 * - Convert internal TabState to ChatTab format
 * - Handle visibility logic
 * - Manage shadow DOM rendering
 */

import { h, render } from 'preact';
import { ChatBox } from '../../components/ChatBox.tsx';
import { ChatMessage, ChatboxSettings, StoredPaper, ChatTab } from '../../../shared/types/index.ts';
import { TabState } from './ChatboxStateManager.ts';
import { logger } from '../../../shared/utils/logger.ts';

/**
 * Rendering context containing all data needed to render the chatbox
 */
export interface ChatboxRenderContext {
  // Core DOM elements
  shadowRoot: ShadowRoot;
  isInitialized: boolean;

  // Settings
  settings: ChatboxSettings;

  // Paper state
  currentPaper: StoredPaper | null;

  // Tab state
  tabs: TabState[];
  activeTabId: string;

  // Operation state
  isRegeneratingExplanation: boolean;
  isGeneratingEmbeddings: boolean;
  hasEmbeddings: boolean;
  embeddingProgress: string;

  // Interaction state
  hasInteractedSinceOpen: boolean;
  initialInputValue: string;

  // Compass tracking (for image tabs)
  getCompassAngle: (tabId: string) => number | undefined;
}

/**
 * Callbacks for user interactions
 */
export interface ChatboxRenderCallbacks {
  // Tab management
  onSwitchTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;

  // Message handling
  onSendMessage: (message: string) => Promise<void>;
  onClearMessages: () => Promise<void>;
  onRegenerateExplanation: () => Promise<void>;
  onScrollToImage: () => void;

  // Window controls
  onClose: () => void;
  onMinimize: () => void;
  onPositionChange: (position: { x: number; y: number; width: number; height: number }) => void;
  onToggleTransparency: () => void;
  onFirstInteraction: () => void;
}

export class ChatboxRenderer {
  /**
   * Render the chatbox UI
   *
   * @param context - Current state and data for rendering
   * @param callbacks - Event handlers for user interactions
   */
  render(context: ChatboxRenderContext, callbacks: ChatboxRenderCallbacks): void {
    // Guard: Check initialization
    if (!context.shadowRoot || !context.isInitialized) {
      logger.debug('CONTENT_SCRIPT', '[Renderer] Not initialized, skipping render');
      return;
    }

    const rootElement = context.shadowRoot.querySelector('div');
    if (!rootElement) {
      logger.error('CONTENT_SCRIPT', '[Renderer] Root element not found in shadow DOM');
      return;
    }

    // Handle visibility: render null if hidden
    if (!context.settings.visible) {
      render(null, rootElement);
      return;
    }

    // Determine if chatbox should be disabled
    const isDisabled = !context.currentPaper || !context.currentPaper.chunkCount;
    const hasPaper = !!context.currentPaper;
    const hasChunked = !!(context.currentPaper && context.currentPaper.chunkCount > 0);

    // Get active tab
    const activeTab = context.tabs.find(t => t.id === context.activeTabId);
    if (!activeTab) {
      logger.error('CONTENT_SCRIPT', '[Renderer] Active tab not found:', context.activeTabId);
      return;
    }

    // Convert TabState[] to ChatTab[] for the ChatBox component
    const chatTabs: ChatTab[] = context.tabs.map(tab => ({
      id: tab.id,
      type: tab.type,
      title: tab.title,
      imageUrl: tab.imageUrl,
      imageBlob: tab.imageBlob,
      imageButtonElement: tab.imageButtonElement,
      overlayPosition: tab.overlayPosition,
    }));

    // Calculate compass arrow angle if active tab is an image tab
    const compassArrowAngle = activeTab.type === 'image'
      ? context.getCompassAngle(activeTab.id)
      : undefined;

    try {
      render(
        h(ChatBox, {
          // Multi-tab props
          tabs: chatTabs,
          activeTabId: context.activeTabId,
          compassArrowAngle,
          onSwitchTab: callbacks.onSwitchTab,
          onCloseTab: callbacks.onCloseTab,

          // Active tab messages
          messages: activeTab.messages,
          isStreaming: activeTab.isStreaming,
          streamingMessage: activeTab.streamingMessage,

          // Message handlers
          onSendMessage: callbacks.onSendMessage,
          onClearMessages: callbacks.onClearMessages,
          onRegenerateExplanation: callbacks.onRegenerateExplanation,
          isRegenerating: context.isRegeneratingExplanation,
          onScrollToImage: callbacks.onScrollToImage,

          // Window controls
          onClose: callbacks.onClose,
          onMinimize: callbacks.onMinimize,
          isMinimized: context.settings.minimized,

          // Position
          initialPosition: context.settings.position,
          onPositionChange: callbacks.onPositionChange,

          // State
          disabled: isDisabled,
          paperTitle: context.currentPaper?.title,
          hasPaper: hasPaper,
          hasChunked: hasChunked,
          isGeneratingEmbeddings: context.isGeneratingEmbeddings,
          hasEmbeddings: context.hasEmbeddings,
          embeddingProgress: context.embeddingProgress,

          // Transparency
          transparencyEnabled: context.settings.transparencyEnabled,
          onToggleTransparency: callbacks.onToggleTransparency,
          hasInteractedSinceOpen: context.hasInteractedSinceOpen,
          onFirstInteraction: callbacks.onFirstInteraction,

          // Initial input
          initialInputValue: context.initialInputValue,
        }),
        rootElement
      );
    } catch (error) {
      logger.error('CONTENT_SCRIPT', '[Renderer] Error rendering chatbox:', error);
    }
  }

  /**
   * Clear the rendered content (used when hiding)
   *
   * @param shadowRoot - Shadow DOM root element
   */
  clear(shadowRoot: ShadowRoot): void {
    const rootElement = shadowRoot.querySelector('div');
    if (rootElement) {
      render(null, rootElement);
    }
  }
}
