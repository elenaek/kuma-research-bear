/**
 * ChatboxInjector - Main coordinator for the multi-tabbed chatbox UI
 *
 * ARCHITECTURE:
 * This class follows the Coordinator pattern, delegating to specialized services:
 *
 * Services:
 * - ChatboxStyleService: CSS injection and shadow DOM styling
 * - ChatboxStorageService: Settings and chat history persistence
 * - CompassTracker: Compass arrow tracking with performance optimizations
 * - ChatboxStateManager: Pure tab state management
 * - ChatboxPerformanceManager: Page load and URL stabilization utilities
 * - ChatboxRenderer: Preact rendering with all props
 * - ChatboxEventManager: All user interaction event handling
 *
 * Coordinator Responsibilities:
 * - Public API (toggle, show, hide, openImageTab, updatePaperContext)
 * - Lifecycle management (initialize, destroy)
 * - Service orchestration (coordinating between services)
 * - Message stream handling (paper/image chat responses)
 * - Tab restoration with image button lookup
 * - Paper context updates and operation state changes
 */

import { h } from 'preact';
import { ChatMessage, ChatboxSettings, ChatboxPosition, StoredPaper, ConversationState, SourceInfo } from '../../shared/types/index.ts';
import * as ChromeService from '../../services/chromeService.ts';
import { imageExplanationHandler } from './imageExplanationHandler.ts';
import { logger } from '../../shared/utils/logger.ts';
import { ChatboxStyleService } from './chatbox/ChatboxStyleService.ts';
import { ChatboxStorageService } from './chatbox/ChatboxStorageService.ts';
import { CompassTracker } from './chatbox/CompassTracker.ts';
import { ChatboxStateManager } from './chatbox/ChatboxStateManager.ts';
import { ChatboxPerformanceManager } from './chatbox/ChatboxPerformanceManager.ts';
import { ChatboxRenderer, ChatboxRenderContext, ChatboxRenderCallbacks } from './chatbox/ChatboxRenderer.ts';
import { ChatboxEventManager, EventManagerDependencies } from './chatbox/ChatboxEventManager.ts';

// Default position and size
const DEFAULT_POSITION: ChatboxPosition = {
  x: 20,
  y: window.innerHeight - 620,
  width: 400,
  height: 600,
};

const DEFAULT_SETTINGS: ChatboxSettings = {
  position: DEFAULT_POSITION,
  visible: false,
  minimized: false,
  transparencyEnabled: true,
  activeTabs: [],
  activeTabId: 'paper', // Default to paper tab
  visibilityByUrl: {}, // Per-URL visibility state
};

class ChatboxInjector {
  private container: HTMLDivElement | null = null;
  private shadowRoot: ShadowRoot | null = null;
  private settings: ChatboxSettings = DEFAULT_SETTINGS;
  private currentPaper: StoredPaper | null = null;
  private isInitialized = false;
  private hasInteractedSinceOpen = false;
  private initialInputValue = '';
  private isRegeneratingExplanation = false;
  private isGeneratingEmbeddings = false;
  private hasEmbeddings = false;
  private embeddingProgress = '';

  // Services (7 services total)
  private styleService = new ChatboxStyleService();
  private storageService = new ChatboxStorageService();
  private compassTracker = new CompassTracker();
  private stateManager = new ChatboxStateManager();
  private performanceManager = new ChatboxPerformanceManager();
  private renderer = new ChatboxRenderer();
  private eventManager: ChatboxEventManager;

  constructor() {
    // Initialize event manager with dependencies
    const eventManagerDeps: EventManagerDependencies = {
      stateManager: this.stateManager,
      storageService: this.storageService,
      getCurrentPaper: () => this.currentPaper,
      requestRender: () => this.render(),
      setIsRegeneratingExplanation: (value: boolean) => { this.isRegeneratingExplanation = value; },
      getIsRegeneratingExplanation: () => this.isRegeneratingExplanation,
      saveTabs: () => this.saveTabs(),
    };
    this.eventManager = new ChatboxEventManager(eventManagerDeps);
  }

