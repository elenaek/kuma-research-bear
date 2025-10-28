import { h, render } from 'preact';
import { ImageExplainButton } from '../components/ImageExplainButton.tsx';
import { detectImages, imageElementToBlob, watchForNewImages, DetectedImage } from './imageDetectionService.ts';
import * as ChromeService from '../../services/ChromeService.ts';
import { aiService } from '../../utils/aiService.ts';
import { chatboxInjector } from './chatboxInjector.ts'; // NEW: Multi-tab chatbox integration
import { getShowImageButtons } from '../../utils/settingsService.ts';

interface ImageState {
  element: HTMLImageElement;
  url: string;
  title: string | null;
  explanation: string | null;
  isLoading: boolean;
  buttonContainer: HTMLDivElement | null;
  buttonRoot: HTMLElement | null;
}

/**
 * Image Explanation Handler
 * Manages image explanation buttons, generates explanations, and handles caching
 */
class ImageExplanationHandler {
  private imageStates: Map<string, ImageState> = new Map();
  private mutationObserver: MutationObserver | null = null;
  private isInitialized = false;
  private multimodalAvailable = false;
  private currentPaper: any = null;
  private showImageButtons = true; // Stores user setting for button visibility

  /**
   * Get image state by URL (used for tab restoration)
   */
  getImageStateByUrl(imageUrl: string): ImageState | undefined {
    return this.imageStates.get(imageUrl);
  }

  async initialize(currentPaper: any) {
    if (this.isInitialized) {
      console.log('[ImageExplain] Already initialized');
      return;
    }

    this.currentPaper = currentPaper;

    console.log('[ImageExplain] Initializing image explanation handler...');

    // Check multimodal API availability
    try {
      const { available } = await aiService.checkMultimodalAvailability();
      this.multimodalAvailable = available;
      console.log('[ImageExplain] Multimodal API available:', available);

      if (!available) {
        console.log('[ImageExplain] Multimodal API not available, feature will be hidden');
        return; // Don't initialize if API not available
      }
    } catch (error) {
      console.error('[ImageExplain] Error checking multimodal availability:', error);
      return;
    }

    // Load user setting for button visibility FIRST
    try {
      this.showImageButtons = await getShowImageButtons();
      console.log('[ImageExplain] Button visibility setting:', this.showImageButtons);
    } catch (error) {
      console.error('[ImageExplain] Error loading settings:', error);
      this.showImageButtons = true; // Default to visible
    }

    // Detect and setup images (will render correctly based on showImageButtons)
    await this.setupImages();

    // Watch for dynamically added images
    this.mutationObserver = watchForNewImages(async (newImages) => {
      await this.setupImages();
    });

    this.isInitialized = true;
    console.log('[ImageExplain] ✓ Image explanation handler initialized');
  }

  /**
   * Reinitialize image explanation handler
   * Destroys existing buttons and recreates them
   */
  async reinitialize(currentPaper: any) {
    console.log('[ImageExplain] Reinitializing image explanation handler...');

    // Destroy existing buttons
    this.destroy();

    // Re-initialize with new paper
    await this.initialize(currentPaper);
  }

  private async setupImages() {
    if (!this.currentPaper) {
      console.log('[ImageExplain] No current paper, skipping image setup');
      return;
    }

    const images = detectImages();
    console.log('[ImageExplain] Setting up', images.length, 'images');

    for (const image of images) {
      // Skip if already set up
      if (this.imageStates.has(image.url)) {
        continue;
      }

      await this.setupImageButton(image);
    }
  }

