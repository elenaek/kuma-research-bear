/**
 * ChatboxStateManager - Manages chatbox tab state
 *
 * Responsibilities:
 * - Maintain tabs array and active tab ID
 * - Provide pure state manipulation methods
 * - Generate tab IDs
 * - Find tabs by ID or image URL
 *
 * NOTE: This manager focuses on pure state logic.
 * Storage persistence, rendering, and service coordination
 * remain in ChatboxInjector as orchestration concerns.
 */

import { ChatMessage, ConversationState, StoredPaper } from '../../../shared/types/index.ts';

export interface TabState {
  id: string;
  type: 'paper' | 'image';
  title: string;
  messages: ChatMessage[];
  isStreaming: boolean;
  streamingMessage: string;
  conversationState: ConversationState;
  // For image tabs only:
  imageUrl?: string;
  imageBlob?: Blob;
  imageButtonElement?: HTMLElement | null;
  // For screen capture tabs only:
  overlayPosition?: {
    pageX: number;
    pageY: number;
    width: number;
    height: number;
  };
}

export class ChatboxStateManager {
  private tabs: TabState[] = [];
  private activeTabId: string = 'paper';

  /**
   * Get all tabs
   */
  getTabs(): TabState[] {
    return this.tabs;
  }

  /**
   * Get active tab ID
   */
  getActiveTabId(): string {
    return this.activeTabId;
  }

  /**
   * Set active tab ID (without validation)
   */
  setActiveTabId(tabId: string): void {
    this.activeTabId = tabId;
  }

  /**
   * Get active tab
   */
  getActiveTab(): TabState | undefined {
    return this.tabs.find(t => t.id === this.activeTabId);
  }

  /**
   * Find tab by ID
   */
  findTabById(tabId: string): TabState | undefined {
    return this.tabs.find(t => t.id === tabId);
  }

  /**
   * Get tab by ID (alias for findTabById for consistency)
   */
  getTabById(tabId: string): TabState | undefined {
    return this.findTabById(tabId);
  }

  /**
   * Find tab by image URL
   */
  findTabByImageUrl(imageUrl: string): TabState | undefined {
    return this.tabs.find(t => t.type === 'image' && t.imageUrl === imageUrl);
  }

  /**
   * Get tab by image URL (alias for findTabByImageUrl for consistency)
   */
  getTabByImageUrl(imageUrl: string): TabState | undefined {
    return this.findTabByImageUrl(imageUrl);
  }

  /**
   * Get paper tab
   */
  getPaperTab(): TabState | undefined {
    return this.tabs.find(t => t.id === 'paper');
  }

  /**
   * Initialize paper tab with default state
   *
   * @param paperTitle - Title of the paper (or 'Paper Chat' if null)
   * @returns The created paper tab
   */
  initializePaperTab(paperTitle: string | null = null): TabState {
    const paperTab: TabState = {
      id: 'paper',
      type: 'paper',
      title: paperTitle || 'Paper Chat',
      messages: [],
      isStreaming: false,
      streamingMessage: '',
      conversationState: {
        summary: null,
        recentMessages: [],
        lastSummarizedIndex: -1,
        summaryCount: 0,
      },
    };

    this.tabs = [paperTab];
    this.activeTabId = 'paper';

    return paperTab;
  }

  /**
   * Add a tab to the tabs array
   */
  addTab(tab: TabState): void {
    this.tabs.push(tab);
  }

  /**
   * Remove a tab by ID
   *
   * @param tabId - Tab ID to remove
   * @returns True if tab was removed, false if not found or is paper tab
   */
  removeTab(tabId: string): boolean {
    // Cannot remove paper tab
    if (tabId === 'paper') {
      return false;
    }

    const tabIndex = this.tabs.findIndex(t => t.id === tabId);
    if (tabIndex === -1) {
      return false;
    }

    this.tabs.splice(tabIndex, 1);

    // If we removed the active tab, switch to paper tab
    if (this.activeTabId === tabId) {
      this.activeTabId = 'paper';
    }

    return true;
  }

