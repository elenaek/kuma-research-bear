import { h, render } from 'preact';
import { PDFCaptureButton } from '../components/PDFCaptureButton.tsx';
import { ScreenCaptureOverlay, SelectionRect } from '../components/ScreenCaptureOverlay.tsx';
import { isPDFPage } from '../../utils/contentExtractor.ts';
import { imageExplanationHandler } from './imageExplanationHandler.ts';
import { logger } from '../../utils/logger.ts';

/**
 * Screen Capture Service
 * Manages screen capture functionality for both PDF and HTML pages
 * Allows users to select an area of the page to capture and explain
 */
class ScreenCaptureService {
  private isInitialized = false;
  private buttonContainer: HTMLDivElement | null = null;
  private buttonRoot: HTMLElement | null = null;
  private overlayContainer: HTMLDivElement | null = null;
  private overlayRoot: HTMLElement | null = null;
  private isCapturing = false;

  /**
   * Initialize PDF capture button on PDF pages
   * Creates a floating button for PDFs only
   */
  async initializePDFCapture(): Promise<void> {
    if (this.isInitialized) {
      logger.debug('CONTENT_SCRIPT', '[ScreenCapture] Already initialized');
      return;
    }

    // Only initialize on PDF pages
    if (!isPDFPage()) {
      logger.debug('CONTENT_SCRIPT', '[ScreenCapture] Not a PDF page, skipping button initialization');
      return;
    }

    logger.debug('CONTENT_SCRIPT', '[ScreenCapture] Initializing PDF screen capture button...');

    // Create button container
    await this.createButton();

    // Create overlay container (hidden by default)
    await this.createOverlay();

    this.isInitialized = true;
    logger.debug('CONTENT_SCRIPT', '[ScreenCapture] ✓ PDF screen capture button initialized');
  }

  /**
   * Initialize overlay for screen capture (without button)
   * Used for HTML pages where capture is triggered from context menu
   */
  async initializeOverlay(): Promise<void> {
    if (this.overlayContainer) {
      logger.debug('CONTENT_SCRIPT', '[ScreenCapture] Overlay already initialized');
      return;
    }

    logger.debug('CONTENT_SCRIPT', '[ScreenCapture] Initializing screen capture overlay...');

    // Create overlay container (hidden by default)
    await this.createOverlay();

    logger.debug('CONTENT_SCRIPT', '[ScreenCapture] ✓ Screen capture overlay initialized');
  }

  /**
   * Create capture button (for PDF pages)
   */
  private async createButton(): Promise<void> {
    // Create container for button
    this.buttonContainer = document.createElement('div');
    this.buttonContainer.className = 'kuma-pdf-capture-button-container';
    this.buttonContainer.style.cssText = `
      position: fixed;
      top: 8px;
      right: 120px;
      z-index: 2147483645;
    `;

    // Create shadow DOM for style isolation
    const shadowRoot = this.buttonContainer.attachShadow({ mode: 'open' });

    // Add styles to shadow DOM
    const styleSheet = document.createElement('style');
    const styles = await this.loadStyles();
    styleSheet.textContent = styles;
    shadowRoot.appendChild(styleSheet);

    // Create root element for Preact
    this.buttonRoot = document.createElement('div');
    shadowRoot.appendChild(this.buttonRoot);

    // Append to body
    document.body.appendChild(this.buttonContainer);

    // Render button
    this.renderButton();
  }

  /**
   * Create overlay (initially hidden)
   */
  private async createOverlay(): Promise<void> {
    // Create container for overlay
    this.overlayContainer = document.createElement('div');
    this.overlayContainer.className = 'kuma-pdf-capture-overlay-container';

    // Create shadow DOM for style isolation
    const shadowRoot = this.overlayContainer.attachShadow({ mode: 'open' });

    // Create root element for Preact
    this.overlayRoot = document.createElement('div');
    shadowRoot.appendChild(this.overlayRoot);

    // Append to body
    document.body.appendChild(this.overlayContainer);

    // Render overlay (initially hidden)
    this.renderOverlay();
  }

