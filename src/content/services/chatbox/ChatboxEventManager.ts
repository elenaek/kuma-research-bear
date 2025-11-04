/**
 * ChatboxEventManager - Handles all user interaction events for the chatbox
 *
 * Responsibilities:
 * - Message handling (send, clear, regenerate)
 * - Tab management (switch, close)
 * - Window controls (position, minimize, close, transparency)
 * - Interaction tracking
 * - Scroll to image
 */

import { ChatMessage, StoredPaper, ChatboxPosition } from '../../../shared/types/index.ts';
import { ChatboxStateManager, TabState } from './ChatboxStateManager.ts';
import { ChatboxStorageService } from './ChatboxStorageService.ts';
import * as ChromeService from '../../../services/chromeService.ts';
import { imageExplanationHandler } from '../imageExplanationHandler.ts';
import { logger } from '../../../shared/utils/logger.ts';

/**
 * Dependencies required by the event manager
 */
export interface EventManagerDependencies {
  stateManager: ChatboxStateManager;
  storageService: ChatboxStorageService;
  getCurrentPaper: () => StoredPaper | null;
  requestRender: () => void;
  setIsRegeneratingExplanation: (value: boolean) => void;
  getIsRegeneratingExplanation: () => boolean;
  saveTabs?: () => Promise<void>;
}

export class ChatboxEventManager {
  constructor(private deps: EventManagerDependencies) {}

  /**
   * Handle sending a chat message
   * Saves message to history and sends to background for processing
   */
  async handleSendMessage(message: string): Promise<void> {
    const currentPaper = this.deps.getCurrentPaper();
    if (!currentPaper) {
      logger.error('CONTENT_SCRIPT', '[EventManager] No paper loaded');
      return;
    }

    const activeTab = this.deps.stateManager.getActiveTab();
    if (!activeTab) {
      logger.error('CONTENT_SCRIPT', '[EventManager] Active tab not found');
      return;
    }

    // Add user message to history
    const userMessage: ChatMessage = {
      role: 'user',
      content: message,
      timestamp: Date.now(),
    };

    activeTab.messages.push(userMessage);
    activeTab.isStreaming = true;
    activeTab.streamingMessage = '';

    // Save user message immediately
    await this.saveTabHistory(activeTab, currentPaper);

    // Request render to show user message
    this.deps.requestRender();

    // Send to background for processing
    try {
      if (activeTab.type === 'paper') {
        await ChromeService.sendChatMessage(currentPaper.url, message);
      } else if (activeTab.type === 'image' && activeTab.imageUrl && activeTab.imageBlob) {
        await ChromeService.sendImageChatMessage(
          currentPaper.id,
          activeTab.imageUrl,
          activeTab.imageBlob,
          message
        );
      }
    } catch (error) {
      logger.error('CONTENT_SCRIPT', '[EventManager] Failed to send message:', error);
      activeTab.isStreaming = false;

      // Add error message
      const errorMessage: ChatMessage = {
        role: 'assistant',
        content: 'Sorry, I encountered an error processing your message. Please try again.',
        timestamp: Date.now(),
      };

      activeTab.messages.push(errorMessage);

      // Save error message
      await this.saveTabHistory(activeTab, currentPaper);

      this.deps.requestRender();
    }
  }

