import { h, render } from 'preact';
import { ImageExplainButton } from '../components/ImageExplainButton.tsx';
import { detectImages, imageElementToBlob, watchForNewImages, DetectedImage } from './imageDetectionService.ts';
import * as ChromeService from '../../services/chromeService.ts';
import { aiService } from '../../shared/utils/aiService.ts';
import { chatboxInjector } from './chatboxInjector.ts'; // NEW: Multi-tab chatbox integration
import { getShowImageButtons } from '../../shared/utils/settingsService.ts';
import { logger } from '../../shared/utils/logger.ts';

interface ImageState {
  element: HTMLImageElement;
  url: string;
  title: string | null;
  explanation: string | null;
  isLoading: boolean;
  buttonContainer: HTMLDivElement | null;
  buttonRoot: HTMLElement | null;
  scrollListener?: () => void;
  resizeListener?: () => void;
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
  private explanationQueue: Promise<any> = Promise.resolve(); // Queue to serialize AI requests

  /**
   * Get image state by URL (used for tab restoration)
   */
  getImageStateByUrl(imageUrl: string): ImageState | undefined {
    return this.imageStates.get(imageUrl);
  }

  /**
   * Set image state by URL (used for screen capture restoration)
   */
  setImageState(imageUrl: string, state: ImageState): void {
    this.imageStates.set(imageUrl, state);
  }

  /**
   * Remove image state by URL (used when closing tabs)
   */
  removeImageState(imageUrl: string): void {
    const imageState = this.imageStates.get(imageUrl);
    if (imageState) {
      logger.debug('CONTENT_SCRIPT', '[ImageExplain] Removing image state for:', imageUrl);
      this.imageStates.delete(imageUrl);
    }
  }

  /**
   * Clear explanation state for an image and re-render button
   * Used when closing image tabs to reset button to unexplained state
   */
  clearExplanationState(imageUrl: string): void {
    const imageState = this.imageStates.get(imageUrl);
    if (imageState) {
      logger.debug('CONTENT_SCRIPT', '[ImageExplain] Clearing explanation state for:', imageUrl);

      // Clear explanation and title
      imageState.explanation = null;
      imageState.title = null;

      // Re-render button to show unexplained state (Q&A Lottie)
      if (imageState.buttonRoot) {
        this.renderButton(imageUrl, imageState.buttonRoot);
        logger.debug('CONTENT_SCRIPT', '[ImageExplain] ✓ Button re-rendered to unexplained state');
      }
    }
  }

  async initialize(currentPaper: any) {
    if (this.isInitialized) {
      logger.debug('CONTENT_SCRIPT', '[ImageExplain] Already initialized');
      return;
    }

    // Set flag immediately to prevent race conditions
    this.isInitialized = true;
    this.currentPaper = currentPaper;

    logger.debug('CONTENT_SCRIPT', '[ImageExplain] Initializing image explanation handler...');

    // Check multimodal API availability
    try {
      const { available } = await aiService.checkMultimodalAvailability();
      this.multimodalAvailable = available;
      logger.debug('CONTENT_SCRIPT', '[ImageExplain] Multimodal API available:', available);

      if (!available) {
        logger.debug('CONTENT_SCRIPT', '[ImageExplain] Multimodal API not available, feature will be hidden');
        this.isInitialized = false; // Reset flag on early return
        return; // Don't initialize if API not available
      }
    } catch (error) {
      logger.error('CONTENT_SCRIPT', '[ImageExplain] Error checking multimodal availability:', error);
      this.isInitialized = false; // Reset flag on early return
      return;
    }

    // Load user setting for button visibility FIRST
    try {
      this.showImageButtons = await getShowImageButtons();
      logger.debug('CONTENT_SCRIPT', '[ImageExplain] Button visibility setting:', this.showImageButtons);
    } catch (error) {
      logger.error('CONTENT_SCRIPT', '[ImageExplain] Error loading settings:', error);
      this.showImageButtons = true; // Default to visible
    }

    // Detect and setup images (will render correctly based on showImageButtons)
    await this.setupImages();

    // Watch for dynamically added images
    this.mutationObserver = watchForNewImages(async (newImages) => {
      await this.setupImages();
    });

    logger.debug('CONTENT_SCRIPT', '[ImageExplain] ✓ Image explanation handler initialized');
  }

