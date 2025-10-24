import { h, render } from 'preact';
import { AskKumaButton } from '../components/AskKumaButton.tsx';
import * as ChromeService from '../../services/ChromeService.ts';

const MIN_SELECTION_LENGTH = 3;
const BUTTON_OFFSET_X = 10;
const BUTTON_OFFSET_Y = -55; // Position above selection

interface SelectionState {
  text: string;
  x: number;
  y: number;
  visible: boolean;
}

class TextSelectionHandler {
  private container: HTMLDivElement | null = null;
  private shadowRoot: ShadowRoot | null = null;
  private selectionState: SelectionState = {
    text: '',
    x: 0,
    y: 0,
    visible: false,
  };
  private isInitialized = false;
  private chatboxInjector: any = null; // Will be set during initialization
  private debounceTimer: number | null = null;

  async initialize(chatboxInjector: any) {
    if (this.isInitialized) {
      console.log('[Ask Kuma] Already initialized');
      return;
    }

    console.log('[Ask Kuma] Initializing text selection handler...');
    this.chatboxInjector = chatboxInjector;

    try {
      // Create container for the button
      this.container = document.createElement('div');
      this.container.id = 'kuma-ask-button-container';
      this.container.style.cssText = 'all: initial; position: fixed; z-index: 2147483646; pointer-events: none;';

      // Create shadow DOM for style isolation
      this.shadowRoot = this.container.attachShadow({ mode: 'open' });

      // Add styles to shadow DOM
      const styleSheet = document.createElement('style');
      const styles = await this.loadStyles();
      styleSheet.textContent = styles;
      this.shadowRoot.appendChild(styleSheet);

      // Create root element for Preact
      const rootElement = document.createElement('div');
      rootElement.style.cssText = 'pointer-events: auto;'; // Allow clicks on button
      this.shadowRoot.appendChild(rootElement);

      // Append to body
      document.body.appendChild(this.container);

      this.isInitialized = true;

      // Set up event listeners
      this.setupEventListeners();

      // Initial render
      this.render();

      console.log('[Ask Kuma] ✓ Text selection handler initialized successfully');
    } catch (error) {
      console.error('[Ask Kuma] Failed to initialize:', error);
      throw error;
    }
  }

  private async loadStyles(): Promise<string> {
    try {
      const cssUrl = chrome.runtime.getURL('src/content/styles/askKumaButton.css');
      const response = await fetch(cssUrl);
      if (response.ok) {
        return await response.text();
      }
      throw new Error(`Failed to fetch CSS: ${response.status}`);
    } catch (error) {
      console.warn('[Ask Kuma] Failed to load external CSS, using inline styles:', error);
      return this.getInlineStyles();
    }
  }

  private getInlineStyles(): string {
    return `
      .ask-kuma-button {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
        background: linear-gradient(135deg, oklch(37.9% 0.146 265.522) 0%, oklch(42.4% 0.199 265.638) 100%);
        color: white;
        border: none;
        border-radius: 8px;
        padding: 10px 18px;
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2), 0 2px 4px rgba(0, 0, 0, 0.1);
        transition: all 0.2s ease;
        animation: fadeInUp 0.2s ease-out;
        user-select: none;
        white-space: nowrap;
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .ask-kuma-button:hover {
        transform: translateY(-2px);
        box-shadow: 0 6px 16px rgba(0, 0, 0, 0.25), 0 3px 6px rgba(0, 0, 0, 0.15);
      }

      .ask-kuma-button:active {
        transform: translateY(0);
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
      }

      @keyframes fadeInUp {
        from {
          opacity: 0;
          transform: translateY(8px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }
    `;
  }

  private setupEventListeners() {
    // Listen for mouseup events (text selection)
    document.addEventListener('mouseup', this.handleMouseUp.bind(this));

    // Listen for selection changes
    document.addEventListener('selectionchange', this.handleSelectionChange.bind(this));

    // Listen for scroll and resize to hide button
    window.addEventListener('scroll', this.handleScrollOrResize.bind(this), true);
    window.addEventListener('resize', this.handleScrollOrResize.bind(this));

    // Listen for clicks outside to hide button
    document.addEventListener('mousedown', this.handleClickOutside.bind(this));
  }