  /**
   * Render button component
   */
  private renderButton(): void {
    if (!this.buttonRoot) return;

    render(
      h(PDFCaptureButton, {
        visible: true,
        isCapturing: this.isCapturing,
        onClick: () => this.startCaptureMode(),
      }),
      this.buttonRoot
    );
  }

  /**
   * Render overlay component
   */
  private renderOverlay(): void {
    if (!this.overlayRoot) return;

    render(
      h(ScreenCaptureOverlay, {
        visible: this.isCapturing,
        onSelectionComplete: (rect: SelectionRect) => this.handleSelectionComplete(rect),
        onCancel: () => this.cancelCaptureMode(),
      }),
      this.overlayRoot
    );
  }

  /**
   * Start capture mode - show overlay
   * Public method that can be called from context menu or button
   */
  startCaptureMode(): void {
    logger.debug('CONTENT_SCRIPT', '[ScreenCapture] Starting capture mode...');

    // Initialize overlay if not already done (for HTML pages triggered from context menu)
    if (!this.overlayContainer) {
      this.initializeOverlay().then(() => {
        this.isCapturing = true;
        this.renderButton();
        this.renderOverlay();
      });
    } else {
      this.isCapturing = true;
      this.renderButton();
      this.renderOverlay();
    }
  }

  /**
   * Cancel capture mode - hide overlay
   */
  private cancelCaptureMode(): void {
    logger.debug('CONTENT_SCRIPT', '[ScreenCapture] Canceling capture mode...');
    this.isCapturing = false;
    this.renderButton();
    this.renderOverlay();
  }