  /**
   * Reinitialize image explanation handler
   * Destroys existing buttons and recreates them
   */
  async reinitialize(currentPaper: any) {
    logger.debug('CONTENT_SCRIPT', '[ImageExplain] Reinitializing image explanation handler...');

    // Destroy existing buttons
    this.destroy();

    // Re-initialize with new paper
    await this.initialize(currentPaper);
  }

  private async setupImages() {
    if (!this.currentPaper) {
      logger.debug('CONTENT_SCRIPT', '[ImageExplain] No current paper, skipping image setup');
      return;
    }

    const images = detectImages();
    logger.debug('CONTENT_SCRIPT', '[ImageExplain] Setting up', images.length, 'images');

    for (const image of images) {
      // Skip if already set up
      if (this.imageStates.has(image.url)) {
        continue;
      }

      await this.setupImageButton(image);
    }
  }

  private async setupImageButton(image: DetectedImage) {
    logger.debug('CONTENT_SCRIPT', '[ImageExplain] Setting up button for image:', image.url);

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

    // Create and store event listeners for cleanup
    const scrollListener = () => {
      this.positionButton(image.element, buttonContainer);
    };
    const resizeListener = () => {
      this.positionButton(image.element, buttonContainer);
    };

    imageState.scrollListener = scrollListener;
    imageState.resizeListener = resizeListener;

    // Re-position on scroll or resize
    window.addEventListener('scroll', scrollListener, true);
    window.addEventListener('resize', resizeListener);
  }

  private positionButton(img: HTMLImageElement, buttonContainer: HTMLDivElement) {
    const rect = img.getBoundingClientRect();
    buttonContainer.style.left = `${rect.left + 8}px`; // Left edge + padding
    buttonContainer.style.top = `${rect.top + 8}px`; // Top edge + padding
  }

  private async loadCachedExplanation(imageState: ImageState) {
    if (!this.currentPaper || !this.currentPaper.id) {
      logger.debug('CONTENT_SCRIPT', '[ImageExplain] Cannot load cached explanation: no paper or paper ID');
      return;
    }

    try {
      logger.debug('CONTENT_SCRIPT', '[ImageExplain] Checking for cached explanation:', imageState.url, 'paperId:', this.currentPaper.id);
      const response = await ChromeService.getImageExplanation(
        this.currentPaper.id,
        imageState.url
      );

      logger.debug('CONTENT_SCRIPT', '[ImageExplain] Cache check response:', { success: response.success, hasExplanation: !!response.explanation });

      if (response.success && response.explanation) {
        imageState.title = response.explanation.title || 'Image Explanation';
        imageState.explanation = response.explanation.explanation;
        logger.debug('CONTENT_SCRIPT', '[ImageExplain] ✓ Loaded cached explanation for:', imageState.url);
      } else {
        logger.debug('CONTENT_SCRIPT', '[ImageExplain] No cached explanation found for:', imageState.url);
      }
    } catch (error) {
      logger.error('CONTENT_SCRIPT', '[ImageExplain] Error loading cached explanation:', error);
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
      logger.debug('CONTENT_SCRIPT', '[ImageExplain] Context menu clicked on non-detected image, ignoring');
      return;
    }

    logger.debug('CONTENT_SCRIPT', '[ImageExplain] Context menu click for detected image:', imageUrl);
    await this.openImageDiscussion(imageUrl);
  }