  private async setupImageButton(image: DetectedImage) {
    console.log('[ImageExplain] Setting up button for image:', image.url);

    // Create container for button
    const buttonContainer = document.createElement('div');
    buttonContainer.className = 'kuma-image-button-container';
    buttonContainer.style.cssText = `
      position: fixed;
      z-index: 2147483645;
      pointer-events: none;
    `;

    // Create shadow DOM for style isolation
    const shadowRoot = buttonContainer.attachShadow({ mode: 'open' });

    // Add styles to shadow DOM
    const styleSheet = document.createElement('style');
    const styles = await this.loadStyles();
    styleSheet.textContent = styles;
    shadowRoot.appendChild(styleSheet);

    // Create root element for Preact (button)
    const buttonRoot = document.createElement('div');
    buttonRoot.style.cssText = 'pointer-events: auto;';
    shadowRoot.appendChild(buttonRoot);

    // Initialize image state
    const imageState: ImageState = {
      element: image.element,
      url: image.url,
      title: null,
      explanation: null,
      isLoading: false,
      buttonContainer,
      buttonRoot,
    };

    this.imageStates.set(image.url, imageState);

    // Position button at top-right corner of image
    this.positionButton(image.element, buttonContainer);

    // Append to body
    document.body.appendChild(buttonContainer);

    // Check for cached explanation
    await this.loadCachedExplanation(imageState);

    // Render button
    this.renderButton(image.url, buttonRoot);

    // Re-position on scroll or resize
    window.addEventListener('scroll', () => {
      this.positionButton(image.element, buttonContainer);
    }, true);
    window.addEventListener('resize', () => {
      this.positionButton(image.element, buttonContainer);
    });
  }

  private positionButton(img: HTMLImageElement, buttonContainer: HTMLDivElement) {
    const rect = img.getBoundingClientRect();
    buttonContainer.style.left = `${rect.left + 8}px`; // Left edge + padding
    buttonContainer.style.top = `${rect.top + 8}px`; // Top edge + padding
  }

  private async loadCachedExplanation(imageState: ImageState) {
    if (!this.currentPaper || !this.currentPaper.id) {
      return;
    }

    try {
      const response = await ChromeService.getImageExplanation(
        this.currentPaper.id,
        imageState.url
      );

      if (response && response.explanation) {
        imageState.title = response.explanation.title || 'Image Explanation';
        imageState.explanation = response.explanation.explanation;
        console.log('[ImageExplain] Loaded cached explanation for:', imageState.url);
      }
    } catch (error) {
      console.error('[ImageExplain] Error loading cached explanation:', error);
    }
  }

  /**
   * Handle context menu click for an image
   * Called from content script message handler
   */
  async handleContextMenuClick(imageUrl: string) {
    // Check if this image is in our detected images
    const imageState = this.imageStates.get(imageUrl);
    if (!imageState) {
      console.log('[ImageExplain] Context menu clicked on non-detected image, ignoring');
      return;
    }

    console.log('[ImageExplain] Context menu click for detected image:', imageUrl);
    await this.openImageDiscussion(imageUrl);
  }

  /**
   * Open image discussion (unified method for button and context menu)
   */
  private async openImageDiscussion(imageUrl: string) {
    const imageState = this.imageStates.get(imageUrl);
    if (!imageState) {
      return;
    }

    console.log('[ImageExplain] Opening image discussion for:', imageUrl);

    try {
      const blob = await imageElementToBlob(imageState.element);
      const title = imageState.title || 'Image Explanation';
      const buttonElement = imageState.buttonContainer; // Can be null when buttons are hidden
      const hasExplanation = !!imageState.explanation;

      // Open image tab with loading state if no explanation exists
      // buttonElement can be null - chatbox will use default positioning
      await chatboxInjector.openImageTab(imageUrl, blob, buttonElement, title, !hasExplanation);

      // Generate explanation if it doesn't exist
      if (!hasExplanation) {
        await this.generateExplanation(imageUrl);
        // After generation completes, update the tab with explanation and title
        if (imageState.explanation) {
          await chatboxInjector.updateImageTabExplanation(imageUrl, imageState.explanation, imageState.title || undefined);
        }
      }

      console.log('[ImageExplain] ✓ Image discussion opened');
    } catch (error) {
      console.error('[ImageExplain] Error opening image discussion:', error);
    }
  }

  private async handleButtonClick(imageUrl: string) {
    console.log('[ImageExplain] Button clicked for:', imageUrl);
    // Use unified discussion opener
    await this.openImageDiscussion(imageUrl);
  }

