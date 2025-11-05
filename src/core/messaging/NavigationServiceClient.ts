import { ChromeMessageClient } from './base/ChromeMessageClient.ts';
import { MessageType } from '../../shared/types/index.ts';
import { logger } from '../../shared/utils/logger.ts';

/**
 * NavigationServiceClient - Handles all navigation and UI-related operations
 *
 * Responsibilities:
 * - Sidepanel navigation and status checks
 * - Chatbox visibility control
 * - UI state management across extension components
 */
export class NavigationServiceClient extends ChromeMessageClient {
  /**
   * Check if sidepanel is currently open
   *
   * @returns Promise resolving to true if sidepanel is open, false otherwise
   */
  async isSidepanelOpen(): Promise<boolean> {
    logger.debug('NAVIGATION_CLIENT', 'Checking if sidepanel is open');

    try {
      const response = await this.sendMessage<{ isOpen?: boolean }>(MessageType.CHECK_SIDEPANEL_OPEN);

      const isOpen = response?.isOpen || false;
      logger.debug('NAVIGATION_CLIENT', 'Sidepanel open status:', isOpen);
      return isOpen;
    } catch (error) {
      logger.error('NAVIGATION_CLIENT', 'Error checking sidepanel status:', error);
      return false;
    }
  }

  /**
   * Navigate the sidepanel to a specific paper by URL
   *
   * @param url - URL of the paper to navigate to
   * @returns Promise resolving when navigation message is sent
   */
  async navigateSidepanelToPaper(url: string): Promise<void> {
    logger.debug('NAVIGATION_CLIENT', 'Navigating sidepanel to paper:', url);

    try {
      await this.sendMessage(MessageType.NAVIGATE_TO_PAPER, { url });
      logger.debug('NAVIGATION_CLIENT', '✓ Navigation message sent');
    } catch (error) {
      logger.error('NAVIGATION_CLIENT', 'Error navigating sidepanel:', error);
    }
  }

  /**
   * Toggle the chatbox visibility (content script)
   *
   * Note: This method uses chrome.tabs.sendMessage instead of chrome.runtime.sendMessage
   * because it communicates with the content script, not the background worker.
   *
   * @param tabId - Optional tab ID (defaults to active tab)
   * @returns Promise resolving when toggle message is sent
   */
  async toggleChatbox(tabId?: number): Promise<void> {
    logger.debug('NAVIGATION_CLIENT', 'Toggling chatbox');

    try {
      if (tabId) {
        await chrome.tabs.sendMessage(tabId, {
          type: MessageType.TOGGLE_CHATBOX,
        });
      } else {
        // Send to active tab
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tabs[0]?.id) {
          await chrome.tabs.sendMessage(tabs[0].id, {
            type: MessageType.TOGGLE_CHATBOX,
          });
        }
      }
      logger.debug('NAVIGATION_CLIENT', '✓ Chatbox toggle message sent');
    } catch (error) {
      logger.error('NAVIGATION_CLIENT', 'Error toggling chatbox:', error);
    }
  }

  /**
   * Get the current chatbox state (open/closed) from content script
   *
   * Note: This method uses chrome.tabs.sendMessage instead of chrome.runtime.sendMessage
   * because it communicates with the content script, not the background worker.
   *
   * @param tabId - Optional tab ID (defaults to active tab)
   * @returns Promise resolving to true if chatbox is open, false otherwise
   */
  async getChatboxState(tabId?: number): Promise<boolean> {
    logger.debug('NAVIGATION_CLIENT', 'Getting chatbox state');

    try {
      let response;
      if (tabId) {
        response = await chrome.tabs.sendMessage(tabId, {
          type: MessageType.GET_CHATBOX_STATE,
        });
      } else {
        // Send to active tab
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tabs[0]?.id) {
          response = await chrome.tabs.sendMessage(tabs[0].id, {
            type: MessageType.GET_CHATBOX_STATE,
          });
        }
      }
      logger.debug('NAVIGATION_CLIENT', '✓ Chatbox state received:', response?.isOpen);
      return response?.isOpen || false;
    } catch (error) {
      logger.error('NAVIGATION_CLIENT', 'Error getting chatbox state:', error);
      return false;
    }
  }
}