  /**
   * Handle screen capture from PDF or HTML pages
   * Creates a synthetic image state for the captured screen area
   * Public method called by screenCaptureService
   *
   * @param imageUrl - Synthetic URL identifier for the capture
   * @param blob - Blob data of the captured image
   * @param overlayElement - Optional overlay element for HTML pages (enables scroll-to-image)
   * @param overlayPosition - Optional overlay position for HTML pages (enables overlay recreation on restore)
   */
  async handleScreenCapture(
    imageUrl: string,
    blob: Blob,
    overlayElement?: HTMLDivElement,
    overlayPosition?: { pageX: number; pageY: number; width: number; height: number }
  ): Promise<void> {
    if (!this.currentPaper) {
      logger.warn('CONTENT_SCRIPT', '[ImageExplain] No current paper, cannot process screen capture');
      return;
    }

    logger.debug('CONTENT_SCRIPT', '[ImageExplain] Handling screen capture:', imageUrl);

    try {
      // Create synthetic image state
      // For HTML pages with overlay, use overlay as element for scroll-to-image
      const imageState: ImageState = {
        element: (overlayElement || null) as any, // Use overlay element if provided
        url: imageUrl,
        title: null,
        explanation: null,
        isLoading: false,
        buttonContainer: null, // No button for screen captures
        buttonRoot: null,
      };

      // Store in imageStates map
      this.imageStates.set(imageUrl, imageState);

      // Store blob in IndexedDB for persistence
      try {
        logger.debug('CONTENT_SCRIPT', '[ImageExplain] 🔍 Storing screen capture with paperId:', this.currentPaper.id, 'imageUrl:', imageUrl);
        await ChromeService.storeScreenCapture(this.currentPaper.id, imageUrl, blob, overlayPosition);
        logger.debug('CONTENT_SCRIPT', '[ImageExplain] ✓ Screen capture blob stored in IndexedDB');
      } catch (error) {
        logger.error('CONTENT_SCRIPT', '[ImageExplain] Failed to store screen capture blob:', error);
        // Continue anyway - blob is still in memory
      }

      // Open chatbox with the captured image
      // Pass overlay element as imageButtonElement for scroll-to-image functionality
      const title = 'Image Capture Explanation';
      // Show loading state while generating explanation
      await chatboxInjector.openImageTab(imageUrl, blob, overlayElement || null, '___LOADING_EXPLANATION___', title);

      // Generate explanation
      await this.generateExplanationFromBlob(imageUrl, blob);

      // Update chatbox with explanation
      if (imageState.explanation) {
        await chatboxInjector.updateImageTabExplanation(
          imageUrl,
          imageState.explanation,
          imageState.title || undefined
        );
      }

      logger.debug('CONTENT_SCRIPT', '[ImageExplain] ✓ Screen capture processed');
    } catch (error) {
      logger.error('CONTENT_SCRIPT', '[ImageExplain] Error processing screen capture:', error);
    }
  }

  /**
   * Open image discussion (unified method for button and context menu)
   */
  private async openImageDiscussion(imageUrl: string) {
    const imageState = this.imageStates.get(imageUrl);
    if (!imageState) {
      return;
    }

    logger.debug('CONTENT_SCRIPT', '[ImageExplain] Opening image discussion for:', imageUrl);

    try {
      const blob = await imageElementToBlob(imageState.element);
      const title = imageState.title || 'Image Explanation';
      const buttonElement = imageState.buttonContainer; // For compass tracking; scroll uses imageState.element
      const hasExplanation = !!imageState.explanation;

      // Open image tab with loading state if no explanation exists
      // buttonElement is used for compass tracking (scroll-to-image looks up the actual image element)
      const loadingMessage = !hasExplanation ? '___LOADING_EXPLANATION___' : undefined;
      await chatboxInjector.openImageTab(imageUrl, blob, buttonElement, loadingMessage, title);

      // Generate explanation if it doesn't exist
      if (!hasExplanation) {
        await this.generateExplanation(imageUrl);
        // After generation completes, update the tab with explanation and title
        if (imageState.explanation) {
          await chatboxInjector.updateImageTabExplanation(imageUrl, imageState.explanation, imageState.title || undefined);
        }
      }

      logger.debug('CONTENT_SCRIPT', '[ImageExplain] ✓ Image discussion opened');
    } catch (error) {
      logger.error('CONTENT_SCRIPT', '[ImageExplain] Error opening image discussion:', error);
    }
  }