  private async generateExplanation(imageUrl: string) {
    const imageState = this.imageStates.get(imageUrl);
    if (!imageState || !this.currentPaper) {
      return;
    }

    console.log('[ImageExplain] Generating explanation for:', imageUrl);

    imageState.isLoading = true;
    this.renderButton(imageUrl, imageState.buttonRoot!);

    try {
      // Convert image to blob
      const blob = await imageElementToBlob(imageState.element);

      // Generate explanation using AI (now returns {title, explanation})
      const result = await aiService.explainImage(
        blob,
        this.currentPaper.title,
        this.currentPaper.abstract
      );

      if (result) {
        imageState.title = result.title;
        imageState.explanation = result.explanation;

        // Store in database
        await ChromeService.storeImageExplanation(
          this.currentPaper.id,
          imageUrl,
          result.title,
          result.explanation
        );

        console.log('[ImageExplain] ✓ Generated and stored explanation');
        console.log('[ImageExplain] Title:', result.title);
      } else {
        console.warn('[ImageExplain] Failed to generate explanation');
        imageState.title = 'Error';
        imageState.explanation = 'Sorry, I could not generate an explanation for this image. The multimodal API may not be available or there was an error processing the image.';
      }
    } catch (error) {
      console.error('[ImageExplain] Error generating explanation:', error);
      imageState.title = 'Error';
      imageState.explanation = `Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
    } finally {
      imageState.isLoading = false;
      // NOTE: No longer showing bubble here - using multi-tab chatbox instead
      this.renderButton(imageUrl, imageState.buttonRoot!);
    }
  }

  private renderButton(imageUrl: string, rootElement: HTMLElement) {
    const imageState = this.imageStates.get(imageUrl);
    if (!imageState) {
      return;
    }

    // Only render full button if setting is enabled
    if (this.showImageButtons) {
      render(
        h(ImageExplainButton, {
          visible: true,
          hasExplanation: !!imageState.explanation,
          isLoading: imageState.isLoading,
          onClick: () => this.handleButtonClick(imageUrl),
        }),
        rootElement
      );
    } else {
      this.renderMinimalPlaceholder(rootElement);
    }
  }

  private renderMinimalPlaceholder(rootElement: HTMLElement) {
    // Render a 1px invisible div - keeps element in DOM for compass arrow
    render(
      h('div', {
        style: {
          width: '1px',
          height: '1px',
          opacity: '0',
          pointerEvents: 'none',
        },
      }),
      rootElement
    );
  }

  /**
   * Regenerate explanation for an image (public method for chatbox integration)
   */
  async regenerateExplanation(imageUrl: string): Promise<{ title: string; explanation: string } | null> {
    const imageState = this.imageStates.get(imageUrl);
    if (!imageState || !this.currentPaper) {
      return null;
    }

    console.log('[ImageExplain] Regenerating explanation for:', imageUrl);

    // Set loading state
    imageState.isLoading = true;

    try {
      // Convert image to blob
      const blob = await imageElementToBlob(imageState.element);

      // Generate new explanation using AI
      const result = await aiService.explainImage(
        blob,
        this.currentPaper.title,
        this.currentPaper.abstract
      );

      if (result) {
        imageState.title = result.title;
        imageState.explanation = result.explanation;

        // Update in database (replaces old explanation)
        await ChromeService.storeImageExplanation(
          this.currentPaper.id,
          imageUrl,
          result.title,
          result.explanation
        );

        console.log('[ImageExplain] ✓ Regenerated and stored explanation');
        console.log('[ImageExplain] New title:', result.title);

        return result;
      } else {
        console.warn('[ImageExplain] Failed to regenerate explanation');
        return null;
      }
    } catch (error) {
      console.error('[ImageExplain] Error regenerating explanation:', error);
      return null;
    } finally {
      imageState.isLoading = false;
    }
  }

  private async handleRegenerate(imageUrl: string) {
    await this.regenerateExplanation(imageUrl);
    // Deprecated: bubbles no longer used, kept for backwards compatibility
  }

  private async loadStyles(): Promise<string> {
    try {
      const cssUrl = chrome.runtime.getURL('src/content/styles/imageExplainButton.css');
      const response = await fetch(cssUrl);
      if (response.ok) {
        return await response.text();
      }
      throw new Error(`Failed to fetch CSS: ${response.status}`);
    } catch (error) {
      console.warn('[ImageExplain] Failed to load external CSS, using inline styles:', error);
      return this.getInlineStyles();
    }
  }

  private getInlineStyles(): string {
    return `
      .image-explain-button {
        background: transparent;
        border: none;
        padding: 0;
        cursor: pointer;
        transition: all 0.2s ease;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 48px;
        height: 48px;
        position: relative;
        opacity: 0.6;
      }

      .image-explain-button:hover {
        transform: scale(1.15);
        filter: drop-shadow(0 4px 8px rgba(0, 0, 0, 0.3));
        opacity: 1.0;
      }

      .image-explain-button.has-explanation {
        /* Optional: Could add a subtle glow or indicator */
      }

      .image-explain-button.loading {
        opacity: 0.7;
        cursor: wait;
      }

      .image-explanation-bubble {
        background: white;
        border-radius: 12px;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
        padding: 16px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
        max-width: 600px;
        opacity: 0;
        transform: translateY(-10px);
        transition: opacity 0.2s ease, transform 0.2s ease;
      }

      .image-explanation-bubble.visible {
        opacity: 1;
        transform: translateY(0);
      }

      .bubble-arrow {
        position: absolute;
        left: -8px;
        top: 10px;
        width: 0;
        height: 0;
        border-top: 8px solid transparent;
        border-bottom: 8px solid transparent;
        border-right: 8px solid white;
      }

      .bubble-content {
        position: relative;
      }

      .bubble-close {
        position: absolute;
        top: -8px;
        right: -8px;
        background: oklch(37.9% 0.146 265.522);
        color: white;
        border: none;
        border-radius: 50%;
        width: 24px;
        height: 24px;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        font-size: 18px;
        line-height: 1;
        transition: background 0.2s ease;
      }

      .bubble-close:hover {
        background: oklch(42.4% 0.199 265.638);
      }

      .bubble-text {
        color: #333;
        line-height: 1.6;
        font-size: 14px;
      }

      .bubble-text p {
        margin: 0 0 12px 0;
      }

      .bubble-text p:last-child {
        margin-bottom: 0;
      }

      .bubble-text ul,
      .bubble-text ol {
        margin: 8px 0;
        padding-left: 20px;
      }

      .bubble-text li {
        margin: 4px 0;
      }

      .bubble-text strong {
        font-weight: 600;
        color: #111;
      }

      .bubble-text code {
        background: #f5f5f5;
        padding: 2px 6px;
        border-radius: 4px;
        font-family: 'Courier New', monospace;
        font-size: 13px;
      }
    `;
  }

  /**
   * Hide buttons by re-rendering as minimal placeholders
   * Keeps DOM elements in place for compass arrow and tab restoration
   */
  hideButtons() {
    console.log('[ImageExplain] Hiding image explanation buttons...');

    // Update setting
    this.showImageButtons = false;

    // Re-render all buttons as minimal placeholders
    for (const [url, state] of this.imageStates) {
      if (state.buttonRoot) {
        this.renderMinimalPlaceholder(state.buttonRoot);
      }
    }

    console.log('[ImageExplain] ✓ Buttons hidden');
  }

  /**
   * Show buttons by re-rendering as full buttons
   */
  showButtons() {
    console.log('[ImageExplain] Showing image explanation buttons...');

    // Update setting
    this.showImageButtons = true;

    // Re-render all placeholders as full buttons
    for (const [url, state] of this.imageStates) {
      if (state.buttonRoot) {
        this.renderButton(url, state.buttonRoot);
      }
    }

    console.log('[ImageExplain] ✓ Buttons shown');
  }

  destroy() {
    console.log('[ImageExplain] Destroying image explanation handler...');

    // Remove all button containers
    for (const [url, state] of this.imageStates) {
      if (state.buttonContainer && state.buttonContainer.parentNode) {
        state.buttonContainer.parentNode.removeChild(state.buttonContainer);
      }
    }

    // Disconnect mutation observer
    if (this.mutationObserver) {
      this.mutationObserver.disconnect();
      this.mutationObserver = null;
    }

    this.imageStates.clear();
    this.isInitialized = false;
  }
}

// Singleton instance
export const imageExplanationHandler = new ImageExplanationHandler();