  /**
   * Initialize the chatbox
   */
  async initialize() {
    if (this.isInitialized) {
      logger.debug('CONTENT_SCRIPT', '[Kuma Chat] Already initialized');
      return;
    }

    logger.debug('CONTENT_SCRIPT', '[Kuma Chat] Starting initialization...');

    try {
      // Wait for page to be fully loaded (delegated to performance manager)
      await this.performanceManager.waitForPageReady();

      // Wait for URL to stabilize - important for SPAs (delegated to performance manager)
      const stableUrl = await this.performanceManager.waitForStableUrl();

      // Fetch current paper from database
      const { getPaperFromDBByUrl } = await import('../../services/ChromeService.ts');
      this.currentPaper = await getPaperFromDBByUrl(stableUrl);

      // Load saved settings from Chrome storage (delegated to storage service)
      this.settings = await this.storageService.loadSettings(DEFAULT_SETTINGS);

      // Create container
      this.container = document.createElement('div');
      this.container.id = 'kuma-chatbox-container';
      this.container.style.cssText = 'all: initial; position: fixed; z-index: 2147483647;';

      // Create shadow DOM with styles (delegated to style service)
      this.shadowRoot = await this.styleService.createShadowRoot(this.container);

      // Create root element for Preact
      const rootElement = document.createElement('div');
      this.shadowRoot.appendChild(rootElement);

      // Append to body
      document.body.appendChild(this.container);

      // Inject popover styles into document.body (for LaTeX popover)
      this.styleService.injectPopoverStyles();

      this.isInitialized = true;

      // Initialize with default paper tab
      await this.initializePaperTab();

      // Note: restoreTabs() will be called later, after image buttons are created
      // (See content.ts - called after setupImageExplanations)

      // Render initial state (delegated to renderer)
      this.render();

      // Listen for paper context changes
      this.setupContextListener();

      logger.debug('CONTENT_SCRIPT', '[Kuma Chat] ✓ Chatbox injector initialized successfully');
    } catch (error) {
      logger.error('CONTENT_SCRIPT', '[Kuma Chat] Failed to initialize:', error);
      throw error;
    }
  }

  /**
   * Initialize the default paper tab
   */
  private async initializePaperTab() {
    // Create paper tab using state manager
    const paperTab = this.stateManager.initializePaperTab(this.currentPaper?.title || null);

    // Load paper chat history if paper is available (delegated to storage service)
    if (this.currentPaper) {
      const history = await this.storageService.loadPaperChatHistory(this.currentPaper.url);
      paperTab.messages = history.messages;
      paperTab.conversationState = history.conversationState;
      paperTab.title = history.title;
    }
  }

  /**
   * Find image button element on page by image URL
   * Uses imageExplanationHandler since buttons are in shadow DOM
   */
  private findImageButtonByUrl(imageUrl: string): HTMLElement | null {
    try {
      // Get image state from image explanation handler (buttons are in shadow DOM)
      const imageState = imageExplanationHandler.getImageStateByUrl(imageUrl);

      if (imageState && imageState.buttonContainer) {
        return imageState.buttonContainer;
      }

      return null;
    } catch (error) {
      logger.error('CONTENT_SCRIPT', '[Kuma Chat] Error finding image button:', error);
      return null;
    }
  }

  /**
   * Save current tabs to storage
   */
  private async saveTabs(): Promise<void> {
    const tabs = this.stateManager.getTabs();
    const activeTabId = this.stateManager.getActiveTab()?.id || 'paper';
    await this.storageService.saveSettings(this.settings, tabs, activeTabId);
  }