  /**
   * Switch to a tab (sets active tab ID if tab exists)
   *
   * @param tabId - Tab ID to switch to
   * @returns True if switched successfully, false if tab not found
   */
  switchToTab(tabId: string): boolean {
    const tab = this.tabs.find(t => t.id === tabId);
    if (!tab) {
      return false;
    }

    this.activeTabId = tabId;
    return true;
  }

  /**
   * Generate tab ID for an image URL using same hash logic as backend
   *
   * @param imageUrl - Image URL to generate ID for
   * @returns Tab ID (e.g., 'image-img_123456')
   */
  static generateImageTabId(imageUrl: string): string {
    let hash = 0;
    for (let i = 0; i < imageUrl.length; i++) {
      const char = imageUrl.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return `image-img_${Math.abs(hash)}`;
  }

  /**
   * Generate AI context ID for an image chat (same logic as chatHandlers.ts)
   *
   * @param paperId - Paper ID
   * @param imageUrl - Image URL
   * @returns Context ID (e.g., 'image-chat-paper_123-img_456')
   */
  static generateImageContextId(paperId: string, imageUrl: string): string {
    let hash = 0;
    for (let i = 0; i < imageUrl.length; i++) {
      const char = imageUrl.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return `image-chat-${paperId}-img_${Math.abs(hash)}`;
  }

  /**
   * Create a new image tab and add it to tabs array
   *
   * @param imageUrl - Image URL
   * @param imageBlob - Image blob
   * @param title - Tab title
   * @param imageButtonElement - Reference to image button element
   * @returns New tab state object
   */
  createImageTab(
    imageUrl: string,
    imageBlob: Blob,
    title: string,
    imageButtonElement: HTMLElement | null | undefined
  ): TabState {
    const tabId = ChatboxStateManager.generateImageTabId(imageUrl);

    const newTab: TabState = {
      id: tabId,
      type: 'image',
      title,
      messages: [],
      isStreaming: false,
      streamingMessage: '',
      conversationState: {
        summary: null,
        recentMessages: [],
        lastSummarizedIndex: -1,
        summaryCount: 0,
      },
      imageUrl,
      imageBlob,
      imageButtonElement,
    };

    // Add tab to tabs array
    this.tabs.push(newTab);

    return newTab;
  }

  /**
   * Update image tab title
   *
   * @param imageUrl - Image URL to find tab
   * @param title - New title
   * @returns True if tab was found and updated
   */
  updateImageTabTitle(imageUrl: string, title: string): boolean {
    const tab = this.findTabByImageUrl(imageUrl);
    if (!tab) {
      return false;
    }

    tab.title = title;
    return true;
  }

  /**
   * Replace loading message with actual explanation in an image tab
   *
   * @param imageUrl - Image URL to find tab
   * @param explanation - Explanation text
   * @returns True if tab was found and updated
   */
  replaceLoadingMessage(imageUrl: string, explanation: string): boolean {
    const tab = this.findTabByImageUrl(imageUrl);
    if (!tab) {
      return false;
    }

    // Find loading message
    const loadingIndex = tab.messages.findIndex(
      m => m.role === 'assistant' && m.content === '___LOADING_EXPLANATION___'
    );

    if (loadingIndex !== -1) {
      // Replace loading message with actual explanation
      tab.messages[loadingIndex] = {
        role: 'assistant',
        content: explanation,
        timestamp: Date.now(),
      };
      return true;
    }

    return false;
  }

  /**
   * Update paper tab title if it's still default
   *
   * @param currentPaperTitle - Current paper title
   * @returns True if updated
   */
  updatePaperTitleIfDefault(currentPaperTitle: string | null): boolean {
    const paperTab = this.getPaperTab();
    if (!paperTab) {
      return false;
    }

    if (paperTab.title === 'Paper Chat' && currentPaperTitle) {
      paperTab.title = currentPaperTitle;
      return true;
    }

    return false;
  }

  /**
   * Reset state (clear all tabs and reset to defaults)
   */
  reset(): void {
    this.tabs = [];
    this.activeTabId = 'paper';
  }

  /**
   * Clear all tabs (alias for reset for consistency)
   */
  clearAllTabs(): void {
    this.reset();
  }
}