  /**
   * Handle selection complete - capture and process image
   */
  private async handleSelectionComplete(rect: SelectionRect): Promise<void> {
    logger.debug('CONTENT_SCRIPT', '[ScreenCapture] Selection complete:', rect);

    try {
      // FIRST: Hide overlay before capturing to avoid capturing it in the screenshot
      this.isCapturing = false;
      this.renderButton();
      this.renderOverlay();

      // Wait for overlay to fully disappear (2 animation frames ensures paint happens)
      await new Promise<void>(resolve => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => resolve());
        });
      });

      // NOW capture screenshot (overlay is hidden)
      const dataUrl = await this.captureScreenshot();

      if (!dataUrl) {
        throw new Error('Failed to capture screenshot');
      }

      // Crop the screenshot to selection
      const croppedBlob = await this.cropImage(dataUrl, rect);

      // Generate synthetic image URL for this capture
      const imageUrl = `screen-capture-${Date.now()}-${Math.random().toString(36).substring(7)}`;

      // Create overlay element for HTML pages (not PDFs)
      // This allows scroll-to-image functionality
      let overlayElement: HTMLDivElement | undefined;
      if (!isPDFPage()) {
        overlayElement = this.createCaptureOverlay(rect);
        logger.debug('CONTENT_SCRIPT', '[ScreenCapture] Created overlay for HTML page');
      } else {
        logger.debug('CONTENT_SCRIPT', '[ScreenCapture] Skipping overlay for PDF page');
      }

      // Hand off to image explanation handler
      await imageExplanationHandler.handleScreenCapture(imageUrl, croppedBlob, overlayElement);

      logger.debug('CONTENT_SCRIPT', '[ScreenCapture] ✓ Screen capture complete');
    } catch (error) {
      logger.error('CONTENT_SCRIPT', '[ScreenCapture] Error during capture:', error);
      this.cancelCaptureMode();
      alert('Failed to capture screen area. Please try again.');
    }
  }

  /**
   * Request screenshot from background script
   */
  private async captureScreenshot(): Promise<string | null> {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'CAPTURE_PDF_SCREENSHOT',
      });

      if (response && response.success && response.dataUrl) {
        return response.dataUrl;
      }

      logger.error('CONTENT_SCRIPT', '[ScreenCapture] Screenshot capture failed:', response);
      return null;
    } catch (error) {
      logger.error('CONTENT_SCRIPT', '[ScreenCapture] Error requesting screenshot:', error);
      return null;
    }
  }

  /**
   * Crop image to selection rectangle using canvas
   */
  private async cropImage(dataUrl: string, rect: SelectionRect): Promise<Blob> {
    return new Promise((resolve, reject) => {
      const img = new Image();

      img.onload = () => {
        try {
          // Create canvas for cropped image
          const canvas = document.createElement('canvas');
          canvas.width = rect.width;
          canvas.height = rect.height;

          const ctx = canvas.getContext('2d');
          if (!ctx) {
            reject(new Error('Failed to get canvas context'));
            return;
          }

          // Draw cropped portion
          ctx.drawImage(
            img,
            rect.x, rect.y, rect.width, rect.height, // Source rectangle
            0, 0, rect.width, rect.height // Destination rectangle
          );

          // Convert to blob
          canvas.toBlob((blob) => {
            if (blob) {
              resolve(blob);
            } else {
              reject(new Error('Failed to convert canvas to blob'));
            }
          }, 'image/png');
        } catch (error) {
          reject(error);
        }
      };

      img.onerror = () => {
        reject(new Error('Failed to load screenshot image'));
      };

      img.src = dataUrl;
    });
  }

  /**
   * Load CSS styles for button
   */
  private async loadStyles(): Promise<string> {
    try {
      const cssUrl = chrome.runtime.getURL('src/content/styles/pdfCaptureButton.css');
      const response = await fetch(cssUrl);
      if (response.ok) {
        return await response.text();
      }
      throw new Error(`Failed to fetch CSS: ${response.status}`);
    } catch (error) {
      logger.warn('CONTENT_SCRIPT', '[ScreenCapture] Failed to load external CSS, using inline styles:', error);
      return this.getInlineStyles();
    }
  }

  /**
   * Create a persistent overlay element at the capture position (HTML pages only)
   * This overlay is invisible but allows scroll-to-image functionality
   */
  private createCaptureOverlay(rect: SelectionRect): HTMLDivElement {
    const overlay = document.createElement('div');
    overlay.className = 'kuma-screen-capture-overlay';
    overlay.style.cssText = `
      position: absolute;
      left: ${rect.pageX}px;
      top: ${rect.pageY}px;
      width: ${rect.width}px;
      height: ${rect.height}px;
      pointer-events: none;
      z-index: 1;
      opacity: 0;
      transition: opacity 0.3s ease, background-color 0.3s ease;
    `;
    document.body.appendChild(overlay);
    logger.debug('CONTENT_SCRIPT', '[ScreenCapture] Created overlay at', { pageX: rect.pageX, pageY: rect.pageY, width: rect.width, height: rect.height });
    return overlay;
  }

  /**
   * Fallback inline styles
   */
  private getInlineStyles(): string {
    return `
      .pdf-capture-button {
        position: relative;
        width: 40px;
        height: 40px;
        border-radius: 50%;
        background: oklch(37.9% 0.146 265.522);
        border: none;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
        transition: all 0.2s ease;
        opacity: 0.8;
      }

      .pdf-capture-button:hover {
        opacity: 1;
        transform: scale(1.1);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
      }

      .pdf-capture-button.capturing {
        background: oklch(42.4% 0.199 265.638);
        opacity: 1;
      }

      .capture-hint {
        position: absolute;
        top: 50px;
        right: 0;
        white-space: nowrap;
        background: rgba(0, 0, 0, 0.85);
        color: white;
        padding: 6px 12px;
        border-radius: 6px;
        font-size: 12px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        pointer-events: none;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
      }
    `;
  }

  /**
   * Destroy capture service
   */
  destroy(): void {
    logger.debug('CONTENT_SCRIPT', '[ScreenCapture] Destroying screen capture...');

    // Remove button container
    if (this.buttonContainer && this.buttonContainer.parentNode) {
      this.buttonContainer.parentNode.removeChild(this.buttonContainer);
    }

    // Remove overlay container
    if (this.overlayContainer && this.overlayContainer.parentNode) {
      this.overlayContainer.parentNode.removeChild(this.overlayContainer);
    }

    this.buttonContainer = null;
    this.buttonRoot = null;
    this.overlayContainer = null;
    this.overlayRoot = null;
    this.isInitialized = false;
    this.isCapturing = false;
  }
}

// Singleton instance
export const screenCaptureService = new ScreenCaptureService();
