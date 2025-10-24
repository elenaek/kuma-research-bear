import { h, render } from 'preact';
import { ChatBox } from '../components/ChatBox.tsx';
import { ChatMessage, ChatboxSettings, ChatboxPosition, StoredPaper } from '../../types/index.ts';
import * as ChromeService from '../../services/ChromeService.ts';

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
};

class ChatboxInjector {
  private container: HTMLDivElement | null = null;
  private shadowRoot: ShadowRoot | null = null;
  private settings: ChatboxSettings = DEFAULT_SETTINGS;
  private messages: ChatMessage[] = [];
  private isStreaming = false;
  private streamingMessage = '';
  private currentPaper: StoredPaper | null = null;
  private isInitialized = false;
  private hasInteractedSinceOpen = false;
  private initialInputValue = '';

  async initialize() {
    if (this.isInitialized) {
      console.log('[Kuma Chat] Already initialized');
      return;
    }

    console.log('[Kuma Chat] Starting initialization...');

    try {
      // Load saved settings from Chrome storage
      await this.loadSettings();
      console.log('[Kuma Chat] Settings loaded:', this.settings);

      // Create container
      this.container = document.createElement('div');
      this.container.id = 'kuma-chatbox-container';
      this.container.style.cssText = 'all: initial; position: fixed; z-index: 2147483647;';

      // Create shadow DOM for style isolation
      this.shadowRoot = this.container.attachShadow({ mode: 'open' });
      console.log('[Kuma Chat] Shadow DOM created');

      // Add styles to shadow DOM
      const styleSheet = document.createElement('style');
      const styles = await this.loadStyles();
      console.log('[Kuma Chat] Styles loaded, length:', styles.length);
      styleSheet.textContent = styles;
      this.shadowRoot.appendChild(styleSheet);

      // Create root element for Preact
      const rootElement = document.createElement('div');
      this.shadowRoot.appendChild(rootElement);

      // Append to body
      document.body.appendChild(this.container);
      console.log('[Kuma Chat] Container appended to body');

      this.isInitialized = true;

      // Render initial state
      this.render();

      // Listen for paper context changes
      this.setupContextListener();

      console.log('[Kuma Chat] ✓ Chatbox injector initialized successfully');
    } catch (error) {
      console.error('[Kuma Chat] Failed to initialize:', error);
      throw error;
    }
  }