  private handleMouseUp(event: MouseEvent) {
    // Debounce to avoid multiple rapid updates
    if (this.debounceTimer) {
      window.clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = window.setTimeout(async () => {
      await this.updateSelectionState();
    }, 50);
  }

  private handleSelectionChange() {
    // Only handle selection changes if user is actively selecting
    // This prevents interference with programmatic selections
    const selection = window.getSelection();
    if (selection && selection.toString().length === 0) {
      this.hideButton();
    }
  }

  private handleScrollOrResize() {
    // Hide button on scroll or resize
    if (this.selectionState.visible) {
      this.hideButton();
    }
  }

  private handleClickOutside(event: MouseEvent) {
    // Don't hide if clicking on the button itself
    if (this.container && this.container.contains(event.target as Node)) {
      return;
    }

    // Hide button when clicking elsewhere
    if (this.selectionState.visible) {
      this.hideButton();
    }
  }

  private async updateSelectionState() {
    console.log('[Ask Kuma] updateSelectionState called');
    const selection = window.getSelection();

    if (!selection || selection.isCollapsed) {
      console.log('[Ask Kuma] No selection or collapsed');
      this.hideButton();
      return;
    }

    const selectedText = selection.toString().trim();
    console.log('[Ask Kuma] Selected text:', selectedText.substring(0, 50) + (selectedText.length > 50 ? '...' : ''), `(${selectedText.length} chars)`);

    // Check minimum length requirement
    if (selectedText.length < MIN_SELECTION_LENGTH) {
      console.log('[Ask Kuma] Text too short (min:', MIN_SELECTION_LENGTH, 'chars)');
      this.hideButton();
      return;
    }

    // Check if paper is ready for chat
    console.log('[Ask Kuma] Checking if paper is ready...');
    const paperReady = await this.isPaperReady();
    console.log('[Ask Kuma] Paper ready:', paperReady);
    if (!paperReady) {
      console.log('[Ask Kuma] Paper not ready, hiding button');
      this.hideButton();
      return;
    }

    // Get selection position
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    if (rect.width === 0 && rect.height === 0) {
      console.log('[Ask Kuma] Invalid selection rect');
      this.hideButton();
      return;
    }

    // Calculate button position (centered above selection)
    const x = rect.left + (rect.width / 2) + BUTTON_OFFSET_X;
    const y = rect.top + BUTTON_OFFSET_Y;

    console.log('[Ask Kuma] Showing button at position:', { x, y }, 'rect:', rect);

    // Update state and render
    this.selectionState = {
      text: selectedText,
      x: Math.max(10, x),
      y: Math.max(10, y),
      visible: true,
    };

    this.render();
  }

  private hideButton() {
    if (this.selectionState.visible) {
      this.selectionState.visible = false;
      this.render();
    }
  }

  private async isPaperReady(): Promise<boolean> {
    try {
      // Query the database directly for the current page's paper
      const currentUrl = window.location.href;
      const paper = await ChromeService.getPaperFromDBByUrl(currentUrl);

      // Paper is ready if it exists and has chunks
      return !!(paper && paper.chunkCount && paper.chunkCount > 0);
    } catch (error) {
      console.error('[Ask Kuma] Error checking paper readiness:', error);
      return false;
    }
  }

  private handleButtonClick() {
    console.log('[Ask Kuma] Button clicked');
    const selectedText = this.selectionState.text;

    if (!selectedText) {
      console.log('[Ask Kuma] No selected text');
      return;
    }

    // Format the query as context-aware prompt
    const query = `Explain this passage from the paper: "${selectedText}"`;
    console.log('[Ask Kuma] Opening chat with query:', query.substring(0, 100) + '...');

    // Open chat with prefilled query
    if (this.chatboxInjector && typeof this.chatboxInjector.openWithQuery === 'function') {
      this.chatboxInjector.openWithQuery(query);
    } else {
      console.error('[Ask Kuma] openWithQuery method not available on chatboxInjector');
    }

    // Hide the button after clicking
    this.hideButton();

    // Clear selection
    window.getSelection()?.removeAllRanges();
  }

  private render() {
    if (!this.shadowRoot || !this.isInitialized) {
      return;
    }

    const rootElement = this.shadowRoot.querySelector('div');
    if (!rootElement) {
      return;
    }

    render(
      h(AskKumaButton, {
        x: this.selectionState.x,
        y: this.selectionState.y,
        visible: this.selectionState.visible,
        onClick: this.handleButtonClick.bind(this),
      }),
      rootElement
    );
  }

  destroy() {
    // Remove event listeners
    document.removeEventListener('mouseup', this.handleMouseUp.bind(this));
    document.removeEventListener('selectionchange', this.handleSelectionChange.bind(this));
    window.removeEventListener('scroll', this.handleScrollOrResize.bind(this), true);
    window.removeEventListener('resize', this.handleScrollOrResize.bind(this));
    document.removeEventListener('mousedown', this.handleClickOutside.bind(this));

    // Clear debounce timer
    if (this.debounceTimer) {
      window.clearTimeout(this.debounceTimer);
    }

    // Remove DOM elements
    if (this.container && this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }

    this.container = null;
    this.shadowRoot = null;
    this.isInitialized = false;
  }
}

// Singleton instance
export const textSelectionHandler = new TextSelectionHandler();