  /**
   * Handle clearing chat messages
   * For paper tabs: clears everything
   * For image tabs: preserves the first message (explanation)
   */
  async handleClearMessages(): Promise<void> {
    const currentPaper = this.deps.getCurrentPaper();
    if (!currentPaper) {
      logger.error('CONTENT_SCRIPT', '[EventManager] No paper loaded');
      return;
    }

    const activeTab = this.deps.stateManager.getActiveTab();
    if (!activeTab) {
      logger.error('CONTENT_SCRIPT', '[EventManager] Active tab not found');
      return;
    }

    try {
      if (activeTab.type === 'paper') {
        // Paper tab: clear everything
        await ChromeService.clearChatHistory(currentPaper.url);
        activeTab.messages = [];
      } else if (activeTab.type === 'image' && activeTab.imageUrl) {
        // Image tab: preserve the first message (explanation) if it exists
        const hasExplanation = activeTab.messages.length > 0 && activeTab.messages[0].role === 'assistant';

        if (hasExplanation) {
          // Keep only the explanation message
          const explanationMessage = activeTab.messages[0];
          activeTab.messages = [explanationMessage];

          // Update database to store only the explanation
          await ChromeService.updateImageChatHistory(currentPaper.id, activeTab.imageUrl, [explanationMessage]);
        } else {
          // No explanation to preserve, clear everything
          activeTab.messages = [];
        }

        // Destroy AI session to start fresh conversation (but keep explanation visible)
        await ChromeService.clearImageChatHistory(currentPaper.id, activeTab.imageUrl);
      }

      logger.debug('CONTENT_SCRIPT', '[EventManager] ✓ Chat history cleared for tab:', activeTab.id);

      // Re-render
      this.deps.requestRender();
    } catch (error) {
      logger.error('CONTENT_SCRIPT', '[EventManager] Failed to clear chat history:', error);
    }
  }

  /**
   * Handle regenerating image explanation
   * Only available for image tabs
   */
  async handleRegenerateExplanation(): Promise<void> {
    const currentPaper = this.deps.getCurrentPaper();
    if (!currentPaper) {
      logger.error('CONTENT_SCRIPT', '[EventManager] No paper loaded');
      return;
    }

    const activeTab = this.deps.stateManager.getActiveTab();
    if (!activeTab || activeTab.type !== 'image' || !activeTab.imageUrl) {
      logger.error('CONTENT_SCRIPT', '[EventManager] Active tab is not an image tab');
      return;
    }

    // Set loading state
    this.deps.setIsRegeneratingExplanation(true);
    this.deps.requestRender(); // Show loading immediately

    try {
      // Regenerate explanation
      const result = await imageExplanationHandler.regenerateExplanation(activeTab.imageUrl);

      if (result) {
        // Update first message with new explanation
        activeTab.messages[0] = {
          role: 'assistant',
          content: result.explanation,
          timestamp: Date.now(),
        };

        // Clear conversation history (keep only the new explanation)
        activeTab.messages = [activeTab.messages[0]];

        // Update database with only the explanation
        await ChromeService.updateImageChatHistory(currentPaper.id, activeTab.imageUrl, [activeTab.messages[0]]);

        // Destroy AI session for fresh conversation context
        await ChromeService.clearImageChatHistory(currentPaper.id, activeTab.imageUrl);

        logger.debug('CONTENT_SCRIPT', '[EventManager] ✓ Explanation regenerated and conversation cleared');
      } else {
        logger.error('CONTENT_SCRIPT', '[EventManager] Failed to regenerate explanation');
      }
    } catch (error) {
      logger.error('CONTENT_SCRIPT', '[EventManager] Error regenerating explanation:', error);
    } finally {
      // Clear loading state
      this.deps.setIsRegeneratingExplanation(false);
      this.deps.requestRender(); // Update UI
    }
  }