  private async loadStyles(): Promise<string> {
    // Try to load CSS file from build output
    try {
      const cssUrl = chrome.runtime.getURL('src/content/components/chatbox.css');
      console.log('[Kuma Chat] Attempting to load CSS from:', cssUrl);
      const response = await fetch(cssUrl);
      if (response.ok) {
        const css = await response.text();
        console.log('[Kuma Chat] CSS loaded successfully from file');
        return css;
      }
      throw new Error(`Failed to fetch CSS: ${response.status}`);
    } catch (error) {
      console.warn('[Kuma Chat] Failed to load external CSS, using inline styles:', error);
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

        // Ensure position is within viewport bounds
        this.settings.position.x = Math.max(0, Math.min(this.settings.position.x, window.innerWidth - this.settings.position.width));
        this.settings.position.y = Math.max(0, Math.min(this.settings.position.y, window.innerHeight - this.settings.position.height));
      }
    } catch (error) {
      console.error('[Kuma Chat] Failed to load settings:', error);
    }
  }

  private async saveSettings() {
    try {
      await chrome.storage.local.set({ chatboxSettings: this.settings });
    } catch (error) {
      console.error('[Kuma Chat] Failed to save settings:', error);
    }
  }

  private async loadChatHistory() {
    if (!this.currentPaper) {
      this.messages = [];
      return;
    }

    try {
      const paper = await ChromeService.getPaperFromDBByUrl(this.currentPaper.url);
      if (paper && paper.chatHistory) {
        this.messages = paper.chatHistory;
      } else {
        this.messages = [];
      }
    } catch (error) {
      console.error('[Kuma Chat] Failed to load chat history:', error);
      this.messages = [];
    }
  }

  private async saveChatHistory() {
    if (!this.currentPaper) {
      return;
    }

    try {
      await ChromeService.updateChatHistory(this.currentPaper.url, this.messages);
    } catch (error) {
      console.error('[Kuma Chat] Failed to save chat history:', error);
    }
  }

  private setupContextListener() {
    // Listen for paper changes (when user navigates to different paper)
    chrome.runtime.onMessage.addListener((message) => {
      if (message.type === 'PAPER_CONTEXT_CHANGED') {
        this.handlePaperContextChange(message.payload);
      } else if (message.type === 'CHAT_STREAM_CHUNK') {
        this.handleStreamChunk(message.payload);
      } else if (message.type === 'CHAT_STREAM_END') {
        this.handleStreamEnd(message.payload);
      }
    });
  }

  private async handlePaperContextChange(paper: StoredPaper | null) {
    this.currentPaper = paper;
    await this.loadChatHistory();
    this.render();
  }

  private handleStreamChunk(chunk: string) {
    this.streamingMessage += chunk;
    this.render();
  }

  private handleStreamEnd(data: { fullMessage: string; sources?: string[] }) {
    this.isStreaming = false;

    // Add assistant message to history
    const assistantMessage: ChatMessage = {
      role: 'assistant',
      content: data.fullMessage,
      timestamp: Date.now(),
      sources: data.sources,
    };

    this.messages.push(assistantMessage);
    this.streamingMessage = '';

    // Save to database
    this.saveChatHistory();

    this.render();
  }

  async toggle() {
    console.log('[Kuma Chat] Toggle called, current visible:', this.settings.visible);
    this.settings.visible = !this.settings.visible;
    console.log('[Kuma Chat] New visible state:', this.settings.visible);

    if (this.settings.visible) {
      // Force expanded mode when opening
      this.settings.minimized = false;
      console.log('[Kuma Chat] Forcing expanded mode (minimized: false)');

      // Reset interaction state (transparency won't activate until user clicks)
      this.hasInteractedSinceOpen = false;

      // Load current paper context when opening
      console.log('[Kuma Chat] Loading paper context...');
      await this.updateCurrentPaper();
      await this.loadChatHistory();
      console.log('[Kuma Chat] Current paper:', this.currentPaper?.title);
      console.log('[Kuma Chat] Messages loaded:', this.messages.length);
    }

    await this.saveSettings();
    console.log('[Kuma Chat] Calling render...');
    this.render();
  }

  async show() {
    if (!this.settings.visible) {
      await this.toggle();
    }
  }

  async hide() {
    if (this.settings.visible) {
      this.settings.visible = false;
      await this.saveSettings();
      this.render();
    }
  }

  async openWithQuery(query: string) {
    console.log('[Kuma Chat] Opening with query:', query);

    // Set the initial input value
    this.initialInputValue = query;

    // Force chat open and expanded
    this.settings.visible = true;
    this.settings.minimized = false;

    // Reset interaction state
    this.hasInteractedSinceOpen = false;

    // Load current paper context if not already loaded
    await this.updateCurrentPaper();
    await this.loadChatHistory();

    await this.saveSettings();
    this.render();

    // Clear the initial input value after a short delay to allow the component to read it
    setTimeout(() => {
      this.initialInputValue = '';
    }, 100);
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
      console.error('[Kuma Chat] Failed to update current paper:', error);
      this.currentPaper = null;
    }
  }

  private async handleSendMessage(message: string) {
    if (!this.currentPaper) {
      console.error('[Kuma Chat] No paper loaded');
      return;
    }

    // Add user message to history
    const userMessage: ChatMessage = {
      role: 'user',
      content: message,
      timestamp: Date.now(),
    };

    this.messages.push(userMessage);
    this.isStreaming = true;
    this.streamingMessage = '';

    // Save user message immediately
    await this.saveChatHistory();

    this.render();

    // Send to background for processing
    try {
      await ChromeService.sendChatMessage(this.currentPaper.url, message);
    } catch (error) {
      console.error('[Kuma Chat] Failed to send message:', error);
      this.isStreaming = false;

      // Add error message
      const errorMessage: ChatMessage = {
        role: 'assistant',
        content: 'Sorry, I encountered an error processing your message. Please try again.',
        timestamp: Date.now(),
      };

      this.messages.push(errorMessage);
      await this.saveChatHistory();
      this.render();
    }
  }

  private async handleClearMessages() {
    if (!this.currentPaper) {
      console.error('[Kuma Chat] No paper loaded');
      return;
    }

    try {
      // Clear from database
      await ChromeService.clearChatHistory(this.currentPaper.url);

      // Clear local state
      this.messages = [];

      console.log('[Kuma Chat] ✓ Chat history cleared');

      // Re-render
      this.render();
    } catch (error) {
      console.error('[Kuma Chat] Failed to clear chat history:', error);
    }
  }

  private handlePositionChange(position: ChatboxPosition) {
    this.settings.position = position;
    this.saveSettings();
  }

  private handleFirstInteraction() {
    this.hasInteractedSinceOpen = true;
    this.render();
  }

  private render() {
    // console.log('[Kuma Chat] Render called, initialized:', this.isInitialized, 'visible:', this.settings.visible);

    if (!this.shadowRoot || !this.isInitialized) {
      console.log('[Kuma Chat] Render aborted - not initialized');
      return;
    }

    const rootElement = this.shadowRoot.querySelector('div');
    if (!rootElement) {
      console.log('[Kuma Chat] Render aborted - no root element');
      return;
    }

    // Determine if chatbox should be disabled
    const isDisabled = !this.currentPaper || !this.currentPaper.chunkCount;
    const hasPaper = !!this.currentPaper;
    const hasChunked = !!(this.currentPaper && this.currentPaper.chunkCount > 0);

    if (!this.settings.visible) {
      console.log('[Kuma Chat] Rendering null (not visible)');
      render(null, rootElement);
      return;
    }

    // console.log('[Kuma Chat] Rendering chatbox, disabled:', isDisabled, 'messages:', this.messages.length);

    try {
      render(
        h(ChatBox, {
          messages: this.messages,
          isStreaming: this.isStreaming,
          streamingMessage: this.streamingMessage,
          onSendMessage: this.handleSendMessage.bind(this),
          onClearMessages: this.handleClearMessages.bind(this),
          onClose: this.hide.bind(this),
          onMinimize: this.minimize.bind(this),
          isMinimized: this.settings.minimized,
          initialPosition: this.settings.position,
          onPositionChange: this.handlePositionChange.bind(this),
          disabled: isDisabled,
          paperTitle: this.currentPaper?.title,
          hasPaper: hasPaper,
          hasChunked: hasChunked,
          transparencyEnabled: this.settings.transparencyEnabled,
          onToggleTransparency: this.toggleTransparency.bind(this),
          hasInteractedSinceOpen: this.hasInteractedSinceOpen,
          onFirstInteraction: this.handleFirstInteraction.bind(this),
          initialInputValue: this.initialInputValue,
        }),
        rootElement
      );
      // console.log('[Kuma Chat] ✓ Chatbox rendered successfully');
    } catch (error) {
      console.error('[Kuma Chat] Error rendering chatbox:', error);
    }
  }

  async clearHistory() {
    this.messages = [];
    await this.saveChatHistory();
    this.render();
  }

  destroy() {
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
