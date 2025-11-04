/**
 * CompassTracker - Manages compass arrow tracking for image tabs
 *
 * Responsibilities:
 * - Calculate compass arrow angle pointing to image buttons
 * - Setup scroll/resize listeners for dynamic tracking
 * - Manage Intersection Observers for performance optimization
 * - Handle idle detection to pause updates when user is inactive
 * - Throttle rendering with requestAnimationFrame
 *
 * Performance Optimizations:
 * - Pauses updates when chatbox or image button is off-screen (Intersection Observers)
 * - Pauses updates after 3 seconds of user inactivity (idle detection)
 * - Throttles render calls with requestAnimationFrame
 * - Normalizes angles to prevent 360° spins during CSS transitions
 */

export interface TabWithImage {
  id: string;
  type: 'image' | 'paper';
  imageButtonElement?: HTMLElement;
  overlayPosition?: {
    pageX: number;
    pageY: number;
    width: number;
    height: number;
  };
}

export interface ChatboxPosition {
  x: number;
  y: number;
  width: number;
  height: number;
}

export class CompassTracker {
  // Angle tracking
  private previousAngle: number | null = null;

  // Event listeners
  private scrollListener: (() => void) | null = null;
  private documentScrollListener: (() => void) | null = null;
  private resizeListener: (() => void) | null = null;
  private activityListener: (() => void) | null = null;

  // Intersection Observers for performance
  private chatboxObserver: IntersectionObserver | null = null;
  private imageButtonObserver: IntersectionObserver | null = null;
  private isChatboxVisible = true;
  private isImageButtonVisible = true;

  // Idle detection for performance
  private idleTimer: number | null = null;
  private isUserIdle = false;
  private lastActivityTime = Date.now();
  private readonly idleTimeoutMs = 3000; // 3 seconds of inactivity

  /**
   * Calculate compass arrow angle pointing to image button
   *
   * @param tab - Tab with image button element
   * @param chatboxPosition - Chatbox position settings
   * @param shadowRoot - Shadow DOM root to find arrow element
   * @returns Angle in degrees
   */
  getCompassAngle(
    tab: TabWithImage,
    chatboxPosition: ChatboxPosition,
    shadowRoot: ShadowRoot | null
  ): number {
    if (tab.type !== 'image') {
      return 0;
    }

    // Need either a button element or overlay position
    if (!tab.imageButtonElement && !tab.overlayPosition) {
      return 0;
    }

    // Get compass arrow position from actual element in shadow DOM
    const arrowElement = shadowRoot?.querySelector('.chatbox-compass-arrow') as SVGElement;
    let chatboxCenterX: number;
    let chatboxCenterY: number;

    if (arrowElement) {
      // Use actual arrow element position for precise tracking
      const arrowRect = arrowElement.getBoundingClientRect();
      chatboxCenterX = arrowRect.left + arrowRect.width / 2;
      chatboxCenterY = arrowRect.top + arrowRect.height / 2;
    } else {
      // Fallback to approximation if arrow not found
      chatboxCenterX = chatboxPosition.x + chatboxPosition.width / 2;
      chatboxCenterY = chatboxPosition.y + 60; // Approximate header height
    }

    // Get target position (either from button element or overlay position)
    let buttonCenterX: number;
    let buttonCenterY: number;

    if (tab.imageButtonElement) {
      // Use actual button element position (viewport coordinates)
      const buttonRect = tab.imageButtonElement.getBoundingClientRect();
      buttonCenterX = buttonRect.left + buttonRect.width / 2;
      buttonCenterY = buttonRect.top + buttonRect.height / 2;
    } else if (tab.overlayPosition) {
      // Use stored overlay position (convert from page coordinates to viewport coordinates)
      // overlayPosition stores absolute page coordinates, but we need viewport coordinates
      const viewportX = tab.overlayPosition.pageX - window.scrollX;
      const viewportY = tab.overlayPosition.pageY - window.scrollY;
      buttonCenterX = viewportX + tab.overlayPosition.width / 2;
      buttonCenterY = viewportY + tab.overlayPosition.height / 2;
    } else {
      return 0;
    }

    // Calculate raw angle
    const deltaX = buttonCenterX - chatboxCenterX;
    const deltaY = buttonCenterY - chatboxCenterY;
    let angle = Math.atan2(deltaY, deltaX) * (180 / Math.PI);

    // Normalize angle to prevent 360° spins during CSS transitions
    // Keep the new angle within ±180° of the previous angle
    if (this.previousAngle !== null) {
      let diff = angle - this.previousAngle;

      // If difference is greater than 180°, we crossed the boundary
      if (diff > 180) {
        angle -= 360;
      } else if (diff < -180) {
        angle += 360;
      }
    }

    // Store normalized angle for next comparison
    this.previousAngle = angle;

    return angle;
  }