  /**
   * Restore saved tabs from settings (call after image buttons are created)
   */
  async restoreTabs() {
    if (!this.settings.activeTabs || this.settings.activeTabs.length === 0) {
      logger.debug('CONTENT_SCRIPT', '[Kuma Chat] No saved tabs to restore');
      return;
    }

    logger.debug('CONTENT_SCRIPT', '[Kuma Chat] Restoring', this.settings.activeTabs.length, 'saved tabs');

    for (const savedTab of this.settings.activeTabs) {
      logger.debug('CONTENT_SCRIPT', '[Kuma Chat] Processing saved tab:', savedTab.imageUrl, 'type:', savedTab.type);

      if (savedTab.type !== 'image' || !savedTab.imageUrl) {
        logger.debug('CONTENT_SCRIPT', '[Kuma Chat] Skipping non-image tab');
        continue;
      }

      try {
        // Get image state from image explanation handler
        const imageState = imageExplanationHandler.getImageStateByUrl(savedTab.imageUrl);
        logger.debug('CONTENT_SCRIPT', '[Kuma Chat] Image state exists:', !!imageState);

        let blob: Blob;
        let imageButtonElement: HTMLElement | null = null;

        // Special handling for screen captures - fetch blob from IndexedDB
        if (savedTab.imageUrl.startsWith('screen-capture-') || savedTab.imageUrl.startsWith('pdf-capture-')) {
          logger.debug('CONTENT_SCRIPT', '[Kuma Chat] ⚡ Detected screen capture tab:', savedTab.imageUrl);
          if (!this.currentPaper) {
            logger.warn('CONTENT_SCRIPT', '[Kuma Chat] No current paper for screen capture restoration');
            continue;
          }

          try {
            logger.debug('CONTENT_SCRIPT', '[Kuma Chat] 🔍 Loading screen capture from IndexedDB...');
            logger.debug('CONTENT_SCRIPT', '[Kuma Chat] 🔍 Using paperId:', this.currentPaper.id, 'imageUrl:', savedTab.imageUrl);
            const response = await ChromeService.getScreenCapture(this.currentPaper.id, savedTab.imageUrl);
            if (!response || !response.entry?.blob) {
              logger.warn('CONTENT_SCRIPT', '[Kuma Chat] ❌ Screen capture not found in DB:', savedTab.imageUrl);
              logger.warn('CONTENT_SCRIPT', '[Kuma Chat] ❌ Searched with paperId:', this.currentPaper.id);
              logger.warn('CONTENT_SCRIPT', '[Kuma Chat] ❌ Response:', response);
              continue;
            }

            logger.debug('CONTENT_SCRIPT', '[Kuma Chat] ✓ Screen capture blob loaded, size:', response.entry.blob.size);
            blob = response.entry.blob;
            imageButtonElement = null; // No button element for screen captures after refresh

            // Recreate image state for screen capture (without overlay element since it's gone after refresh)
            if (!imageState) {
              logger.debug('CONTENT_SCRIPT', '[Kuma Chat] Creating synthetic image state for screen capture');
              const syntheticImageState = {
                element: null as any, // No overlay element after refresh
                url: savedTab.imageUrl,
                title: null,
                explanation: null,
                isLoading: false,
                buttonContainer: null,
                buttonRoot: null,
              };
              imageExplanationHandler.setImageState(savedTab.imageUrl, syntheticImageState);
              logger.debug('CONTENT_SCRIPT', '[Kuma Chat] ✓ Synthetic image state created');
            }

            // Store overlayPosition for compass tracking
            if (response.entry.overlayPosition) {
              logger.debug('CONTENT_SCRIPT', '[Kuma Chat] ✓ Found overlayPosition for screen capture');
              savedTab.overlayPosition = response.entry.overlayPosition;
            }
          } catch (error) {
            logger.error('CONTENT_SCRIPT', '[Kuma Chat] Failed to load screen capture:', error);
            continue;
          }
        } else if (imageState && imageState.element) {
          // Regular image - convert image element to blob
          const { imageElementToBlob } = await import('./imageDetectionService.ts');
          blob = await imageElementToBlob(imageState.element);
          imageButtonElement = this.findImageButtonByUrl(savedTab.imageUrl);
        } else {
          logger.warn('CONTENT_SCRIPT', '[Kuma Chat] Image element not found:', savedTab.imageUrl);
          continue;
        }

        // Create tab using state manager
        logger.debug('CONTENT_SCRIPT', '[Kuma Chat] Creating tab for:', savedTab.imageUrl);
        const newTab = this.stateManager.createImageTab(
          savedTab.imageUrl,
          blob,
          savedTab.title || 'Image Discussion',
          imageButtonElement
        );
        logger.debug('CONTENT_SCRIPT', '[Kuma Chat] ✓ Tab created with ID:', newTab.id);

        // Copy overlayPosition for screen captures
        if (savedTab.overlayPosition) {
          newTab.overlayPosition = savedTab.overlayPosition;
          logger.debug('CONTENT_SCRIPT', '[Kuma Chat] ✓ Copied overlayPosition to new tab');
        }

        // Load chat history and explanation from database
        if (this.currentPaper) {
          // Load chat history
          const messages = await this.storageService.loadImageChatHistory(this.currentPaper.id, savedTab.imageUrl);
          newTab.messages = messages;

          // Load explanation title from database (more accurate than saved title)
          try {
            const explanation = await ChromeService.getImageExplanation(this.currentPaper.id, savedTab.imageUrl);
            if (explanation?.title) {
              newTab.title = explanation.title;
            }
          } catch (error) {
            logger.debug('CONTENT_SCRIPT', '[Kuma Chat] No explanation found for image:', savedTab.imageUrl);
          }
        }

        logger.debug('CONTENT_SCRIPT', '[Kuma Chat] ✓ Restored tab:', savedTab.imageUrl);
      } catch (error) {
        logger.error('CONTENT_SCRIPT', '[Kuma Chat] Failed to restore tab:', savedTab.imageUrl, error);
      }
    }

    // Restore active tab ID if it's valid
    if (this.settings.activeTabId) {
      const activeTabExists = this.stateManager.getTabById(this.settings.activeTabId);
      if (activeTabExists) {
        this.stateManager.setActiveTabId(this.settings.activeTabId);
        logger.debug('CONTENT_SCRIPT', '[Kuma Chat] ✓ Restored active tab:', this.settings.activeTabId);
      }
    }

    // Setup compass tracking for the active tab if it's an image tab
    const activeTab = this.stateManager.getActiveTab();
    if (activeTab && activeTab.type === 'image' && this.container) {
      this.compassTracker.setupTracking(activeTab, this.container, () => this.render());
      logger.debug('CONTENT_SCRIPT', '[Kuma Chat] ✓ Set up compass tracking for restored tab');
    }

    // Render to show restored tabs
    this.render();
    logger.debug('CONTENT_SCRIPT', '[Kuma Chat] ✓ Tabs restored and rendered');

    // Notify image explanation handler to refresh button states
    imageExplanationHandler.refreshButtonStates();
  }