  private async handleButtonClick(imageUrl: string) {
    logger.debug('CONTENT_SCRIPT', '[ImageExplain] Button clicked for:', imageUrl);
    // Use unified discussion opener
    await this.openImageDiscussion(imageUrl);
  }

  private async generateExplanation(imageUrl: string) {
    // Queue this request to prevent concurrent AI calls
    this.explanationQueue = this.explanationQueue.then(() => this._generateExplanationImpl(imageUrl));
    return this.explanationQueue;
  }

  private async _generateExplanationImpl(imageUrl: string) {
    const imageState = this.imageStates.get(imageUrl);
    if (!imageState || !this.currentPaper) {
      return;
    }

    const startTime = Date.now();
    logger.debug('CONTENT_SCRIPT', '[ImageExplain] 🔍 [START] Generating explanation for:', imageUrl, 'at', startTime);
    logger.debug('CONTENT_SCRIPT', '[ImageExplain] 🔍 Image element src:', imageState.element?.src?.substring(0, 100));
    logger.debug('CONTENT_SCRIPT', '[ImageExplain] 🔍 ImageState URL:', imageState.url);
    logger.debug('CONTENT_SCRIPT', '[ImageExplain] 🔍 IsLoading before:', imageState.isLoading);

    imageState.isLoading = true;
    this.renderButton(imageUrl, imageState.buttonRoot!);

    try {
      // Convert image to blob
      logger.debug('CONTENT_SCRIPT', '[ImageExplain] 🔍 Converting element to blob...');
      const blob = await imageElementToBlob(imageState.element);
      logger.debug('CONTENT_SCRIPT', '[ImageExplain] 🔍 Blob created, size:', blob.size, 'type:', blob.type);

      // Generate explanation using AI (now returns {title, explanation})
      logger.debug('CONTENT_SCRIPT', '[ImageExplain] 🔍 [AI START] Calling AI for:', imageUrl);
      const result = await aiService.explainImage(
        blob,
        this.currentPaper.title,
        this.currentPaper.abstract
      );
      const endTime = Date.now();
      logger.debug('CONTENT_SCRIPT', '[ImageExplain] 🔍 [AI END] AI response for:', imageUrl, 'took', endTime - startTime, 'ms');

      if (result) {
        imageState.title = result.title;
        imageState.explanation = result.explanation;

        // Store in database
        logger.debug('CONTENT_SCRIPT', '[ImageExplain] 🔍 Storing regular image explanation with URL:', imageUrl);
        logger.debug('CONTENT_SCRIPT', '[ImageExplain] 🔍 Title:', result.title);
        logger.debug('CONTENT_SCRIPT', '[ImageExplain] 🔍 Paper ID:', this.currentPaper.id);
        await ChromeService.storeImageExplanation(
          this.currentPaper.id,
          imageUrl,
          result.title,
          result.explanation
        );

        logger.debug('CONTENT_SCRIPT', '[ImageExplain] ✓ Generated and stored explanation');
      } else {
        logger.warn('CONTENT_SCRIPT', '[ImageExplain] Failed to generate explanation');
        imageState.title = 'Error';
        imageState.explanation = 'Sorry, I could not generate an explanation for this image. The multimodal API may not be available or there was an error processing the image.';
      }
    } catch (error) {
      logger.error('CONTENT_SCRIPT', '[ImageExplain] Error generating explanation:', error);
      imageState.title = 'Error';
      imageState.explanation = `Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
    } finally {
      imageState.isLoading = false;
      // NOTE: No longer showing bubble here - using multi-tab chatbox instead
      this.renderButton(imageUrl, imageState.buttonRoot!);
    }
  }

  /**
   * Generate explanation from blob directly (for screen captures)
   * Similar to generateExplanation but skips the element-to-blob conversion
   */
  private async generateExplanationFromBlob(imageUrl: string, blob: Blob): Promise<void> {
    // Queue this request to prevent concurrent AI calls
    this.explanationQueue = this.explanationQueue.then(() => this._generateExplanationFromBlobImpl(imageUrl, blob));
    return this.explanationQueue;
  }

  private async _generateExplanationFromBlobImpl(imageUrl: string, blob: Blob): Promise<void> {
    const imageState = this.imageStates.get(imageUrl);
    if (!imageState || !this.currentPaper) {
      return;
    }

    const startTime = Date.now();
    logger.debug('CONTENT_SCRIPT', '[ImageExplain] 🔍 [START] Generating explanation from blob for:', imageUrl, 'at', startTime);
    logger.debug('CONTENT_SCRIPT', '[ImageExplain] 🔍 Blob size:', blob.size, 'type:', blob.type);
    logger.debug('CONTENT_SCRIPT', '[ImageExplain] 🔍 ImageState URL:', imageState.url);
    logger.debug('CONTENT_SCRIPT', '[ImageExplain] 🔍 IsLoading before:', imageState.isLoading);

    imageState.isLoading = true;

    try {
      // Generate explanation using AI (now returns {title, explanation})
      logger.debug('CONTENT_SCRIPT', '[ImageExplain] 🔍 [AI START] Calling AI service for screen capture:', imageUrl);
      const result = await aiService.explainImage(
        blob,
        this.currentPaper.title,
        this.currentPaper.abstract
      );
      const endTime = Date.now();
      logger.debug('CONTENT_SCRIPT', '[ImageExplain] 🔍 [AI END] AI response for screen capture:', imageUrl, 'took', endTime - startTime, 'ms');

      if (result) {
        imageState.title = result.title;
        imageState.explanation = result.explanation;

        // Store in database
        logger.debug('CONTENT_SCRIPT', '[ImageExplain] 🔍 Storing screen capture explanation with URL:', imageUrl);
        logger.debug('CONTENT_SCRIPT', '[ImageExplain] 🔍 Title:', result.title);
        logger.debug('CONTENT_SCRIPT', '[ImageExplain] 🔍 Paper ID:', this.currentPaper.id);
        await ChromeService.storeImageExplanation(
          this.currentPaper.id,
          imageUrl,
          result.title,
          result.explanation
        );

        logger.debug('CONTENT_SCRIPT', '[ImageExplain] ✓ Generated and stored explanation from blob');
      } else {
        logger.warn('CONTENT_SCRIPT', '[ImageExplain] Failed to generate explanation from blob');
        imageState.title = 'Error';
        imageState.explanation = 'Sorry, I could not generate an explanation for this image. The multimodal API may not be available or there was an error processing the image.';
      }
    } catch (error) {
      logger.error('CONTENT_SCRIPT', '[ImageExplain] Error generating explanation from blob:', error);
      imageState.title = 'Error';
      imageState.explanation = `Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
    } finally {
      imageState.isLoading = false;
    }
  }

