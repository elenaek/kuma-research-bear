/**
 * Simple toast notification system
 * Creates temporary notifications at the bottom-right of the screen
 */

export type ToastType = 'success' | 'error' | 'info';

interface ToastOptions {
  message: string;
  type?: ToastType;
  duration?: number; // milliseconds
}

const DEFAULT_DURATION = 3000;

/**
 * Show a toast notification
 */
export function showToast({ message, type = 'info', duration = DEFAULT_DURATION }: ToastOptions) {
  // Create toast container if it doesn't exist
  let container = document.getElementById('kuma-toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'kuma-toast-container';
    container.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      z-index: 2147483647;
      display: flex;
      flex-direction: column-reverse;
      gap: 10px;
      pointer-events: none;
    `;
    document.body.appendChild(container);
  }

  // Create toast element
  const toast = document.createElement('div');
  toast.className = 'kuma-toast';
  toast.style.cssText = `
    background: ${type === 'success' ? '#10B981' : type === 'error' ? '#EF4444' : '#3B82F6'};
    color: white;
    padding: 12px 16px;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    font-size: 14px;
    font-weight: 500;
    max-width: 320px;
    pointer-events: auto;
    animation: slideInUp 0.3s ease-out;
  `;

  // Add icon based on type
  const icon = getIconSVG(type);
  toast.innerHTML = `
    <div style="display: flex; align-items: center; gap: 8px;">
      ${icon}
      <span>${message}</span>
    </div>
  `;

  // Add animation keyframes if not already added
  if (!document.getElementById('kuma-toast-styles')) {
    const style = document.createElement('style');
    style.id = 'kuma-toast-styles';
    style.textContent = `
      @keyframes slideInUp {
        from {
          opacity: 0;
          transform: translateY(20px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }
      @keyframes slideOutDown {
        from {
          opacity: 1;
          transform: translateY(0);
        }
        to {
          opacity: 0;
          transform: translateY(20px);
        }
      }
    `;
    document.head.appendChild(style);
  }

  // Add to container
  container.appendChild(toast);

  // Remove after duration
  setTimeout(() => {
    toast.style.animation = 'slideOutDown 0.3s ease-out forwards';
    setTimeout(() => {
      container?.removeChild(toast);
      // Remove container if empty
      if (container && container.children.length === 0) {
        document.body.removeChild(container);
      }
    }, 300);
  }, duration);
}

/**
 * Get icon SVG for toast type
 */
function getIconSVG(type: ToastType): string {
  switch (type) {
    case 'success':
      return `<svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M10 0C4.48 0 0 4.48 0 10C0 15.52 4.48 20 10 20C15.52 20 20 15.52 20 10C20 4.48 15.52 0 10 0ZM8 15L3 10L4.41 8.59L8 12.17L15.59 4.58L17 6L8 15Z" fill="white"/>
      </svg>`;
    case 'error':
      return `<svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M10 0C4.48 0 0 4.48 0 10C0 15.52 4.48 20 10 20C15.52 20 20 15.52 20 10C20 4.48 15.52 0 10 0ZM11 15H9V13H11V15ZM11 11H9V5H11V11Z" fill="white"/>
      </svg>`;
    case 'info':
    default:
      return `<svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M10 0C4.48 0 0 4.48 0 10C0 15.52 4.48 20 10 20C15.52 20 20 15.52 20 10C20 4.48 15.52 0 10 0ZM11 15H9V9H11V15ZM11 7H9V5H11V7Z" fill="white"/>
      </svg>`;
  }
}

/**
 * Convenience functions
 */
export function showSuccessToast(message: string, duration?: number) {
  showToast({ message, type: 'success', duration });
}

export function showErrorToast(message: string, duration?: number) {
  showToast({ message, type: 'error', duration });
}

export function showInfoToast(message: string, duration?: number) {
  showToast({ message, type: 'info', duration });
}