  /**
   * Setup message listeners for streaming and operation state changes
   */
  private setupContextListener() {
    chrome.runtime.onMessage.addListener((message) => {
      if (message.type === 'CHAT_STREAM_CHUNK') {
        this.handlePaperStreamChunk(message.payload);
      } else if (message.type === 'CHAT_STREAM_END') {
        this.handlePaperStreamEnd(message.payload);
      } else if (message.type === 'IMAGE_CHAT_STREAM_CHUNK') {
        this.handleImageStreamChunk(message.payload);
      } else if (message.type === 'IMAGE_CHAT_STREAM_END') {
        this.handleImageStreamEnd(message.payload);
      } else if (message.type === 'OPERATION_STATE_CHANGED') {
        this.handleOperationStateChange(message.payload);
      }
    });
  }

  /**
   * Handle operation state changes (embedding generation, etc.)
   */
  private handleOperationStateChange(payload: any) {
    const state = payload.state;
    if (!state) return;

    // Update embedding state
    if (state.isGeneratingEmbeddings !== undefined) {
      this.isGeneratingEmbeddings = state.isGeneratingEmbeddings;
    }
    if (state.hasEmbeddings !== undefined) {
      this.hasEmbeddings = state.hasEmbeddings;
    }
    if (state.embeddingProgress !== undefined) {
      this.embeddingProgress = state.embeddingProgress;
    }

    // Re-render to update UI with new state
    this.render();
  }

  /**
   * Update the current paper context
   * Public method called from content.ts
   */
  async updatePaperContext(paper: StoredPaper | null) {
    this.currentPaper = paper;

    // Load paper chat history using storage service
    if (this.currentPaper) {
      const paperTab = this.stateManager.getTabById('paper');
      if (paperTab) {
        const history = await this.storageService.loadPaperChatHistory(this.currentPaper.url);
        paperTab.messages = history.messages;
        paperTab.conversationState = history.conversationState;
        paperTab.title = history.title;
      }
    }

    // Reload image tab histories if they were restored without paper context
    if (this.currentPaper) {
      for (const tab of this.stateManager.getTabs()) {
        if (tab.type === 'image' && tab.imageUrl && tab.messages.length === 0) {
          const messages = await this.storageService.loadImageChatHistory(this.currentPaper.id, tab.imageUrl);
          tab.messages = messages;
        }
      }
    }

    this.render();
  }

  /**
   * Handle paper chat stream chunk
   */
  private handlePaperStreamChunk(chunk: string) {
    const paperTab = this.stateManager.getTabById('paper');
    if (!paperTab) return;

    paperTab.streamingMessage += chunk;
    this.render();
  }