  private renderButton(imageUrl: string, rootElement: HTMLElement) {
    const imageState = this.imageStates.get(imageUrl);
    if (!imageState) {
      return;
    }

    const hasExplanation = !!imageState.explanation;

    // Only render full button if setting is enabled
    if (this.showImageButtons) {
      render(
        h(ImageExplainButton, {
          visible: true,
          hasExplanation,
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

    logger.debug('CONTENT_SCRIPT', '[ImageExplain] Regenerating explanation for:', imageUrl);

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

        logger.debug('CONTENT_SCRIPT', '[ImageExplain] ✓ Regenerated and stored explanation');
        logger.debug('CONTENT_SCRIPT', '[ImageExplain] New title:', result.title);

        return result;
      } else {
        logger.warn('CONTENT_SCRIPT', '[ImageExplain] Failed to regenerate explanation');
        return null;
      }
    } catch (error) {
      logger.error('CONTENT_SCRIPT', '[ImageExplain] Error regenerating explanation:', error);
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
      logger.warn('CONTENT_SCRIPT', '[ImageExplain] Failed to load external CSS, using inline styles:', error);
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
        opacity: 0.3;
      }

      .image-explain-button.has-explanation:hover {
        opacity: 1.0;
        transform: scale(1.15);
        filter: drop-shadow(0 4px 8px rgba(0, 0, 0, 0.3));
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
    logger.debug('CONTENT_SCRIPT', '[ImageExplain] Hiding image explanation buttons...');

    // Update setting
    this.showImageButtons = false;

    // Re-render all buttons as minimal placeholders
    for (const [url, state] of this.imageStates) {
      if (state.buttonRoot) {
        this.renderMinimalPlaceholder(state.buttonRoot);
      }
    }

    logger.debug('CONTENT_SCRIPT', '[ImageExplain] ✓ Buttons hidden');
  }

  /**
   * Show buttons by re-rendering as full buttons
   */
  showButtons() {
    logger.debug('CONTENT_SCRIPT', '[ImageExplain] Showing image explanation buttons...');

    // Update setting
    this.showImageButtons = true;

    // Re-render all placeholders as full buttons
    for (const [url, state] of this.imageStates) {
      if (state.buttonRoot) {
        this.renderButton(url, state.buttonRoot);
      }
    }

    logger.debug('CONTENT_SCRIPT', '[ImageExplain] ✓ Buttons shown');
  }

  /**
   * Refresh button states by re-checking for cached explanations
   * Called after chatbox restores tabs to sync button states with chat history
   */
  async refreshButtonStates() {
    logger.debug('CONTENT_SCRIPT', '[ImageExplain] Refreshing button states...');

    for (const [url, state] of this.imageStates) {
      // Re-check for cached explanation
      await this.loadCachedExplanation(state);

      // Re-render button with updated state
      if (state.buttonRoot) {
        this.renderButton(url, state.buttonRoot);
      }
    }

    logger.debug('CONTENT_SCRIPT', '[ImageExplain] ✓ Button states refreshed');
  }

  destroy() {
    logger.debug('CONTENT_SCRIPT', '[ImageExplain] Destroying image explanation handler...');

    // Remove all button containers, event listeners, and screen capture overlays
    for (const [url, state] of this.imageStates) {
      // Remove event listeners
      if (state.scrollListener) {
        window.removeEventListener('scroll', state.scrollListener, true);
      }
      if (state.resizeListener) {
        window.removeEventListener('resize', state.resizeListener);
      }

      // Remove button container
      if (state.buttonContainer && state.buttonContainer.parentNode) {
        state.buttonContainer.parentNode.removeChild(state.buttonContainer);
      }

      // Remove screen capture overlay elements (HTML page overlays)
      if ((url.startsWith('screen-capture-') || url.startsWith('pdf-capture-')) && state.element) {
        const overlay = state.element as HTMLDivElement;
        if (overlay.parentNode && overlay.className === 'kuma-screen-capture-overlay') {
          overlay.parentNode.removeChild(overlay);
          logger.debug('CONTENT_SCRIPT', '[ImageExplain] Removed screen capture overlay for:', url);
        }
      }
    }

    // Defensive cleanup: Remove any orphaned button containers from DOM
    // (in case we lost track of references)
    const orphanedContainers = document.querySelectorAll('.kuma-image-button-container');
    orphanedContainers.forEach(container => {
      if (container.parentNode) {
        container.parentNode.removeChild(container);
        logger.debug('CONTENT_SCRIPT', '[ImageExplain] Removed orphaned button container');
      }
    });

    // Defensive cleanup: Remove any orphaned screen capture overlays
    const orphanedOverlays = document.querySelectorAll('.kuma-screen-capture-overlay');
    orphanedOverlays.forEach(overlay => {
      if (overlay.parentNode) {
        overlay.parentNode.removeChild(overlay);
        logger.debug('CONTENT_SCRIPT', '[ImageExplain] Removed orphaned screen capture overlay');
      }
    });

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
