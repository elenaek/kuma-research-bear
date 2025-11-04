import { logger } from '../../../shared/utils/logger.ts';

/**
 * ChatboxStyleService - Manages all styling for the chatbox
 *
 * Responsibilities:
 * - Load external CSS file from extension
 * - Provide fallback inline styles (553 lines of CSS)
 * - Inject popover styles into document for LaTeX display
 * - Create and configure shadow DOM with styles
 *
 * Extracted from chatboxInjector.ts to separate styling concerns
 */
export class ChatboxStyleService {
  /**
   * Load CSS styles for chatbox
   * Tries to load external CSS file, falls back to inline styles if unavailable
   *
   * @returns Promise resolving to CSS string
   */
  async loadStyles(): Promise<string> {
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

  /**
   * Get inline fallback styles (553 lines)
   * Used when external CSS file cannot be loaded
   *
   * @returns CSS string with all chatbox styles
   */
  getInlineStyles(): string {
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
        flex-shrink: 0;
      }

      .chatbox-input {
        flex: 1;
        border: 1px solid #d1d5db;
        border-radius: 8px;
        padding: 8px 12px;
        font-size: 14px;
        resize: none;
        min-height: 40px;
        max-height: 120px;
        overflow-y: auto;
        font-family: inherit;
      }

      .chatbox-input:focus {
        outline: none;
        border-color: oklch(42.4% 0.199 265.638);
        box-shadow: 0 0 0 3px oklch(42.4% 0.199 265.638 / 0.1);
      }

      .chatbox-send-btn {
        background: oklch(42.4% 0.199 265.638);
        color: white;
        border: none;
        border-radius: 8px;
        padding: 8px 16px;
        cursor: pointer;
        font-weight: 500;
        font-size: 14px;
        transition: all 0.2s;
        flex-shrink: 0;
        height: 40px;
      }

      .chatbox-send-btn:hover:not(:disabled) {
        background: oklch(37.9% 0.146 265.522);
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      }

      .chatbox-send-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .chatbox-send-btn:active:not(:disabled) {
        transform: translateY(0);
      }

      .message {
        display: flex;
        gap: 8px;
        animation: slideIn 0.3s ease-out;
      }

      @keyframes slideIn {
        from {
          opacity: 0;
          transform: translateY(10px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      .message-user {
        flex-direction: row-reverse;
      }

      .message-content {
        max-width: 80%;
        padding: 10px 14px;
        border-radius: 12px;
        word-wrap: break-word;
        line-height: 1.5;
        font-size: 14px;
      }

      .message-user .message-content {
        background: oklch(42.4% 0.199 265.638);
        color: white;
        border-bottom-right-radius: 4px;
      }

      .message-assistant .message-content {
        background: white;
        color: #1f2937;
        border-bottom-left-radius: 4px;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
      }

      .message-sources {
        margin-top: 8px;
        padding-top: 8px;
        border-top: 1px solid rgba(255, 255, 255, 0.2);
        font-size: 12px;
        opacity: 0.9;
      }

      .message-user .message-sources {
        border-top-color: rgba(255, 255, 255, 0.3);
      }

      .message-assistant .message-sources {
        border-top-color: rgba(0, 0, 0, 0.1);
        color: #6b7280;
      }

      .source-link {
        color: inherit;
        text-decoration: none;
        padding: 2px 6px;
        border-radius: 4px;
        background: rgba(0, 0, 0, 0.05);
        margin-right: 4px;
        display: inline-block;
        margin-top: 4px;
        transition: background 0.2s;
      }

      .message-user .source-link {
        background: rgba(255, 255, 255, 0.2);
      }

      .message-user .source-link:hover {
        background: rgba(255, 255, 255, 0.3);
      }

      .message-assistant .source-link:hover {
        background: rgba(0, 0, 0, 0.1);
      }

      .empty-state {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        text-align: center;
        padding: 32px;
        color: #6b7280;
      }

      .empty-state-icon {
        font-size: 48px;
        margin-bottom: 16px;
        opacity: 0.5;
      }

      .empty-state-text {
        font-size: 14px;
        line-height: 1.6;
      }

      .typing-indicator {
        display: flex;
        gap: 4px;
        padding: 10px 14px;
        background: white;
        border-radius: 12px;
        border-bottom-left-radius: 4px;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
        width: fit-content;
      }

      .typing-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #9ca3af;
        animation: typing 1.4s infinite;
      }

      .typing-dot:nth-child(2) {
        animation-delay: 0.2s;
      }

      .typing-dot:nth-child(3) {
        animation-delay: 0.4s;
      }

      @keyframes typing {
        0%, 60%, 100% {
          opacity: 0.3;
          transform: translateY(0);
        }
        30% {
          opacity: 1;
          transform: translateY(-4px);
        }
      }

      .kuma-chatbox-transparent {
        opacity: 0.95;
      }

      .kuma-chatbox-transparent:hover {
        opacity: 1;
      }

      .transparency-toggle {
        margin-left: 8px;
        background: rgba(255, 255, 255, 0.2);
        border: none;
        border-radius: 4px;
        color: white;
        cursor: pointer;
        padding: 4px 8px;
        font-size: 12px;
        transition: background 0.2s;
      }

      .transparency-toggle:hover {
        background: rgba(255, 255, 255, 0.3);
      }

      .regenerate-button {
        margin-top: 8px;
        padding: 6px 12px;
        background: rgba(0, 0, 0, 0.05);
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font-size: 12px;
        color: #374151;
        transition: all 0.2s;
        display: inline-flex;
        align-items: center;
        gap: 4px;
      }

      .regenerate-button:hover {
        background: rgba(0, 0, 0, 0.1);
        transform: translateY(-1px);
      }

      .regenerate-button:active {
        transform: translateY(0);
      }

      .regenerate-button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      /* Tab styles */
      .chatbox-tabs {
        display: flex;
        gap: 4px;
        padding: 8px 12px 0;
        background: linear-gradient(135deg, oklch(37.9% 0.146 265.522) 0%, oklch(42.4% 0.199 265.638) 100%);
        overflow-x: auto;
        overflow-y: hidden;
        flex-shrink: 0;
        scrollbar-width: thin;
        scrollbar-color: rgba(255, 255, 255, 0.3) transparent;
      }

      .chatbox-tabs::-webkit-scrollbar {
        height: 4px;
      }

      .chatbox-tabs::-webkit-scrollbar-track {
        background: transparent;
      }

      .chatbox-tabs::-webkit-scrollbar-thumb {
        background: rgba(255, 255, 255, 0.3);
        border-radius: 2px;
      }

      .chatbox-tab {
        padding: 8px 12px;
        border: none;
        background: rgba(255, 255, 255, 0.1);
        color: rgba(255, 255, 255, 0.8);
        border-radius: 8px 8px 0 0;
        cursor: pointer;
        font-size: 13px;
        white-space: nowrap;
        transition: all 0.2s;
        display: flex;
        align-items: center;
        gap: 6px;
        min-width: fit-content;
      }

      .chatbox-tab:hover {
        background: rgba(255, 255, 255, 0.15);
        color: white;
      }

      .chatbox-tab.active {
        background: white;
        color: oklch(42.4% 0.199 265.638);
        font-weight: 500;
      }

      .chatbox-tab-close {
        margin-left: 4px;
        padding: 0 4px;
        background: none;
        border: none;
        color: inherit;
        cursor: pointer;
        font-size: 16px;
        line-height: 1;
        opacity: 0.6;
        transition: opacity 0.2s;
      }

      .chatbox-tab-close:hover {
        opacity: 1;
      }

      .chatbox-tab.active .chatbox-tab-close {
        opacity: 0.8;
      }

      .chatbox-tab.active .chatbox-tab-close:hover {
        opacity: 1;
      }

      /* Image chat styles */
      .image-preview {
        max-width: 200px;
        max-height: 200px;
        margin-top: 8px;
        border-radius: 8px;
        object-fit: contain;
      }

      .scroll-to-image-button {
        margin-top: 8px;
        padding: 6px 12px;
        background: rgba(0, 0, 0, 0.05);
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font-size: 12px;
        color: #374151;
        transition: all 0.2s;
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }

      .scroll-to-image-button:hover {
        background: rgba(0, 0, 0, 0.1);
        transform: translateY(-1px);
      }

      .scroll-to-image-button:active {
        transform: translateY(0);
      }

      /* Compass arrow */
      .compass-arrow {
        font-size: 16px;
        transition: transform 0.3s ease-out;
        display: inline-block;
      }

      /* Clear chat button */
      .clear-chat-button {
        position: absolute;
        top: 12px;
        right: 80px;
        padding: 4px 8px;
        background: rgba(255, 255, 255, 0.2);
        border: none;
        border-radius: 4px;
        color: white;
        cursor: pointer;
        font-size: 11px;
        transition: background 0.2s;
        display: flex;
        align-items: center;
        gap: 4px;
      }

      .clear-chat-button:hover {
        background: rgba(255, 255, 255, 0.3);
      }

      /* Loading states */
      .loading-embeddings {
        padding: 8px 12px;
        background: #fef3c7;
        border: 1px solid #fbbf24;
        border-radius: 6px;
        font-size: 12px;
        color: #92400e;
        text-align: center;
        margin-bottom: 8px;
      }

      .has-embeddings {
        padding: 8px 12px;
        background: #d1fae5;
        border: 1px solid #10b981;
        border-radius: 6px;
        font-size: 12px;
        color: #065f46;
        text-align: center;
        margin-bottom: 8px;
      }

      /* Code blocks in messages */
      .message-content pre {
        background: rgba(0, 0, 0, 0.05);
        padding: 8px 12px;
        border-radius: 6px;
        overflow-x: auto;
        margin: 8px 0;
      }

      .message-user .message-content pre {
        background: rgba(255, 255, 255, 0.2);
      }

      .message-content code {
        font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
        font-size: 13px;
      }

      /* Links in messages */
      .message-content a {
        color: inherit;
        text-decoration: underline;
      }

      .message-content a:hover {
        opacity: 0.8;
      }

      /* Lists in messages */
      .message-content ul,
      .message-content ol {
        margin: 8px 0;
        padding-left: 20px;
      }

      .message-content li {
        margin: 4px 0;
      }

      /* Headings in messages */
      .message-content h1,
      .message-content h2,
      .message-content h3,
      .message-content h4 {
        margin: 12px 0 8px;
        font-weight: 600;
      }

      .message-content h1 { font-size: 18px; }
      .message-content h2 { font-size: 16px; }
      .message-content h3 { font-size: 15px; }
      .message-content h4 { font-size: 14px; }

      /* Blockquotes in messages */
      .message-content blockquote {
        border-left: 3px solid rgba(0, 0, 0, 0.2);
        margin: 8px 0;
        padding-left: 12px;
        font-style: italic;
        opacity: 0.9;
      }

      .message-user .message-content blockquote {
        border-left-color: rgba(255, 255, 255, 0.4);
      }
    `;
  }

  /**
   * Inject popover styles into document head
   * Required for LaTeX popover that renders using createPortal outside shadow DOM
   */
  injectPopoverStyles(): void {
    // Check if styles already exist
    const existingStyle = document.querySelector('style[data-kuma-popover-styles]');
    if (existingStyle) {
      logger.debug('CONTENT_SCRIPT', '[Kuma Chat] Popover styles already injected');
      return;
    }

    // Create style element for popover
    const styleElement = document.createElement('style');
    styleElement.setAttribute('data-kuma-popover-styles', 'true');

    // LaTeX Popover styles (extracted from chatbox.css)
    styleElement.textContent = `
      /* LaTeX Popover Styles - Injected by Kuma Chat Extension */
      .math-popover {
        overflow: hidden;
        position: fixed;
        background: white;
        border: 1px solid #e5e7eb;
        border-radius: 8px;
        padding: 2.5rem 1.5rem 1.5rem;
        box-shadow: 0 10px 40px rgba(0, 0, 0, 0.15);
        z-index: 2147483647;
        max-width: 90vw;
        max-height: 85vh;
        animation: popIn 0.2s ease-out;
      }

      @keyframes popIn {
        from {
          opacity: 0;
          transform: scale(0.95);
        }
        to {
          opacity: 1;
          transform: scale(1);
        }
      }

      /* Close Button */
      .math-popover-close {
        position: absolute;
        top: 0.5rem;
        right: 0.5rem;
        width: 28px;
        height: 28px;
        border: none;
        background: rgba(0, 0, 0, 0.05);
        color: #374151;
        border-radius: 4px;
        cursor: pointer;
        font-size: 18px;
        font-weight: 600;
        line-height: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s ease;
        z-index: 1;
      }

      .math-popover-close:hover {
        background: rgba(0, 0, 0, 0.1);
        transform: scale(1.1);
      }

      .math-popover-close:active {
        transform: scale(0.95);
      }

      /* LaTeX Copy Button */
      .math-popover-copy {
        position: absolute;
        top: 0.5rem;
        right: 2.75rem; /* Positioned to the left of close button */
        padding: 0.45rem 0.85rem;
        border: 1px solid rgba(0, 0, 0, 0.1);
        background: white;
        color: #374151;
        border-radius: 4px;
        cursor: pointer;
        font-size: 0.8rem;
        font-weight: 500;
        display: block;
        align-items: center;
        gap: 0.4rem;
        transition: all 0.2s ease;
        z-index: 1;
        line-height: 1.2;
        white-space: nowrap;
        min-width: fit-content;
      }

      .math-popover-copy:hover {
        background: #f3f4f6;
        border-color: #9ca3af;
        transform: scale(1.05);
      }

      .math-popover-copy:active {
        transform: scale(0.95);
      }

      .math-popover-copy.copied {
        background: rgba(34, 197, 94, 0.1);
        border-color: #22c55e;
        color: #22c55e;
      }

      .math-popover-copy svg {
        flex-shrink: 0;
      }

      /* Formula Display */
      .math-popover-formula {
        text-align: center;
        font-size: 2em; /* 2x zoom */
        padding: 1rem;
        min-width: 100px;
        margin: 1rem;
      }

      .math-popover-formula svg {
        max-width: 100%;
        height: auto;
        cursor: default; /* Remove pointer cursor in popover */
      }

      /* LaTeX Source Display */
      .math-popover-latex {
        margin-top: 1rem;
        padding: 0.5rem 0.75rem;
        background: #f9fafb;
        border-radius: 4px;
        font-family: 'Courier New', monospace;
        font-size: 0.75rem;
        color: #6b7280;
        text-align: center;
        word-wrap: break-word;
        border: 1px solid #e5e7eb;
        user-select: all; /* Allow easy copying */
        max-height: 100px;
        overflow-y: auto;
      }

      /* Arrow */
      .math-popover-arrow {
        position: absolute;
        width: 10px;
        height: 10px;
        background: white;
        border: 1px solid #e5e7eb;
        transform: rotate(45deg);
      }

      /* Arrow positions for each placement */
      .math-popover-top .math-popover-arrow {
        bottom: -6px;
        left: 50%;
        margin-left: -5px;
        border-top: none;
        border-left: none;
      }

      .math-popover-bottom .math-popover-arrow {
        top: -6px;
        left: 50%;
        margin-left: -5px;
        border-bottom: none;
        border-right: none;
      }

      .math-popover-left .math-popover-arrow {
        right: -6px;
        top: 50%;
        margin-top: -5px;
        border-left: none;
        border-bottom: none;
      }

      .math-popover-right .math-popover-arrow {
        left: -6px;
        top: 50%;
        margin-top: -5px;
        border-right: none;
        border-top: none;
      }

      /* Responsive adjustments */
      @media (max-width: 640px) {
        .math-popover {
          padding: 2rem 1rem 1rem;
          border-radius: 6px;
          max-width: 95vw;
        }

        .math-popover-formula {
          font-size: 1.5em;
          padding: 0.75rem;
        }

        .math-popover-latex {
          font-size: 0.7rem;
        }

        .math-popover-copy {
          font-size: 0.65rem;
          padding: 0.3rem 0.5rem;
          gap: 0.25rem;
        }
      }

      /* Draggable Header */
      .math-popover-header {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: 2.5rem;
        user-select: none;
        -webkit-user-select: none;
        -moz-user-select: none;
      }

      /* Drag Handle Icon */
      .math-popover-drag-handle {
        position: absolute;
        top: 0.5rem;
        left: 0.5rem;
        width: 28px;
        height: 28px;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #6b7280;
        cursor: grab;
        transition: all 0.2s ease;
        border-radius: 4px;
        background: transparent;
      }

      .math-popover-drag-handle:hover {
        background: rgba(0, 0, 0, 0.05);
        color: #374151;
      }

      .math-popover.dragging .math-popover-drag-handle {
        cursor: grabbing;
        color: #374151;
      }

      /* Dragging State */
      .math-popover.dragging {
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.25);
        cursor: grabbing;
      }

      /* LaTeX Content */
      .math-popover-content {
        overflow: auto;
        max-height: calc(85vh - 4rem);
        padding: 0.5rem;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .math-popover-content mjx-container {
        margin: 0 !important;
      }

      /* Scrollbar styling for LaTeX popover */
      .math-popover-content::-webkit-scrollbar {
        width: 8px;
        height: 8px;
      }

      .math-popover-content::-webkit-scrollbar-track {
        background: #f3f4f6;
        border-radius: 4px;
      }

      .math-popover-content::-webkit-scrollbar-thumb {
        background: #d1d5db;
        border-radius: 4px;
      }

      .math-popover-content::-webkit-scrollbar-thumb:hover {
        background: #9ca3af;
      }

      /* Backdrop */
      .math-popover-backdrop {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.4);
        z-index: 2147483646;
        animation: fadeIn 0.2s ease-out;
      }

      @keyframes fadeIn {
        from {
          opacity: 0;
        }
        to {
          opacity: 1;
        }
      }
    `;

    // Append to document head
    document.head.appendChild(styleElement);

    logger.debug('CONTENT_SCRIPT', '[Kuma Chat] Popover styles injected successfully');
  }

  /**
   * Create shadow root with styles for a container element
   * Convenience method that combines shadow DOM creation and style injection
   *
   * @param container - The container element to attach shadow root to
   * @returns The created shadow root
   */
  async createShadowRoot(container: HTMLDivElement): Promise<ShadowRoot> {
    // Create shadow DOM for style isolation
    const shadowRoot = container.attachShadow({ mode: 'open' });

    // Add styles to shadow DOM
    const styleSheet = document.createElement('style');
    const styles = await this.loadStyles();
    styleSheet.textContent = styles;
    shadowRoot.appendChild(styleSheet);

    return shadowRoot;
  }
}