  /**
   * Handle paper chat stream end
   */
  private handlePaperStreamEnd(data: { fullMessage: string; sources?: string[]; sourceInfo?: SourceInfo[] }) {
    const paperTab = this.stateManager.getTabById('paper');
    if (!paperTab || !this.currentPaper) return;

    // Add assistant message to history
    const assistantMessage: ChatMessage = {
      role: 'assistant',
      content: data.fullMessage,
      timestamp: Date.now(),
      sources: data.sources,
      sourceInfo: data.sourceInfo,
    };

    paperTab.messages.push(assistantMessage);
    paperTab.isStreaming = false;
    paperTab.streamingMessage = '';

    // Save to storage (delegated to storage service)
    this.storageService.savePaperChatHistory(this.currentPaper.url, paperTab.messages);

    this.render();
  }

  /**
   * Handle image chat stream chunk
   */
  private handleImageStreamChunk(chunk: string) {
    const activeTab = this.stateManager.getActiveTab();
    if (!activeTab || activeTab.type !== 'image') return;

    activeTab.streamingMessage += chunk;
    this.render();
  }

  /**
   * Handle image chat stream end
   */
  private async handleImageStreamEnd(data: { fullMessage: string; sources?: string[]; sourceInfo?: SourceInfo[] }) {
    const activeTab = this.stateManager.getActiveTab();
    if (!activeTab || activeTab.type !== 'image' || !activeTab.imageUrl || !this.currentPaper) return;

    // Add assistant message to history
    const assistantMessage: ChatMessage = {
      role: 'assistant',
      content: data.fullMessage,
      timestamp: Date.now(),
      sources: data.sources,
      sourceInfo: data.sourceInfo,
    };

    activeTab.messages.push(assistantMessage);
    activeTab.isStreaming = false;
    activeTab.streamingMessage = '';

    // Save to storage (delegated to storage service)
    await this.storageService.saveImageChatHistory(this.currentPaper.id, activeTab.imageUrl, activeTab.messages);

    // Update compass tracking
    if (this.container) {
      this.compassTracker.setupTracking(activeTab, this.container, () => this.render());
    }

    this.render();
  }

  /**
   * Toggle chatbox visibility
   */
  async toggle() {
    if (this.settings.visible) {
      await this.hide();
    } else {
      await this.show();
    }
  }

  /**
   * Show the chatbox
   */
  async show() {
    this.settings.visible = true;
    this.hasInteractedSinceOpen = false; // Reset interaction flag
    await this.storageService.saveVisibility(true);
    this.render();
    logger.debug('CONTENT_SCRIPT', '[Kuma Chat] Chatbox shown');
  }

  /**
   * Hide the chatbox
   */
  async hide() {
    this.settings.visible = false;
    await this.storageService.saveVisibility(false);
    this.cleanupCompassTracking();
    this.render();
    logger.debug('CONTENT_SCRIPT', '[Kuma Chat] Chatbox hidden');
  }

  /**
   * Handle paper deletion - clear all tabs and chat history, then close chatbox
   */
  async handlePaperDeletion() {
    logger.debug('CONTENT_SCRIPT', '[Kuma Chat] Handling paper deletion...');

    // Clear all tabs
    this.stateManager.clearAllTabs();

    // Reinitialize paper tab
    await this.initializePaperTab();

    // Clear current paper
    this.currentPaper = null;

    // Cleanup compass tracking
    this.cleanupCompassTracking();

    // Close the chatbox since the associated paper has been deleted
    await this.hide();

    logger.debug('CONTENT_SCRIPT', '[Kuma Chat] ✓ Paper deletion handled and chatbox closed');
  }

  /**
   * Open chatbox with a pre-filled query
   */
  async openWithQuery(query: string) {
    this.initialInputValue = query;
    await this.show();
  }

