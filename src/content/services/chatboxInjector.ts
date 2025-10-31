import { h, render } from 'preact';
import { ChatBox } from '../components/ChatBox.tsx';
import { ChatMessage, ChatboxSettings, ChatboxPosition, StoredPaper, ChatTab, ConversationState, SourceInfo } from '../../types/index.ts';
import * as ChromeService from '../../services/ChromeService.ts';
import { imageExplanationHandler } from './imageExplanationHandler.ts';
import { logger } from '../../utils/logger.ts';
import { normalizeUrl } from '../../utils/urlUtils.ts';

// Default position and size
const DEFAULT_POSITION: ChatboxPosition = {
  x: window.innerWidth - 420,
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

/**
 * Internal tab state (richer than ChatTab with streaming state)
 */
interface TabState {
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
  imageButtonElement?: HTMLElement;
}

class ChatboxInjector {
  private container: HTMLDivElement | null = null;
  private shadowRoot: ShadowRoot | null = null;
  private settings: ChatboxSettings = DEFAULT_SETTINGS;
  private tabs: TabState[] = []; // Multi-tab state
  private activeTabId: string = 'paper'; // Currently active tab
  private currentPaper: StoredPaper | null = null;
  private isInitialized = false;
  private hasInteractedSinceOpen = false;
  private scrollListener: (() => void) | null = null;
  private documentScrollListener: (() => void) | null = null;
  private resizeListener: (() => void) | null = null;
  private previousCompassAngle: number | null = null; // Track previous angle to prevent 360° spins

  // Performance optimization: Intersection Observers
  private chatboxObserver: IntersectionObserver | null = null;
  private imageButtonObserver: IntersectionObserver | null = null;
  private isChatboxVisible = true;
  private isImageButtonVisible = true;

  // Performance optimization: Idle detection
  private idleTimer: number | null = null;
  private isUserIdle = false;
  private lastActivityTime = Date.now();
  private idleTimeoutMs = 3000; // 3 seconds of inactivity before pausing
  private activityListener: (() => void) | null = null;

  private initialInputValue = '';
  private isRegeneratingExplanation = false;
  private isGeneratingEmbeddings = false; // Track if embeddings are being generated
  private hasEmbeddings = false; // Track if embeddings have been generated
  private embeddingProgress = ''; // Track embedding progress message

  /**
   * Wait for page to be fully loaded
   */
  private async waitForPageReady(): Promise<void> {
    // If document already loaded, resolve immediately
    if (document.readyState === 'complete') {
      return;
    }

    // Otherwise wait for load event
    return new Promise((resolve) => {
      window.addEventListener('load', () => resolve(), { once: true });
    });
  }

  /**
   * Wait for URL to stabilize (important for SPAs that change URL dynamically)
   */
  private async waitForStableUrl(): Promise<string> {
    let currentUrl = window.location.href;
    let stableCount = 0;

    // Check URL every 100ms, need 3 consecutive matches to consider it stable
    while (stableCount < 3) {
      await new Promise(resolve => setTimeout(resolve, 100));
      if (window.location.href === currentUrl) {
        stableCount++;
      } else {
        currentUrl = window.location.href;
        stableCount = 0;
      }
    }

    return currentUrl;
  }

  async initialize() {
    if (this.isInitialized) {
      logger.debug('CONTENT_SCRIPT', '[Kuma Chat] Already initialized');
      return;
    }

    logger.debug('CONTENT_SCRIPT', '[Kuma Chat] Starting initialization...');

    try {
      // Wait for page to be fully loaded
      await this.waitForPageReady();

      // Wait for URL to stabilize (important for SPAs)
      const stableUrl = await this.waitForStableUrl();

      // Fetch current paper from database
      const { getPaperFromDBByUrl } = await import('../../services/ChromeService.ts');
      this.currentPaper = await getPaperFromDBByUrl(stableUrl);

      // Load saved settings from Chrome storage
      await this.loadSettings();

      // Create container
      this.container = document.createElement('div');
      this.container.id = 'kuma-chatbox-container';
      this.container.style.cssText = 'all: initial; position: fixed; z-index: 2147483647;';

      // Create shadow DOM for style isolation
      this.shadowRoot = this.container.attachShadow({ mode: 'open' });

      // Add styles to shadow DOM
      const styleSheet = document.createElement('style');
      const styles = await this.loadStyles();
      styleSheet.textContent = styles;
      this.shadowRoot.appendChild(styleSheet);

      // Create root element for Preact
      const rootElement = document.createElement('div');
      this.shadowRoot.appendChild(rootElement);

      // Append to body
      document.body.appendChild(this.container);

      this.isInitialized = true;

      // Initialize with default paper tab
      await this.initializePaperTab();

      // Note: restoreTabs() will be called later, after image buttons are created
      // (See content.ts - called after setupImageExplanations)

      // Render initial state
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
    // Always create a paper tab
    const paperTab: TabState = {
      id: 'paper',
      type: 'paper',
      title: this.currentPaper?.title || 'Paper Chat',
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

    // Load paper chat history if paper is available
    if (this.currentPaper) {
      await this.loadPaperChatHistory();
    }
  }

  private async loadStyles(): Promise<string> {
    // Try to load CSS file from build output
    try {
      const cssUrl = chrome.runtime.getURL('src/content/components/chatbox.css');
      const response = await fetch(cssUrl);
      if (response.ok) {
        const css = await response.text();
        return css;
      }
      throw new Error(`Failed to fetch CSS: ${response.status}`);
    } catch (error) {
      logger.warn('CONTENT_SCRIPT', '[Kuma Chat] Failed to load external CSS, using inline styles:', error);
      // Fallback: Return minimal inline styles
      return this.getInlineStyles();
    }
  }

  private getInlineStyles(): string {
    // Inline fallback styles
    return `
      /* Kuma Chatbox Inline Styles */
      * { box-sizing: border-box; }

      .kuma-chatbox {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        background: white;
        border-radius: 12px;
        box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);
        display: flex;
        flex-direction: column;
        overflow: hidden;
        position: relative;
        transition: opacity 0.2s ease-in-out;
      }

      .chatbox-header {
        background: linear-gradient(135deg, oklch(37.9% 0.146 265.522) 0%, oklch(42.4% 0.199 265.638) 100%);
        color: white;
        padding: 12px 16px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        cursor: move;
        user-select: none;
        flex-shrink: 0;
      }

      .chatbox-controls {
        display: flex;
        gap: 4px;
      }

      .chatbox-control-btn {
        background: rgba(255, 255, 255, 0.2);
        border: none;
        border-radius: 4px;
        color: white;
        cursor: pointer;
        padding: 4px;
        display: flex;
      }

      .chatbox-control-btn:hover {
        background: rgba(255, 255, 255, 0.3);
      }

      .chatbox-messages {
        flex: 1;
        overflow-y: auto;
        padding: 16px;
        background: #f9fafb;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }

      .chatbox-messages::-webkit-scrollbar {
        width: 8px;
      }

      .chatbox-messages::-webkit-scrollbar-track {
        background: transparent;
      }

      .chatbox-messages::-webkit-scrollbar-thumb {
        background: #d1d5db;
        border-radius: 4px;
      }

      .chatbox-messages::-webkit-scrollbar-thumb:hover {
        background: #9ca3af;
      }

      .chatbox-input-container {
        display: flex;
        gap: 8px;
        padding: 12px 16px;
        background: white;
        border-top: 1px solid #e5e7eb;
        align-items: flex-end;
      }

      .chatbox-input-wrapper {
        flex: 1;
        position: relative;
        display: flex;
        align-items: flex-end;
      }

      .chatbox-input {
        flex: 1;
        border: 1px solid #d1d5db;
        border-radius: 8px;
        padding: 10px 36px 10px 12px;
        font-size: 14px;
        font-family: inherit;
        resize: none;
        outline: none;
        transition: border-color 0.2s;
      }

      .chatbox-input:focus {
        border-color: #6366f1;
      }

      .chatbox-input:disabled {
        background: #f3f4f6;
        cursor: not-allowed;
        opacity: 0.6;
      }

      .chatbox-input::placeholder {
        color: #9ca3af;
      }

      .chatbox-input-clear-btn {
        position: absolute;
        right: 8px;
        bottom: 10px;
        background: transparent;
        border: none;
        color: #9ca3af;
        cursor: pointer;
        padding: 4px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 4px;
        transition: all 0.2s;
      }

      .chatbox-input-clear-btn:hover {
        background: #f3f4f6;
        color: #6b7280;
        transform: scale(1.1);
      }

      .chatbox-input-clear-btn:active {
        transform: scale(0.95);
      }

      .chatbox-send-btn {
        background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
        border: none;
        border-radius: 8px;
        color: white;
        cursor: pointer;
        padding: 10px 12px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: opacity 0.2s, transform 0.1s;
        flex-shrink: 0;
      }

      .chatbox-send-btn:hover:not(:disabled) {
        transform: scale(1.05);
      }

      .chatbox-send-btn:active:not(:disabled) {
        transform: scale(0.95);
      }

      .chatbox-send-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .chatbox-message {
        display: flex;
        flex-direction: column;
        gap: 4px;
        max-width: 85%;
        animation: slideIn 0.2s ease-out;
      }

      @keyframes slideIn {
        from {
          opacity: 0;
          transform: translateY(8px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      .chatbox-message-user {
        align-self: flex-end;
      }

      .chatbox-message-assistant {
        align-self: flex-start;
      }

      .chatbox-message-content {
        background: white;
        padding: 10px 14px;
        border-radius: 12px;
        font-size: 14px;
        line-height: 1.3;
        word-wrap: break-word;
      }

      /* Markdown content styling with compact spacing */
      .markdown-content {
        line-height: 1.4;
      }

      .markdown-content > * {
        margin: 0;
      }

      .markdown-content > * + * {
        margin-top: 0.5em;
      }

      .markdown-content p {
        margin: 0;
      }

      .markdown-content p + p {
        margin-top: 0.5em;
      }

      .markdown-content strong {
        font-weight: 600;
        color: inherit;
      }

      .markdown-content em {
        font-style: italic;
      }

      .markdown-content code {
        background: rgba(0, 0, 0, 0.05);
        padding: 2px 4px;
        border-radius: 3px;
        font-family: monospace;
        font-size: 0.9em;
      }

      .markdown-content ul,
      .markdown-content ol {
        margin: 0.5em 0;
        padding-left: 1.5em;
      }

      .markdown-content li {
        margin: 0.2em 0;
      }

      .chatbox-message-user .chatbox-message-content {
        background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
        color: white;
        border-bottom-right-radius: 4px;
      }

      .chatbox-message-assistant .chatbox-message-content {
        background: white;
        color: #1f2937;
        border-bottom-left-radius: 4px;
        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
      }

      .chatbox-message-role {
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        opacity: 0.6;
        margin-bottom: 2px;
      }

      .chatbox-message-user .chatbox-message-role {
        text-align: right;
        color: #6366f1;
      }

      .chatbox-message-assistant .chatbox-message-role {
        color: #8b5cf6;
      }

      .chatbox-message-sources {
        padding: 0 14px;
        font-size: 11px;
        color: #6b7280;
        margin-top: 4px;
      }

      .chatbox-cursor {
        display: inline-block;
        animation: blink 1s step-end infinite;
        margin-left: 2px;
      }

      @keyframes blink {
        0%, 50% {
          opacity: 1;
        }
        51%, 100% {
          opacity: 0;
        }
      }

      .chatbox-empty {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        color: #6b7280;
        text-align: center;
        padding: 32px 16px;
      }

      /* Resize handles */
      .resize-handle {
        position: absolute;
        background: transparent;
        z-index: 100;
        transition: background 0.2s;
      }

      .resize-handle:hover {
        background: rgba(99, 102, 241, 0.15);
      }

      .resize-n,
      .resize-s {
        left: 0;
        right: 0;
        height: 12px;
        cursor: ns-resize;
      }

      .resize-n {
        top: 0;
      }

      .resize-s {
        bottom: 0;
      }

      .resize-e,
      .resize-w {
        top: 0;
        bottom: 0;
        width: 12px;
        cursor: ew-resize;
      }

      .resize-e {
        right: 0;
      }

      .resize-w {
        left: 0;
      }

      .resize-ne,
      .resize-nw,
      .resize-se,
      .resize-sw {
        width: 24px;
        height: 24px;
      }

      .resize-ne {
        top: 0;
        right: 0;
        cursor: nesw-resize;
      }

      .resize-nw {
        top: 0;
        left: 0;
        cursor: nwse-resize;
      }

      .resize-se {
        bottom: 0;
        right: 0;
        cursor: nwse-resize;
      }

      .resize-sw {
        bottom: 0;
        left: 0;
        cursor: nesw-resize;
      }

      .kuma-chatbox-minimized {
        background: white;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        transition: opacity 0.2s ease-in-out;
      }

      .chatbox-header-minimized {
        background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
        color: white;
        padding: 10px 14px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        cursor: move;
        min-width: 200px;
        border-radius: 8px;
      }

      .flex { display: flex; }
      .items-center { align-items: center; }
      .justify-between { justify-content: space-between; }
      .gap-1 { gap: 4px; }
      .gap-2 { gap: 8px; }
      .flex-1 { flex: 1; }
      .flex-shrink-0 { flex-shrink: 0; }
      .min-w-0 { min-width: 0; }
      .w-4 { width: 16px; height: 16px; }
      .h-4 { height: 16px; }
      .w-5 { width: 20px; height: 20px; }
      .h-5 { height: 20px; }

      /* SVG specific styles */
      svg {
        flex-shrink: 0;
      }
      .w-12 { width: 48px; }
      .h-12 { height: 48px; }
      .mb-4 { margin-bottom: 16px; }
      .text-xs { font-size: 12px; }
      .text-sm { font-size: 14px; }
      .font-medium { font-weight: 500; }
      .opacity-20 { opacity: 0.2; }
      .opacity-50 { opacity: 0.5; }
      .opacity-75 { opacity: 0.75; }
      .truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

      /* Modal styles */
      .modal-overlay {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: -10px;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1000;
        animation: fadeIn 0.2s ease-out;
        backdrop-filter: blur(2px);
      }

      .modal-dialog {
        background: white;
        border-radius: 12px;
        box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
        max-width: 400px;
        width: 90%;
        animation: modalSlideIn 0.2s ease-out;
      }

      .modal-header {
        font-size: 18px;
        font-weight: 600;
        padding: 20px 24px 12px;
        color: #1f2937;
        border-bottom: 1px solid #e5e7eb;
      }

      .modal-body {
        padding: 20px 24px;
        font-size: 14px;
        line-height: 1.6;
        color: #4b5563;
      }

      .modal-footer {
        padding: 16px 24px;
        display: flex;
        gap: 12px;
        justify-content: flex-end;
        border-top: 1px solid #e5e7eb;
      }

      .modal-btn {
        padding: 8px 16px;
        border: none;
        border-radius: 8px;
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s ease;
      }

      .modal-btn:hover {
        transform: translateY(-1px);
      }

      .modal-btn:active {
        transform: translateY(0);
      }

      .modal-btn-cancel {
        background: #e5e7eb;
        color: #374151;
      }

      .modal-btn-cancel:hover {
        background: #d1d5db;
      }

      .modal-btn-confirm {
        background: #ef4444;
        color: white;
      }

      .modal-btn-confirm:hover {
        background: #dc2626;
      }

      @keyframes fadeIn {
        from {
          opacity: 0;
        }
        to {
          opacity: 1;
        }
      }

      @keyframes modalSlideIn {
        from {
          opacity: 0;
          transform: scale(0.95) translateY(-10px);
        }
        to {
          opacity: 1;
          transform: scale(1) translateY(0);
        }
      }
    `;
  }

  private async loadSettings() {
    try {
      const stored = await chrome.storage.local.get('chatboxSettings');
      if (stored.chatboxSettings) {
        this.settings = {
          ...DEFAULT_SETTINGS,
          ...stored.chatboxSettings,
        };

        // Load per-URL visibility state
        const currentUrl = normalizeUrl(window.location.href);
        const visibilityMap = this.settings.visibilityByUrl || {};
        this.settings.visible = visibilityMap[currentUrl] ?? false;

        // Ensure position is within viewport bounds
        this.settings.position.x = Math.max(0, Math.min(this.settings.position.x, window.innerWidth - this.settings.position.width));
        this.settings.position.y = Math.max(0, Math.min(this.settings.position.y, window.innerHeight - this.settings.position.height));
      }
    } catch (error) {
      logger.error('CONTENT_SCRIPT', '[Kuma Chat] Failed to load settings:', error);
    }
  }

  private async saveSettings() {
    try {
      // Convert tabs to serializable format (strip out blobs, elements, messages)
      const serializableTabs = this.tabs
        .filter(tab => tab.type === 'image') // Only save image tabs (paper tab is auto-created)
        .map(tab => ({
          id: tab.id,
          type: tab.type,
          title: tab.title,
          imageUrl: tab.imageUrl,
        }));

      this.settings.activeTabs = serializableTabs as ChatTab[];
      this.settings.activeTabId = this.activeTabId;

      // Save per-URL visibility state
      const currentUrl = normalizeUrl(window.location.href);
      if (!this.settings.visibilityByUrl) {
        this.settings.visibilityByUrl = {};
      }
      this.settings.visibilityByUrl[currentUrl] = this.settings.visible;

      // Cleanup: Keep only last 100 URLs to prevent unbounded storage growth
      const MAX_URLS = 100;
      const urlEntries = Object.entries(this.settings.visibilityByUrl);
      if (urlEntries.length > MAX_URLS) {
        // Keep only the most recent MAX_URLS entries (FIFO)
        // Note: This simple implementation removes oldest entries when limit exceeded
        const urlsToKeep = urlEntries.slice(-MAX_URLS);
        this.settings.visibilityByUrl = Object.fromEntries(urlsToKeep);
      }

      await chrome.storage.local.set({ chatboxSettings: this.settings });
      logger.debug('CONTENT_SCRIPT', '[Kuma Chat] Settings saved successfully');
    } catch (error) {
      logger.error('CONTENT_SCRIPT', '[Kuma Chat] Failed to save settings:', error);
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
   * Restore saved tabs from settings (call after image buttons are created)
   */
  async restoreTabs() {
    if (!this.settings.activeTabs || this.settings.activeTabs.length === 0) {
      return;
    }

    for (const savedTab of this.settings.activeTabs) {
      if (savedTab.type !== 'image' || !savedTab.imageUrl) {
        continue;
      }

      try {
        // Get image state from image explanation handler
        const imageState = imageExplanationHandler.getImageStateByUrl(savedTab.imageUrl);

        if (!imageState || !imageState.buttonContainer) {
          logger.warn('CONTENT_SCRIPT', '[Kuma Chat] Could not find image state for saved tab:', savedTab.title);
          continue;
        }

        // Get the image element to fetch blob
        const img = imageState.element;

        if (!img) {
          continue;
        }

        // Fetch image blob
        const response = await fetch(savedTab.imageUrl);
        const blob = await response.blob();

        // Recreate the tab
        const imageTab: TabState = {
          id: savedTab.id,
          type: 'image',
          title: savedTab.title,
          messages: [],
          isStreaming: false,
          streamingMessage: '',
          conversationState: {
            summary: null,
            recentMessages: [],
            lastSummarizedIndex: -1,
            summaryCount: 0,
          },
          imageUrl: savedTab.imageUrl,
          imageBlob: blob,
          imageButtonElement: imageState.buttonContainer,
        };

        // Add to tabs
        this.tabs.push(imageTab);

        // Load chat history
        if (this.currentPaper) {
          await this.loadImageChatHistory(imageTab.id, this.currentPaper.id, savedTab.imageUrl);
        }

        // If no chat history exists, check for a stored explanation and seed it as the first message
        if (imageTab.messages.length === 0) {
          try {
            const response = await ChromeService.getImageExplanation(this.currentPaper.id, savedTab.imageUrl);
            if (response.success && response.explanation) {
              // Ensure content is a string (defensive check for structured output issues)
              let content: string;
              if (typeof response.explanation.explanation === 'string') {
                content = response.explanation.explanation;
              } else {
                logger.warn('CONTENT_SCRIPT', '[Kuma Chat] explanation is not a string, stringifying:', typeof response.explanation.explanation);
                content = JSON.stringify(response.explanation.explanation);
              }

              // Add the explanation as the first assistant message
              imageTab.messages.push({
                role: 'assistant',
                content,
                timestamp: Date.now(),
              });
            }
          } catch (error) {
            logger.error('CONTENT_SCRIPT', '[Kuma Chat] Error loading initial explanation for restored tab:', error);
          }
        }

        logger.debug('CONTENT_SCRIPT', '[Kuma Chat] ✓ Restored tab:', savedTab.title, 'with', imageTab.messages.length, 'messages');
      } catch (error) {
        logger.error('CONTENT_SCRIPT', '[Kuma Chat] Error restoring tab:', savedTab.title, error);
      }
    }

    // Restore active tab if it still exists
    if (this.settings.activeTabId) {
      const tabExists = this.tabs.find(t => t.id === this.settings.activeTabId);
      if (tabExists) {
        this.activeTabId = this.settings.activeTabId;
      }
    }

    // Set up compass tracking if active tab is an image tab
    const activeTab = this.tabs.find(t => t.id === this.activeTabId);
    if (activeTab && activeTab.type === 'image') {
      this.setupCompassTracking();
    }

    // Render to show restored tabs
    this.render();
    logger.debug('CONTENT_SCRIPT', '[Kuma Chat] ✓ Tabs restored and rendered');
  }

  /**
   * Load paper chat history into the paper tab
   */
  private async loadPaperChatHistory() {
    if (!this.currentPaper) {
      return;
    }

    try {
      const paper = await ChromeService.getPaperFromDBByUrl(this.currentPaper.url);
      const paperTab = this.tabs.find(t => t.id === 'paper');

      if (paperTab) {
        if (paper && paper.chatHistory) {
          paperTab.messages = paper.chatHistory;
          paperTab.conversationState = paper.conversationState || {
            summary: null,
            recentMessages: [],
            lastSummarizedIndex: -1,
            summaryCount: 0,
          };
        } else {
          paperTab.messages = [];
        }

        // Update title if paper changed
        paperTab.title = paper?.title || 'Paper Chat';
      }
    } catch (error) {
      logger.error('CONTENT_SCRIPT', '[Kuma Chat] Failed to load paper chat history:', error);
    }
  }

  /**
   * Load image chat history into an image tab
   */
  private async loadImageChatHistory(tabId: string, paperId: string, imageUrl: string) {
    try {
      const response = await ChromeService.getImageChatHistory(paperId, imageUrl);
      const imageTab = this.tabs.find(t => t.id === tabId);

      if (imageTab && response.success && response.chatHistory) {
        imageTab.messages = response.chatHistory;
      }
    } catch (error) {
      logger.error('CONTENT_SCRIPT', '[Kuma Chat] Failed to load image chat history:', error);
    }
  }

  /**
   * Save paper chat history
   */
  private async savePaperChatHistory() {
    if (!this.currentPaper) {
      return;
    }

    try {
      const paperTab = this.tabs.find(t => t.id === 'paper');
      if (paperTab) {
        await ChromeService.updateChatHistory(this.currentPaper.url, paperTab.messages);
      }
    } catch (error) {
      logger.error('CONTENT_SCRIPT', '[Kuma Chat] Failed to save paper chat history:', error);
    }
  }

  /**
   * Save image chat history
   */
  private async saveImageChatHistory(tabId: string, paperId: string, imageUrl: string) {
    try {
      const imageTab = this.tabs.find(t => t.id === tabId);
      if (imageTab) {
        await ChromeService.updateImageChatHistory(paperId, imageUrl, imageTab.messages);
      }
    } catch (error) {
      logger.error('CONTENT_SCRIPT', '[Kuma Chat] Failed to save image chat history:', error);
    }
  }

  private setupContextListener() {
    // Listen for streaming messages and operation state changes
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
   * Public method to allow direct calls from content.ts
   */
  async updatePaperContext(paper: StoredPaper | null) {
    this.currentPaper = paper;
    await this.loadPaperChatHistory();

    // Reload image tab histories if they were restored without paper context
    if (this.currentPaper) {
      for (const tab of this.tabs) {
        if (tab.type === 'image' && tab.imageUrl && tab.messages.length === 0) {
          await this.loadImageChatHistory(tab.id, this.currentPaper.id, tab.imageUrl);
        }
      }
    }

    this.render();
  }

  /**
   * Handle paper chat stream chunk
   */
  private handlePaperStreamChunk(chunk: string) {
    const paperTab = this.tabs.find(t => t.id === 'paper');
    if (paperTab) {
      paperTab.streamingMessage += chunk;
      this.render();
    }
  }

  /**
   * Handle paper chat stream end
   */
  private handlePaperStreamEnd(data: { fullMessage: string; sources?: string[]; sourceInfo?: SourceInfo[] }) {
    const paperTab = this.tabs.find(t => t.id === 'paper');
    if (!paperTab) return;

    paperTab.isStreaming = false;

    // Add assistant message to history
    const assistantMessage: ChatMessage = {
      role: 'assistant',
      content: data.fullMessage,
      timestamp: Date.now(),
      sources: data.sources,
      sourceInfo: data.sourceInfo,
    };

    paperTab.messages.push(assistantMessage);
    paperTab.streamingMessage = '';

    // Save to database
    this.savePaperChatHistory();

    this.render();
  }

  /**
   * Handle image chat stream chunk (route to correct tab)
   */
  private handleImageStreamChunk(chunk: string) {
    // Image stream chunks need to be routed to the correct image tab
    // For now, assume it's for the active tab if it's an image tab
    const activeTab = this.tabs.find(t => t.id === this.activeTabId);
    if (activeTab && activeTab.type === 'image') {
      activeTab.streamingMessage += chunk;
      this.render();
    }
  }

  /**
   * Handle image chat stream end (route to correct tab)
   */
  private handleImageStreamEnd(data: { fullMessage: string; sources?: string[]; sourceInfo?: SourceInfo[] }) {
    const activeTab = this.tabs.find(t => t.id === this.activeTabId);
    if (!activeTab || activeTab.type !== 'image') return;

    activeTab.isStreaming = false;

    // Add assistant message to history
    const assistantMessage: ChatMessage = {
      role: 'assistant',
      content: data.fullMessage,
      timestamp: Date.now(),
      sources: data.sources,
      sourceInfo: data.sourceInfo,
    };

    activeTab.messages.push(assistantMessage);
    activeTab.streamingMessage = '';

    // Save to database (need paperId and imageUrl)
    if (this.currentPaper && activeTab.imageUrl) {
      this.saveImageChatHistory(activeTab.id, this.currentPaper.id, activeTab.imageUrl);
    }

    this.render();
  }

  async toggle() {
    this.settings.visible = !this.settings.visible;

    if (this.settings.visible) {
      // Force expanded mode when opening
      this.settings.minimized = false;

      // Reset interaction state (transparency won't activate until user clicks)
      this.hasInteractedSinceOpen = false;

      // Load current paper context when opening
      await this.updateCurrentPaper();
      await this.loadPaperChatHistory();
    }

    await this.saveSettings();
    this.render();
  }

  async show() {
    if (!this.settings.visible) {
      await this.toggle();
    }
  }

  async hide() {
    if (this.settings.visible) {
      this.cleanupCompassTracking();
      this.settings.visible = false;
      await this.saveSettings();
      this.render();
    }
  }

  /**
   * Handle paper deletion
   * Closes chatbox and resets state when the current paper is deleted
   */
  async handlePaperDeletion() {
    logger.debug('CONTENT_SCRIPT', '[Kuma Chat] Handling paper deletion, resetting state...');

    // Hide the chatbox
    this.cleanupCompassTracking();
    this.settings.visible = false;

    // Reset paper reference
    this.currentPaper = null;

    // Reset to default paper tab with empty state
    await this.initializePaperTab();

    // Save settings (clears saved image tabs from storage)
    await this.saveSettings();

    // Re-render
    this.render();

    logger.debug('CONTENT_SCRIPT', '[Kuma Chat] ✓ Chatbox reset after paper deletion');
  }

  async openWithQuery(query: string) {
    // Set the initial input value
    this.initialInputValue = query;

    // Force chat open and expanded
    this.settings.visible = true;
    this.settings.minimized = false;

    // Reset interaction state
    this.hasInteractedSinceOpen = false;

    // Load current paper context if not already loaded
    await this.updateCurrentPaper();
    await this.loadPaperChatHistory();

    // Switch to paper tab
    this.activeTabId = 'paper';

    await this.saveSettings();
    this.render();

    // Clear the initial input value after a short delay to allow the component to read it
    setTimeout(() => {
      this.initialInputValue = '';
    }, 100);
  }

  /**
   * Open a new image chat tab
   */
  async openImageTab(
    imageUrl: string,
    imageBlob: Blob,
    imageButtonElement: HTMLElement | null | undefined,
    title: string,
    isGeneratingExplanation: boolean = false
  ): Promise<void> {
    if (!this.currentPaper) {
      logger.error('CONTENT_SCRIPT', '[Kuma Chat] No paper loaded, cannot open image tab');
      return;
    }

    // Generate tab ID using same hash logic as backend
    let hash = 0;
    for (let i = 0; i < imageUrl.length; i++) {
      const char = imageUrl.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    const tabId = `image-img_${Math.abs(hash)}`;

    // Check if tab already exists
    const existingTab = this.tabs.find(t => t.id === tabId);
    if (existingTab) {
      // Just switch to it
      this.activeTabId = tabId;
      this.settings.visible = true;
      this.settings.minimized = false;
      await this.saveSettings();
      this.render();
      return;
    }

    // Create new image tab
    const imageTab: TabState = {
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

    // Add to tabs first
    this.tabs.push(imageTab);

    // Load existing chat history if available
    await this.loadImageChatHistory(tabId, this.currentPaper.id, imageUrl);

    // If no chat history exists, check for a stored explanation and seed it as the first message
    if (imageTab.messages.length === 0) {
      if (isGeneratingExplanation) {
        // Add loading message with special marker
        imageTab.messages.push({
          role: 'assistant',
          content: '___LOADING_EXPLANATION___',
          timestamp: Date.now(),
        });
        logger.debug('CONTENT_SCRIPT', '[Kuma Chat] Added loading message for explanation generation');
      } else {
        try {
          const response = await ChromeService.getImageExplanation(this.currentPaper.id, imageUrl);
          if (response.success && response.explanation) {
            // Ensure content is a string (defensive check for structured output issues)
            let content: string;
            if (typeof response.explanation.explanation === 'string') {
              content = response.explanation.explanation;
            } else {
              logger.warn('CONTENT_SCRIPT', '[Kuma Chat] explanation is not a string, stringifying:', typeof response.explanation.explanation);
              content = JSON.stringify(response.explanation.explanation);
            }

            // Add the explanation as the first assistant message
            imageTab.messages.push({
              role: 'assistant',
              content,
              timestamp: Date.now(),
            });
            logger.debug('CONTENT_SCRIPT', '[Kuma Chat] Seeded initial explanation from cache');
          }
        } catch (error) {
          logger.error('CONTENT_SCRIPT', '[Kuma Chat] Error loading initial explanation:', error);
        }
      }
    }

    // Switch to this tab and show chatbox
    this.activeTabId = tabId;
    this.settings.visible = true;
    this.settings.minimized = false;
    this.hasInteractedSinceOpen = false;

    await this.saveSettings();

    // Set up compass tracking for this image tab
    this.setupCompassTracking();

    this.render();

    logger.debug('CONTENT_SCRIPT', '[Kuma Chat] ✓ Image tab opened:', tabId);
  }

  /**
   * Update image tab with generated explanation (replaces loading message)
   */
  async updateImageTabExplanation(imageUrl: string, explanation: string, title?: string): Promise<void> {
    // Find the image tab by imageUrl
    const imageTab = this.tabs.find(t => t.type === 'image' && t.imageUrl === imageUrl);

    if (!imageTab) {
      logger.warn('CONTENT_SCRIPT', '[Kuma Chat] Image tab not found for URL:', imageUrl);
      return;
    }

    // Check if the first message is a loading message
    if (imageTab.messages.length > 0 && imageTab.messages[0].content === '___LOADING_EXPLANATION___') {
      // Replace loading message with actual explanation
      imageTab.messages[0] = {
        role: 'assistant',
        content: explanation,
        timestamp: Date.now(),
      };

      // Update tab title if provided
      if (title) {
        imageTab.title = title;
      }

      // Save to database
      if (this.currentPaper) {
        await this.saveImageChatHistory(imageTab.id, this.currentPaper.id, imageUrl);
      }

      // Re-render to show the updated explanation and title
      this.render();

      logger.debug('CONTENT_SCRIPT', '[Kuma Chat] ✓ Updated image tab with generated explanation and title');
    } else {
      logger.warn('CONTENT_SCRIPT', '[Kuma Chat] First message is not a loading message, skipping update');
    }
  }

  /**
   * Close a tab
   */
  async closeTab(tabId: string): Promise<void> {
    // Cannot close paper tab
    if (tabId === 'paper') {
      logger.warn('CONTENT_SCRIPT', '[Kuma Chat] Cannot close paper tab');
      return;
    }

    const tabIndex = this.tabs.findIndex(t => t.id === tabId);
    if (tabIndex === -1) {
      logger.warn('CONTENT_SCRIPT', '[Kuma Chat] Tab not found:', tabId);
      return;
    }

    const tab = this.tabs[tabIndex];

    // Delete from IndexedDB if it's an image tab
    if (tab.type === 'image' && tab.imageUrl && this.currentPaper) {
      await ChromeService.clearImageChatHistory(this.currentPaper.id, tab.imageUrl);
    }

    // Remove from tabs
    this.tabs.splice(tabIndex, 1);

    // If we closed the active tab, switch to paper tab
    if (this.activeTabId === tabId) {
      this.activeTabId = 'paper';
      // Clean up compass tracking when switching to paper tab
      this.setupCompassTracking();
    }

    await this.saveSettings();
    this.render();

    logger.debug('CONTENT_SCRIPT', '[Kuma Chat] ✓ Tab closed:', tabId);
  }

  /**
   * Switch to a different tab
   */
  async switchTab(tabId: string): Promise<void> {
    const tab = this.tabs.find(t => t.id === tabId);
    if (!tab) {
      logger.warn('CONTENT_SCRIPT', '[Kuma Chat] Tab not found:', tabId);
      return;
    }

    this.activeTabId = tabId;
    await this.saveSettings();

    // Set up compass tracking for image tabs
    this.setupCompassTracking();

    this.render();

    logger.debug('CONTENT_SCRIPT', '[Kuma Chat] ✓ Switched to tab:', tabId);
  }

  minimize() {
    this.settings.minimized = !this.settings.minimized;
    this.saveSettings();
    this.render();
  }

  toggleTransparency() {
    this.settings.transparencyEnabled = !this.settings.transparencyEnabled;
    this.saveSettings();
    this.render();
  }

  private async updateCurrentPaper() {
    try {
      // Get current tab's paper URL
      const url = window.location.href;
      const paper = await ChromeService.getPaperFromDBByUrl(url);
      this.currentPaper = paper;
    } catch (error) {
      logger.error('CONTENT_SCRIPT', '[Kuma Chat] Failed to update current paper:', error);
      this.currentPaper = null;
    }
  }

  private async handleSendMessage(message: string) {
    if (!this.currentPaper) {
      logger.error('CONTENT_SCRIPT', '[Kuma Chat] No paper loaded');
      return;
    }

    const activeTab = this.tabs.find(t => t.id === this.activeTabId);
    if (!activeTab) {
      logger.error('CONTENT_SCRIPT', '[Kuma Chat] Active tab not found');
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
    if (activeTab.type === 'paper') {
      await this.savePaperChatHistory();
    } else if (activeTab.type === 'image' && activeTab.imageUrl) {
      await this.saveImageChatHistory(activeTab.id, this.currentPaper.id, activeTab.imageUrl);
    }

    this.render();

    // Send to background for processing
    try {
      if (activeTab.type === 'paper') {
        await ChromeService.sendChatMessage(this.currentPaper.url, message);
      } else if (activeTab.type === 'image' && activeTab.imageUrl && activeTab.imageBlob) {
        await ChromeService.sendImageChatMessage(
          this.currentPaper.id,
          activeTab.imageUrl,
          activeTab.imageBlob,
          message
        );
      }
    } catch (error) {
      logger.error('CONTENT_SCRIPT', '[Kuma Chat] Failed to send message:', error);
      activeTab.isStreaming = false;

      // Add error message
      const errorMessage: ChatMessage = {
        role: 'assistant',
        content: 'Sorry, I encountered an error processing your message. Please try again.',
        timestamp: Date.now(),
      };

      activeTab.messages.push(errorMessage);

      if (activeTab.type === 'paper') {
        await this.savePaperChatHistory();
      } else if (activeTab.type === 'image' && activeTab.imageUrl) {
        await this.saveImageChatHistory(activeTab.id, this.currentPaper.id, activeTab.imageUrl);
      }

      this.render();
    }
  }

  private async handleClearMessages() {
    if (!this.currentPaper) {
      logger.error('CONTENT_SCRIPT', '[Kuma Chat] No paper loaded');
      return;
    }

    const activeTab = this.tabs.find(t => t.id === this.activeTabId);
    if (!activeTab) {
      logger.error('CONTENT_SCRIPT', '[Kuma Chat] Active tab not found');
      return;
    }

    try {
      if (activeTab.type === 'paper') {
        // Paper tab: clear everything
        await ChromeService.clearChatHistory(this.currentPaper.url);
        activeTab.messages = [];
      } else if (activeTab.type === 'image' && activeTab.imageUrl) {
        // Image tab: preserve the first message (explanation) if it exists
        const hasExplanation = activeTab.messages.length > 0 && activeTab.messages[0].role === 'assistant';

        if (hasExplanation) {
          // Keep only the explanation message
          const explanationMessage = activeTab.messages[0];
          activeTab.messages = [explanationMessage];

          // Update database to store only the explanation
          await ChromeService.updateImageChatHistory(this.currentPaper.id, activeTab.imageUrl, [explanationMessage]);
        } else {
          // No explanation to preserve, clear everything
          activeTab.messages = [];
        }

        // Destroy AI session to start fresh conversation (but keep explanation visible)
        await ChromeService.clearImageChatHistory(this.currentPaper.id, activeTab.imageUrl);
      }

      logger.debug('CONTENT_SCRIPT', '[Kuma Chat] ✓ Chat history cleared for tab:', activeTab.id);

      // Re-render
      this.render();
    } catch (error) {
      logger.error('CONTENT_SCRIPT', '[Kuma Chat] Failed to clear chat history:', error);
    }
  }

  private async handleRegenerateExplanation() {
    if (!this.currentPaper) {
      logger.error('CONTENT_SCRIPT', '[Kuma Chat] No paper loaded');
      return;
    }

    const activeTab = this.tabs.find(t => t.id === this.activeTabId);
    if (!activeTab || activeTab.type !== 'image' || !activeTab.imageUrl) {
      logger.error('CONTENT_SCRIPT', '[Kuma Chat] Active tab is not an image tab');
      return;
    }

    // Set loading state
    this.isRegeneratingExplanation = true;
    this.render(); // Show loading immediately

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
        await ChromeService.updateImageChatHistory(this.currentPaper.id, activeTab.imageUrl, [activeTab.messages[0]]);

        // Destroy AI session for fresh conversation context
        await ChromeService.clearImageChatHistory(this.currentPaper.id, activeTab.imageUrl);

        logger.debug('CONTENT_SCRIPT', '[Kuma Chat] ✓ Explanation regenerated and conversation cleared');
      } else {
        logger.error('CONTENT_SCRIPT', '[Kuma Chat] Failed to regenerate explanation');
      }
    } catch (error) {
      logger.error('CONTENT_SCRIPT', '[Kuma Chat] Error regenerating explanation:', error);
    } finally {
      // Clear loading state
      this.isRegeneratingExplanation = false;
      this.render(); // Update UI
    }
  }

  private handleScrollToImage() {
    const activeTab = this.tabs.find(t => t.id === this.activeTabId);
    if (!activeTab || activeTab.type !== 'image' || !activeTab.imageUrl) {
      logger.error('CONTENT_SCRIPT', '[Kuma Chat] Cannot scroll - not an image tab');
      return;
    }

    // For screen captures, use the overlay element directly from the tab
    if (activeTab.imageUrl.startsWith('screen-capture-') || activeTab.imageUrl.startsWith('pdf-capture-')) {
      if (!activeTab.imageButtonElement) {
        logger.error('CONTENT_SCRIPT', '[Kuma Chat] No overlay element for screen capture');
        return;
      }

      const overlay = activeTab.imageButtonElement as HTMLDivElement;

      // Scroll to overlay
      overlay.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
        inline: 'center'
      });

      // Highlight overlay (make it visible temporarily with blue highlight)
      const originalOutline = overlay.style.outline;
      const originalOutlineOffset = overlay.style.outlineOffset;
      const originalOpacity = overlay.style.opacity;
      const originalBgColor = overlay.style.backgroundColor;

      overlay.style.outline = '3px solid #60a5fa';
      overlay.style.outlineOffset = '2px';
      overlay.style.opacity = '0.2';
      overlay.style.backgroundColor = 'rgba(96, 165, 250, 0.1)';

      setTimeout(() => {
        overlay.style.outline = originalOutline;
        overlay.style.outlineOffset = originalOutlineOffset;
        overlay.style.opacity = originalOpacity;
        overlay.style.backgroundColor = originalBgColor;
      }, 2000);

      logger.debug('CONTENT_SCRIPT', '[Kuma Chat] ✓ Scrolled to screen capture overlay');
      return;
    }

    // For regular images, get image state from image explanation handler
    const imageState = imageExplanationHandler.getImageStateByUrl(activeTab.imageUrl);
    if (!imageState || !imageState.element) {
      logger.error('CONTENT_SCRIPT', '[Kuma Chat] Image element not found for URL:', activeTab.imageUrl);
      return;
    }

    // Scroll to the image
    imageState.element.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
      inline: 'center'
    });

    // Add temporary highlight effect
    const originalOutline = imageState.element.style.outline;
    const originalOutlineOffset = imageState.element.style.outlineOffset;

    imageState.element.style.outline = '3px solid #60a5fa';
    imageState.element.style.outlineOffset = '2px';

    setTimeout(() => {
      imageState.element.style.outline = originalOutline;
      imageState.element.style.outlineOffset = originalOutlineOffset;
    }, 2000);

    logger.debug('CONTENT_SCRIPT', '[Kuma Chat] ✓ Scrolled to image:', activeTab.imageUrl);
  }

  private handlePositionChange(position: ChatboxPosition, shouldSave = true) {
    this.settings.position = position;
    if (shouldSave) {
      this.saveSettings(); // Only save to storage when shouldSave=true (e.g., on mouseup)
    }
    this.render(); // Always update UI for compass tracking
  }

  private handleFirstInteraction() {
    this.hasInteractedSinceOpen = true;
    this.render();
  }

  /**
   * Calculate compass arrow angle for image tabs
   */
  private getCompassArrowAngle(tabId: string): number {
    const tab = this.tabs.find(t => t.id === tabId);
    if (!tab || tab.type !== 'image' || !tab.imageButtonElement) {
      return 0;
    }

    // Get compass arrow position from actual element in shadow DOM
    const arrowElement = this.shadowRoot?.querySelector('.chatbox-compass-arrow') as SVGElement;
    let chatboxCenterX: number;
    let chatboxCenterY: number;

    if (arrowElement) {
      // Use actual arrow element position for precise tracking
      const arrowRect = arrowElement.getBoundingClientRect();
      chatboxCenterX = arrowRect.left + arrowRect.width / 2;
      chatboxCenterY = arrowRect.top + arrowRect.height / 2;
    } else {
      // Fallback to approximation if arrow not found
      chatboxCenterX = this.settings.position.x + this.settings.position.width / 2;
      chatboxCenterY = this.settings.position.y + 60;
    }

    // Get button position
    const buttonRect = tab.imageButtonElement.getBoundingClientRect();
    const buttonCenterX = buttonRect.left + buttonRect.width / 2;
    const buttonCenterY = buttonRect.top + buttonRect.height / 2;

    // Calculate raw angle
    const deltaX = buttonCenterX - chatboxCenterX;
    const deltaY = buttonCenterY - chatboxCenterY;
    let angle = Math.atan2(deltaY, deltaX) * (180 / Math.PI);

    // Normalize angle to prevent 360° spins during CSS transitions
    // Keep the new angle within ±180° of the previous angle
    if (this.previousCompassAngle !== null) {
      let diff = angle - this.previousCompassAngle;

      // If difference is greater than 180°, we crossed the boundary
      if (diff > 180) {
        angle -= 360;
      } else if (diff < -180) {
        angle += 360;
      }
    }

    // Store normalized angle for next comparison
    this.previousCompassAngle = angle;

    return angle;
  }

  /**
   * Check if compass updates should be paused (performance optimization)
   * Pauses when elements are off-screen or user is idle
   */
  private shouldPauseCompassUpdates(): boolean {
    // Pause if chatbox or image button is not visible
    if (!this.isChatboxVisible || !this.isImageButtonVisible) {
      return true;
    }
    // Pause if user is idle
    if (this.isUserIdle) {
      return true;
    }
    return false;
  }

  /**
   * Set up event listeners to track compass arrow position dynamically
   */
  private setupCompassTracking() {
    // Remove any existing listeners
    this.cleanupCompassTracking();

    // Only set up if active tab is an image tab
    const activeTab = this.tabs.find(t => t.id === this.activeTabId);
    if (!activeTab || activeTab.type !== 'image') {
      return;
    }

    // Reset angle tracking for fresh start
    this.previousCompassAngle = null;

    // Throttled render for performance (using requestAnimationFrame)
    let rafPending = false;
    const throttledRender = (bypassPauseCheck = false) => {
      // Only check pause for non-scroll/resize triggers
      // Scroll/resize events ARE user activity and should always update
      if (!bypassPauseCheck && this.shouldPauseCompassUpdates()) {
        return;
      }

      if (!rafPending) {
        rafPending = true;
        requestAnimationFrame(() => {
          this.render();
          rafPending = false;
        });
      }
    };

    // Listen to scroll events on both window and document
    // (Some sites use scrollable divs instead of window scroll)
    // Scroll events ARE user activity - always render (bypass pause check)
    this.scrollListener = () => throttledRender(true);
    window.addEventListener('scroll', this.scrollListener, { passive: true } as any);

    this.documentScrollListener = () => throttledRender(true);
    document.addEventListener('scroll', this.documentScrollListener, { passive: true, capture: true } as any);

    // Listen to resize events
    // Resize events also indicate user activity - always render (bypass pause check)
    this.resizeListener = () => throttledRender(true);
    window.addEventListener('resize', this.resizeListener);

    // Set up Intersection Observer for chatbox (performance optimization)
    // Pause updates when chatbox is off-screen
    if (this.container) {
      this.chatboxObserver = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            const wasVisible = this.isChatboxVisible;
            this.isChatboxVisible = entry.isIntersecting;

            // If just became visible and was paused, trigger a render
            // Respect pause check for visibility changes (don't bypass)
            if (!wasVisible && this.isChatboxVisible && !this.shouldPauseCompassUpdates()) {
              throttledRender(false);
            }
          });
        },
        { threshold: 0.1 } // Trigger when at least 10% visible
      );
      this.chatboxObserver.observe(this.container);
    }

    // Set up Intersection Observer for image button (performance optimization)
    // Pause updates when image button is off-screen
    if (activeTab.imageButtonElement) {
      this.imageButtonObserver = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            const wasVisible = this.isImageButtonVisible;
            this.isImageButtonVisible = entry.isIntersecting;

            // If just became visible and was paused, trigger a render
            // Respect pause check for visibility changes (don't bypass)
            if (!wasVisible && this.isImageButtonVisible && !this.shouldPauseCompassUpdates()) {
              throttledRender(false);
            }
          });
        },
        { threshold: 0.1 } // Trigger when at least 10% visible
      );
      this.imageButtonObserver.observe(activeTab.imageButtonElement);
    }

    // Set up idle detection (performance optimization)
    // Pause updates after 3 seconds of user inactivity
    const resetIdleTimer = () => {
      this.lastActivityTime = Date.now();

      // If was idle and now active, clear idle state and trigger render
      if (this.isUserIdle) {
        this.isUserIdle = false;
        if (!this.shouldPauseCompassUpdates()) {
          // Respect pause check for idle state changes (don't bypass)
          throttledRender(false);
        }
      }

      // Clear existing timer
      if (this.idleTimer !== null) {
        window.clearTimeout(this.idleTimer);
      }

      // Set new timer
      this.idleTimer = window.setTimeout(() => {
        this.isUserIdle = true;
      }, this.idleTimeoutMs);
    };

    // Track user activity with various events
    this.activityListener = resetIdleTimer;
    window.addEventListener('mousemove', this.activityListener, { passive: true } as any);
    window.addEventListener('scroll', this.activityListener, { passive: true } as any);
    window.addEventListener('keydown', this.activityListener, { passive: true } as any);
    window.addEventListener('touchstart', this.activityListener, { passive: true } as any);

    // Initialize idle timer
    resetIdleTimer();
  }

  /**
   * Clean up compass tracking event listeners
   */
  private cleanupCompassTracking() {
    // Clean up scroll and resize listeners
    if (this.scrollListener) {
      window.removeEventListener('scroll', this.scrollListener);
      this.scrollListener = null;
    }
    if (this.documentScrollListener) {
      document.removeEventListener('scroll', this.documentScrollListener, { capture: true } as any);
      this.documentScrollListener = null;
    }
    if (this.resizeListener) {
      window.removeEventListener('resize', this.resizeListener);
      this.resizeListener = null;
    }

    // Clean up Intersection Observers (performance optimization)
    if (this.chatboxObserver) {
      this.chatboxObserver.disconnect();
      this.chatboxObserver = null;
    }
    if (this.imageButtonObserver) {
      this.imageButtonObserver.disconnect();
      this.imageButtonObserver = null;
    }
    // Reset visibility state
    this.isChatboxVisible = true;
    this.isImageButtonVisible = true;

    // Clean up idle detection (performance optimization)
    if (this.activityListener) {
      window.removeEventListener('mousemove', this.activityListener);
      window.removeEventListener('scroll', this.activityListener);
      window.removeEventListener('keydown', this.activityListener);
      window.removeEventListener('touchstart', this.activityListener);
      this.activityListener = null;
    }
    if (this.idleTimer !== null) {
      window.clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    // Reset idle state
    this.isUserIdle = false;
    this.lastActivityTime = Date.now();

    // Reset angle tracking when disabling compass
    this.previousCompassAngle = null;
  }

  private render() {
    // logger.debug('CONTENT_SCRIPT', '[Kuma Chat] Render called, initialized:', this.isInitialized, 'visible:', this.settings.visible);

    if (!this.shadowRoot || !this.isInitialized) {
      return;
    }

    const rootElement = this.shadowRoot.querySelector('div');
    if (!rootElement) {
      return;
    }

    // Determine if chatbox should be disabled
    const isDisabled = !this.currentPaper || !this.currentPaper.chunkCount;
    const hasPaper = !!this.currentPaper;
    const hasChunked = !!(this.currentPaper && this.currentPaper.chunkCount > 0);

    if (!this.settings.visible) {
      render(null, rootElement);
      return;
    }

    // Get active tab
    const activeTab = this.tabs.find(t => t.id === this.activeTabId);
    if (!activeTab) {
      logger.error('CONTENT_SCRIPT', '[Kuma Chat] Active tab not found');
      return;
    }

    // Convert TabState[] to ChatTab[] for the ChatBox component
    const chatTabs: ChatTab[] = this.tabs.map(tab => ({
      id: tab.id,
      type: tab.type,
      title: tab.title,
      imageUrl: tab.imageUrl,
      imageBlob: tab.imageBlob,
      imageButtonElement: tab.imageButtonElement,
    }));

    // Calculate compass arrow angle if active tab is an image tab
    const compassArrowAngle = activeTab.type === 'image' ? this.getCompassArrowAngle(activeTab.id) : undefined;

    // logger.debug('CONTENT_SCRIPT', '[Kuma Chat] Rendering chatbox, disabled:', isDisabled, 'messages:', activeTab.messages.length);

    try {
      render(
        h(ChatBox, {
          // Multi-tab props (NEW)
          tabs: chatTabs,
          activeTabId: this.activeTabId,
          compassArrowAngle,
          onSwitchTab: this.switchTab.bind(this),
          onCloseTab: this.closeTab.bind(this),

          // Active tab messages
          messages: activeTab.messages,
          isStreaming: activeTab.isStreaming,
          streamingMessage: activeTab.streamingMessage,

          // Message handlers
          onSendMessage: this.handleSendMessage.bind(this),
          onClearMessages: this.handleClearMessages.bind(this),
          onRegenerateExplanation: this.handleRegenerateExplanation.bind(this),
          isRegenerating: this.isRegeneratingExplanation,
          onScrollToImage: this.handleScrollToImage.bind(this),

          // Window controls
          onClose: this.hide.bind(this),
          onMinimize: this.minimize.bind(this),
          isMinimized: this.settings.minimized,

          // Position
          initialPosition: this.settings.position,
          onPositionChange: this.handlePositionChange.bind(this),

          // State
          disabled: isDisabled,
          paperTitle: this.currentPaper?.title,
          hasPaper: hasPaper,
          hasChunked: hasChunked,
          isGeneratingEmbeddings: this.isGeneratingEmbeddings,
          hasEmbeddings: this.hasEmbeddings,
          embeddingProgress: this.embeddingProgress,

          // Transparency
          transparencyEnabled: this.settings.transparencyEnabled,
          onToggleTransparency: this.toggleTransparency.bind(this),
          hasInteractedSinceOpen: this.hasInteractedSinceOpen,
          onFirstInteraction: this.handleFirstInteraction.bind(this),

          // Initial input
          initialInputValue: this.initialInputValue,
        }),
        rootElement
      );
      // logger.debug('CONTENT_SCRIPT', '[Kuma Chat] ✓ Chatbox rendered successfully');
    } catch (error) {
      logger.error('CONTENT_SCRIPT', '[Kuma Chat] Error rendering chatbox:', error);
    }
  }

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