  /**
   * Handle scrolling to image on the page
   * Only available for image tabs
   */
  handleScrollToImage(): void {
    const activeTab = this.deps.stateManager.getActiveTab();
    if (!activeTab || activeTab.type !== 'image' || !activeTab.imageUrl) {
      logger.error('CONTENT_SCRIPT', '[EventManager] Cannot scroll - not an image tab');
      return;
    }

    // Check if we have overlayPosition (for screen captures after page refresh)
    if (activeTab.overlayPosition && !activeTab.imageButtonElement) {
      logger.debug('CONTENT_SCRIPT', '[EventManager] Scrolling to overlayPosition for restored screen capture');
      this.scrollToOverlayPosition(activeTab.overlayPosition);
      return;
    }

    // Get the actual image element from imageExplanationHandler
    // (imageButtonElement is the floating button container, not the actual image)
    const imageState = imageExplanationHandler.getImageStateByUrl(activeTab.imageUrl);
    if (!imageState || !imageState.element) {
      logger.error('CONTENT_SCRIPT', '[EventManager] Image element not found');
      return;
    }

    // Scroll the actual image element into view with smooth animation
    imageState.element.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
    });

    // Apply highlight effect (light blue outline)
    const originalOutline = imageState.element.style.outline;
    const originalOutlineOffset = imageState.element.style.outlineOffset;
    const originalOpacity = imageState.element.style.opacity;
    const originalBackground = imageState.element.style.background;
    const originalZIndex = imageState.element.style.zIndex;
    const originalPosition = imageState.element.style.position;

    // For screen capture overlays (opacity: 0), make visible with background
    const isScreenCaptureOverlay = imageState.element.className === 'kuma-screen-capture-overlay';

    if (isScreenCaptureOverlay) {
      // Show overlay with semi-transparent blue background
      imageState.element.style.opacity = '1';
      imageState.element.style.background = 'rgba(96, 165, 250, 0.2)';
      imageState.element.style.outline = '3px solid #60a5fa';
      imageState.element.style.outlineOffset = '2px';
    } else {
      // Regular images: show outline and boost z-index to prevent clipping
      // Apply position relative if element is not already positioned
      if (!originalPosition || originalPosition === 'static') {
        imageState.element.style.position = 'relative';
      }
      imageState.element.style.zIndex = '999999';
      imageState.element.style.outline = '3px solid #60a5fa';
      imageState.element.style.outlineOffset = '2px';
    }

    // Remove highlight after 2 seconds
    setTimeout(() => {
      imageState.element.style.outline = originalOutline;
      imageState.element.style.outlineOffset = originalOutlineOffset;
      imageState.element.style.zIndex = originalZIndex;
      imageState.element.style.position = originalPosition;
      if (isScreenCaptureOverlay) {
        imageState.element.style.opacity = originalOpacity;
        imageState.element.style.background = originalBackground;
      }
    }, 2000);

    logger.debug('CONTENT_SCRIPT', '[EventManager] ✓ Scrolled to image element');
  }

  /**
   * Scroll to screen capture overlay position (for restored tabs after page refresh)
   * Creates a temporary visual indicator since the original overlay is gone
   */
  private scrollToOverlayPosition(overlayPosition: { pageX: number; pageY: number; width: number; height: number }): void {
    // Scroll to the center of the overlay position
    const targetX = overlayPosition.pageX + overlayPosition.width / 2;
    const targetY = overlayPosition.pageY + overlayPosition.height / 2;

    // Calculate scroll position to center the target in viewport
    const scrollX = targetX - window.innerWidth / 2;
    const scrollY = targetY - window.innerHeight / 2;

    window.scrollTo({
      left: scrollX,
      top: scrollY,
      behavior: 'smooth',
    });

    // Create temporary visual indicator overlay
    const indicator = document.createElement('div');
    indicator.style.position = 'absolute';
    indicator.style.left = `${overlayPosition.pageX}px`;
    indicator.style.top = `${overlayPosition.pageY}px`;
    indicator.style.width = `${overlayPosition.width}px`;
    indicator.style.height = `${overlayPosition.height}px`;
    indicator.style.border = '3px solid #60a5fa';
    indicator.style.backgroundColor = 'rgba(96, 165, 250, 0.2)';
    indicator.style.pointerEvents = 'none';
    indicator.style.zIndex = '999999';
    indicator.style.transition = 'opacity 0.3s ease-out';
    document.body.appendChild(indicator);

    // Fade out and remove after 2 seconds
    setTimeout(() => {
      indicator.style.opacity = '0';
      setTimeout(() => {
        indicator.remove();
      }, 300);
    }, 2000);

    logger.debug('CONTENT_SCRIPT', '[EventManager] ✓ Scrolled to overlay position:', overlayPosition);
  }

  /**
   * Handle tab switching
   */
  handleSwitchTab(tabId: string): void {
    this.deps.stateManager.setActiveTabId(tabId);
    this.deps.requestRender();
    logger.debug('CONTENT_SCRIPT', '[EventManager] Switched to tab:', tabId);
  }

  /**
   * Handle tab closing
   */
  async handleCloseTab(tabId: string): Promise<void> {
    const tab = this.deps.stateManager.getTabById(tabId);
    if (!tab) {
      logger.error('CONTENT_SCRIPT', '[EventManager] Tab not found:', tabId);
      return;
    }

    // Don't allow closing the paper tab
    if (tab.type === 'paper') {
      logger.warn('CONTENT_SCRIPT', '[EventManager] Cannot close paper tab');
      return;
    }

    // For image tabs, clean up database and image state
    if (tab.type === 'image' && tab.imageUrl) {
      const currentPaper = this.deps.getCurrentPaper();
      if (currentPaper) {
        // Check if this is a screen capture
        const isScreenCapture = tab.imageUrl.startsWith('screen-capture-') || tab.imageUrl.startsWith('pdf-capture-');

        if (isScreenCapture) {
          // Delete screen capture blob from IndexedDB
          await ChromeService.deleteScreenCapture(currentPaper.id, tab.imageUrl);
          logger.debug('CONTENT_SCRIPT', '[EventManager] ✓ Deleted screen capture blob');
        }

        // Delete image explanation from database
        await ChromeService.deleteImageExplanation(currentPaper.id, tab.imageUrl);

        // Delete image chat history from database
        await ChromeService.clearImageChatHistory(currentPaper.id, tab.imageUrl);

        logger.debug('CONTENT_SCRIPT', '[EventManager] ✓ Deleted image data from database');
      }

      // Clear image state in imageExplanationHandler (removes "explained" checkmark and re-renders button)
      imageExplanationHandler.clearExplanationState(tab.imageUrl);
    }

    // Remove the tab
    this.deps.stateManager.removeTab(tabId);

    logger.debug('CONTENT_SCRIPT', '[EventManager] ✓ Closed tab:', tabId);
    this.deps.requestRender();

    // Save tabs to storage
    if (this.deps.saveTabs) {
      await this.deps.saveTabs();
    }
  }

  /**
   * Handle position change (drag/resize)
   */
  async handlePositionChange(position: ChatboxPosition): Promise<void> {
    await this.deps.storageService.savePosition(position);
    logger.debug('CONTENT_SCRIPT', '[EventManager] ✓ Position saved:', position);
  }

  /**
   * Handle transparency toggle
   */
  async handleToggleTransparency(): Promise<void> {
    await this.deps.storageService.toggleTransparency();
    this.deps.requestRender();
    logger.debug('CONTENT_SCRIPT', '[EventManager] ✓ Transparency toggled');
  }

  /**
   * Handle first interaction (disables transparency)
   */
  handleFirstInteraction(): void {
    logger.debug('CONTENT_SCRIPT', '[EventManager] First interaction detected');
    // This is handled by the coordinator
  }

  /**
   * Save tab chat history to storage
   * Helper method used by message handlers
   */
  private async saveTabHistory(tab: TabState, currentPaper: StoredPaper): Promise<void> {
    try {
      if (tab.type === 'paper') {
        await this.deps.storageService.savePaperChatHistory(currentPaper.url, tab.messages);
      } else if (tab.type === 'image' && tab.imageUrl) {
        await this.deps.storageService.saveImageChatHistory(currentPaper.id, tab.imageUrl, tab.messages);
      }
    } catch (error) {
      logger.error('CONTENT_SCRIPT', '[EventManager] Failed to save chat history:', error);
    }
  }
}