  /**
   * Open a new image tab or switch to existing one
   */
  async openImageTab(
    imageUrl: string,
    imageBlob: Blob,
    imageButtonElement: HTMLElement | null,
    explanation?: string,
    title?: string
  ): Promise<void> {
    if (!this.currentPaper) {
      logger.error('CONTENT_SCRIPT', '[Kuma Chat] Cannot open image tab without current paper');
      return;
    }

    // Check if tab already exists
    const existingTab = this.stateManager.getTabByImageUrl(imageUrl);
    if (existingTab) {
      // Switch to existing tab
      this.stateManager.setActiveTabId(existingTab.id);
      await this.show();
      this.render();
      return;
    }

    // Create new tab using state manager
    const newTab = this.stateManager.createImageTab(
      imageUrl,
      imageBlob,
      title || 'Image Discussion',
      imageButtonElement
    );

    // If explanation provided, add it as first message
    if (explanation) {
      const explanationMessage: ChatMessage = {
        role: 'assistant',
        content: explanation,
        timestamp: Date.now(),
      };
      newTab.messages = [explanationMessage];

      // Save explanation to storage (delegated to storage service)
      await this.storageService.saveImageChatHistory(this.currentPaper.id, imageUrl, [explanationMessage]);
    } else {
      // Load existing chat history (delegated to storage service)
      const messages = await this.storageService.loadImageChatHistory(this.currentPaper.id, imageUrl);
      newTab.messages = messages;
    }

    // Switch to new tab
    this.stateManager.setActiveTabId(newTab.id);

    // Setup compass tracking for the new image tab
    if (this.container) {
      this.compassTracker.setupTracking(newTab, this.container, () => this.render());
    }

    // Show chatbox and render
    await this.show();
    this.render();

    // Save tabs to storage
    await this.saveTabs();

    logger.debug('CONTENT_SCRIPT', '[Kuma Chat] ✓ Image tab created:', imageUrl);
  }

  /**
   * Update an image tab's explanation
   */
  async updateImageTabExplanation(imageUrl: string, explanation: string, title?: string): Promise<void> {
    logger.debug('CONTENT_SCRIPT', '[Kuma Chat] 🔍 updateImageTabExplanation called with URL:', imageUrl);
    logger.debug('CONTENT_SCRIPT', '[Kuma Chat] 🔍 Title:', title);
    logger.debug('CONTENT_SCRIPT', '[Kuma Chat] 🔍 Explanation (first 100 chars):', explanation?.substring(0, 100));

    // Log ALL tabs to see if there are multiple
    const allTabs = this.stateManager.getTabs();
    logger.debug('CONTENT_SCRIPT', '[Kuma Chat] 🔍 All tabs:', allTabs.map(t => ({ id: t.id, type: t.type, imageUrl: t.imageUrl, title: t.title })));

    const tab = this.stateManager.getTabByImageUrl(imageUrl);
    if (!tab || !this.currentPaper) {
      logger.warn('CONTENT_SCRIPT', '[Kuma Chat] Image tab not found for explanation update:', imageUrl);
      return;
    }

    logger.debug('CONTENT_SCRIPT', '[Kuma Chat] 🔍 Found tab:', tab.id, 'with imageUrl:', tab.imageUrl);
    logger.debug('CONTENT_SCRIPT', '[Kuma Chat] 🔍 Tab current title:', tab.title);
    logger.debug('CONTENT_SCRIPT', '[Kuma Chat] 🔍 First message content:', tab.messages[0]?.content?.substring(0, 50));

    // Check if the first message is a loading message
    if (tab.messages.length > 0 && tab.messages[0].content === '___LOADING_EXPLANATION___') {
      // Replace loading message with actual explanation
      tab.messages[0] = {
        role: 'assistant',
        content: explanation,
        timestamp: Date.now(),
      };

      // Update tab title if provided
      if (title) {
        tab.title = title;
      }

      // Save chat history to database (delegated to storage service)
      await this.storageService.saveImageChatHistory(this.currentPaper.id, imageUrl, tab.messages);

      // Also store the image explanation separately (for button state restoration)
      // This ensures the image button shows "explained" state after page refresh
      try {
        logger.debug('CONTENT_SCRIPT', '[Kuma Chat] 🔍 Storing explanation in updateImageTabExplanation with URL:', imageUrl);
        logger.debug('CONTENT_SCRIPT', '[Kuma Chat] 🔍 Tab title:', tab.title);
        logger.debug('CONTENT_SCRIPT', '[Kuma Chat] 🔍 Paper ID:', this.currentPaper.id);
        await ChromeService.storeImageExplanation(
          this.currentPaper.id,
          imageUrl,
          tab.title,
          explanation
        );
        logger.debug('CONTENT_SCRIPT', '[Kuma Chat] ✓ Stored explanation for button state');
      } catch (error) {
        logger.error('CONTENT_SCRIPT', '[Kuma Chat] Failed to store image explanation:', error);
      }

      // Save tabs to storage (updates the title in settings)
      await this.saveTabs();

      // Re-render to show the updated explanation and title
      this.render();

      logger.debug('CONTENT_SCRIPT', '[Kuma Chat] ✓ Updated image tab with generated explanation and title');
    } else {
      logger.warn('CONTENT_SCRIPT', '[Kuma Chat] First message is not a loading message, skipping update');
    }
  }