  /**
   * Get arrow angle for a tab (simplified API that uses cached state)
   * This is a convenience method that uses the last known angle from tracking
   *
   * @param tab - Tab to get angle for
   * @returns Arrow angle in degrees, or undefined if not an image tab
   */
  getArrowAngle(tab: TabWithImage): number | undefined {
    if (tab.type !== 'image') {
      return undefined;
    }

    // Need either button element or overlay position
    if (!tab.imageButtonElement && !tab.overlayPosition) {
      return undefined;
    }

    // Return the last computed angle from tracking
    // If tracking hasn't run yet, return 0 as default
    return this.previousAngle ?? 0;
  }

  /**
   * Check if compass updates should be paused (performance optimization)
   *
   * Pauses when:
   * - Chatbox is off-screen
   * - Image button is off-screen
   * - User has been idle for 3+ seconds
   *
   * @returns True if updates should be paused
   */
  shouldPauseUpdates(): boolean {
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
   *
   * @param activeTab - Currently active tab with image button
   * @param chatboxContainer - Chatbox container element
   * @param onUpdate - Callback to trigger re-render
   */
  setupTracking(activeTab: TabWithImage, chatboxContainer: HTMLElement, onUpdate: () => void): void {
    // Remove any existing listeners
    this.cleanup();

    // Only set up if active tab is an image tab
    if (activeTab.type !== 'image') {
      return;
    }

    // Reset angle tracking for fresh start
    this.previousAngle = null;

    // Throttled render for performance (using requestAnimationFrame)
    let rafPending = false;
    const throttledRender = (bypassPauseCheck = false) => {
      // Only check pause for non-scroll/resize triggers
      // Scroll/resize events ARE user activity and should always update
      if (!bypassPauseCheck && this.shouldPauseUpdates()) {
        return;
      }

      if (!rafPending) {
        rafPending = true;
        requestAnimationFrame(() => {
          onUpdate();
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
    this.chatboxObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const wasVisible = this.isChatboxVisible;
          this.isChatboxVisible = entry.isIntersecting;

          // If just became visible and was paused, trigger a render
          // Respect pause check for visibility changes (don't bypass)
          if (!wasVisible && this.isChatboxVisible && !this.shouldPauseUpdates()) {
            throttledRender(false);
          }
        });
      },
      { threshold: 0.1 } // Trigger when at least 10% visible
    );
    this.chatboxObserver.observe(chatboxContainer);

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
            if (!wasVisible && this.isImageButtonVisible && !this.shouldPauseUpdates()) {
              throttledRender(false);
            }
          });
        },
        { threshold: 0.1 } // Trigger when at least 10% visible
      );
      this.imageButtonObserver.observe(activeTab.imageButtonElement);
    } else if (activeTab.overlayPosition) {
      // For screen captures with overlay position (after page refresh),
      // consider the target always visible since it's a stored coordinate
      this.isImageButtonVisible = true;
    }

    // Set up idle detection (performance optimization)
    // Pause updates after 3 seconds of user inactivity
    const resetIdleTimer = () => {
      this.lastActivityTime = Date.now();

      // If was idle and now active, clear idle state and trigger render
      if (this.isUserIdle) {
        this.isUserIdle = false;
        if (!this.shouldPauseUpdates()) {
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

    // Trigger initial render to show compass at correct angle immediately
    throttledRender(true);
  }

  /**
   * Clean up all compass tracking listeners and observers
   */
  cleanup(): void {
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

    // Clean up Intersection Observers
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

    // Clean up idle detection
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

    // Reset angle tracking
    this.previousAngle = null;
  }
}