  /**
   * Close a tab
   * Delegates to event manager
   */
  async closeTab(tabId: string): Promise<void> {
    await this.eventManager.handleCloseTab(tabId);
  }

  /**
   * Switch to a tab
   * Delegates to event manager but also handles compass tracking
   */
  async switchTab(tabId: string): Promise<void> {
    this.eventManager.handleSwitchTab(tabId);

    // Setup compass tracking for image tabs
    const tab = this.stateManager.getTabById(tabId);
    if (tab && tab.type === 'image' && this.container) {
      this.compassTracker.setupTracking(tab, this.container, () => this.render());
    } else {
      this.cleanupCompassTracking();
    }
  }

  /**
   * Minimize the chatbox
   */
  minimize() {
    this.settings.minimized = !this.settings.minimized;
    this.storageService.saveMinimized(this.settings.minimized);
    this.render();
  }

  /**
   * Toggle transparency
   * Delegates to event manager
   */
  toggleTransparency() {
    this.eventManager.handleToggleTransparency();
    // Need to re-fetch settings from storage service
    this.settings.transparencyEnabled = !this.settings.transparencyEnabled;
  }

  /**
   * Handle position change
   */
  private async handlePositionChange(position: ChatboxPosition, shouldSave = true) {
    this.settings.position = position;
    if (shouldSave) {
      await this.eventManager.handlePositionChange(position);
    }
    // Re-render to update compass arrow angle with new chatbox position
    this.render();
  }

  /**
   * Handle first interaction
   */
  private handleFirstInteraction() {
    this.hasInteractedSinceOpen = true;
  }

  /**
   * Get compass arrow angle for a tab
   * Delegates to compass tracker with chatbox position and shadow root
   */
  private getCompassArrowAngle(tabId: string): number | undefined {
    const tab = this.stateManager.getTabById(tabId);
    if (!tab) return undefined;

    // Need to calculate angle with current position and shadow root
    return this.compassTracker.getCompassAngle(tab, this.settings.position, this.shadowRoot);
  }

  /**
   * Cleanup compass tracking
   * Delegates to compass tracker
   */
  private cleanupCompassTracking() {
    this.compassTracker.cleanup();
  }

  /**
   * Render the chatbox UI
   * Delegates to renderer with all necessary context and callbacks
   */
  private render() {
    if (!this.shadowRoot || !this.isInitialized) {
      return;
    }

    // Build render context
    const context: ChatboxRenderContext = {
      shadowRoot: this.shadowRoot,
      isInitialized: this.isInitialized,
      settings: this.settings,
      currentPaper: this.currentPaper,
      tabs: this.stateManager.getTabs(),
      activeTabId: this.stateManager.getActiveTabId(),
      isRegeneratingExplanation: this.isRegeneratingExplanation,
      isGeneratingEmbeddings: this.isGeneratingEmbeddings,
      hasEmbeddings: this.hasEmbeddings,
      embeddingProgress: this.embeddingProgress,
      hasInteractedSinceOpen: this.hasInteractedSinceOpen,
      initialInputValue: this.initialInputValue,
      getCompassAngle: this.getCompassArrowAngle.bind(this),
    };

    // Build callbacks
    const callbacks: ChatboxRenderCallbacks = {
      onSwitchTab: this.switchTab.bind(this),
      onCloseTab: this.closeTab.bind(this),
      onSendMessage: this.eventManager.handleSendMessage.bind(this.eventManager),
      onClearMessages: this.eventManager.handleClearMessages.bind(this.eventManager),
      onRegenerateExplanation: this.eventManager.handleRegenerateExplanation.bind(this.eventManager),
      onScrollToImage: this.eventManager.handleScrollToImage.bind(this.eventManager),
      onClose: this.hide.bind(this),
      onMinimize: this.minimize.bind(this),
      onPositionChange: this.handlePositionChange.bind(this),
      onToggleTransparency: this.toggleTransparency.bind(this),
      onFirstInteraction: this.handleFirstInteraction.bind(this),
    };

    // Delegate rendering to renderer
    this.renderer.render(context, callbacks);
  }

  /**
   * Destroy the chatbox
   */
  destroy() {
    this.cleanupCompassTracking();
    if (this.container && this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }
    this.container = null;
    this.shadowRoot = null;
    this.isInitialized = false;
  }
}

// Singleton instance
export const chatboxInjector = new ChatboxInjector();
