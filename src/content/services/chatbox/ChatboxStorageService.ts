import { ChatboxSettings, ChatTab, ChatMessage, ConversationState, StoredPaper } from '../../../shared/types/index.ts';
import * as ChromeService from '../../../services/chromeService.ts';
import { logger } from '../../../shared/utils/logger.ts';
import { normalizeUrl } from '../../../shared/utils/urlUtils.ts';

/**
 * ChatboxStorageService - Manages all persistence for chatbox
 *
 * Responsibilities:
 * - Load/save chatbox settings (position, tabs, visibility) to Chrome storage
 * - Load/save paper chat history via ChromeService
 * - Load/save image chat history via ChromeService
 * - Handle per-URL visibility state
 * - Ensure settings fit within storage limits
 *
 * Extracted from chatboxInjector.ts to separate storage concerns
 */
export class ChatboxStorageService {
  /**
   * Load chatbox settings from Chrome storage
   * Includes position, tabs, visibility state, and per-URL visibility tracking
   *
   * @param defaultSettings - Default settings to merge with
   * @returns Promise resolving to loaded settings
   */
  async loadSettings(defaultSettings: ChatboxSettings): Promise<ChatboxSettings> {
    try {
      const stored = await chrome.storage.local.get('chatboxSettings');

      if (stored.chatboxSettings) {
        const settings = {
          ...defaultSettings,
          ...stored.chatboxSettings,
        };

        // Load per-URL visibility state
        const currentUrl = normalizeUrl(window.location.href);
        const visibilityMap = settings.visibilityByUrl || {};
        settings.visible = visibilityMap[currentUrl] ?? false;

        // Ensure position is within viewport bounds
        settings.position.x = Math.max(0, Math.min(settings.position.x, window.innerWidth - settings.position.width));
        settings.position.y = Math.max(0, Math.min(settings.position.y, window.innerHeight - settings.position.height));

        return settings;
      }

      return defaultSettings;
    } catch (error) {
      logger.error('CONTENT_SCRIPT', '[Kuma Chat] Failed to load settings:', error);
      return defaultSettings;
    }
  }

  /**
   * Save chatbox settings to Chrome storage
   * Includes tabs, position, visibility state, and per-URL visibility tracking
   *
   * @param settings - Settings to save
   * @param tabs - Current tab state (to extract image tabs)
   * @param activeTabId - Currently active tab ID
   * @returns Promise resolving when save is complete
   */
  async saveSettings(settings: ChatboxSettings, tabs: any[], activeTabId: string): Promise<void> {
    try {
      // Convert tabs to serializable format (strip out blobs, elements, messages)
      const serializableTabs = tabs
        .filter(tab => tab.type === 'image') // Only save image tabs (paper tab is auto-created)
        .map(tab => ({
          id: tab.id,
          type: tab.type,
          title: tab.title,
          imageUrl: tab.imageUrl,
        }));

      const updatedSettings = {
        ...settings,
        activeTabs: serializableTabs as ChatTab[],
        activeTabId: activeTabId,
      };

      // Save per-URL visibility state
      const currentUrl = normalizeUrl(window.location.href);
      if (!updatedSettings.visibilityByUrl) {
        updatedSettings.visibilityByUrl = {};
      }
      updatedSettings.visibilityByUrl[currentUrl] = updatedSettings.visible;

      // Cleanup: Keep only last 100 URLs to prevent unbounded storage growth
      const MAX_URLS = 100;
      const urlEntries = Object.entries(updatedSettings.visibilityByUrl);
      if (urlEntries.length > MAX_URLS) {
        // Keep only the most recent MAX_URLS entries (FIFO)
        // Note: This simple implementation removes oldest entries when limit exceeded
        const urlsToKeep = urlEntries.slice(-MAX_URLS);
        updatedSettings.visibilityByUrl = Object.fromEntries(urlsToKeep);
      }

      await chrome.storage.local.set({ chatboxSettings: updatedSettings });
      logger.debug('CONTENT_SCRIPT', '[Kuma Chat] Settings saved successfully');
    } catch (error) {
      logger.error('CONTENT_SCRIPT', '[Kuma Chat] Failed to save settings:', error);
    }
  }

  /**
   * Load paper chat history from database
   * Updates the provided paper tab with messages and conversation state
   *
   * @param paperUrl - URL of the paper
   * @returns Promise resolving to chat history and conversation state
   */
  async loadPaperChatHistory(
    paperUrl: string
  ): Promise<{ messages: ChatMessage[]; conversationState: ConversationState; title: string }> {
    try {
      const paper = await ChromeService.getPaperFromDBByUrl(paperUrl);

      if (paper) {
        return {
          messages: paper.chatHistory || [],
          conversationState: paper.conversationState || {
            summary: null,
            recentMessages: [],
            lastSummarizedIndex: -1,
            summaryCount: 0,
          },
          title: paper.title || 'Paper Chat',
        };
      }

      return {
        messages: [],
        conversationState: {
          summary: null,
          recentMessages: [],
          lastSummarizedIndex: -1,
          summaryCount: 0,
        },
        title: 'Paper Chat',
      };
    } catch (error) {
      logger.error('CONTENT_SCRIPT', '[Kuma Chat] Failed to load paper chat history:', error);
      return {
        messages: [],
        conversationState: {
          summary: null,
          recentMessages: [],
          lastSummarizedIndex: -1,
          summaryCount: 0,
        },
        title: 'Paper Chat',
      };
    }
  }

  /**
   * Load image chat history from database
   *
   * @param paperId - ID of the paper
   * @param imageUrl - URL of the image
   * @returns Promise resolving to chat messages
   */
  async loadImageChatHistory(paperId: string, imageUrl: string): Promise<ChatMessage[]> {
    try {
      const response = await ChromeService.getImageChatHistory(paperId, imageUrl);

      if (response.success && response.chatHistory) {
        return response.chatHistory;
      }

      return [];
    } catch (error) {
      logger.error('CONTENT_SCRIPT', '[Kuma Chat] Failed to load image chat history:', error);
      return [];
    }
  }

  /**
   * Save paper chat history to database
   *
   * @param paperUrl - URL of the paper
   * @param messages - Chat messages to save
   * @returns Promise resolving when save is complete
   */
  async savePaperChatHistory(paperUrl: string, messages: ChatMessage[]): Promise<void> {
    try {
      await ChromeService.updateChatHistory(paperUrl, messages);
    } catch (error) {
      logger.error('CONTENT_SCRIPT', '[Kuma Chat] Failed to save paper chat history:', error);
    }
  }

  /**
   * Save image chat history to database
   *
   * @param paperId - ID of the paper
   * @param imageUrl - URL of the image
   * @param messages - Chat messages to save
   * @returns Promise resolving when save is complete
   */
  async saveImageChatHistory(paperId: string, imageUrl: string, messages: ChatMessage[]): Promise<void> {
    try {
      await ChromeService.updateImageChatHistory(paperId, imageUrl, messages);
    } catch (error) {
      logger.error('CONTENT_SCRIPT', '[Kuma Chat] Failed to save image chat history:', error);
    }
  }

  /**
   * Save visibility state for current URL
   *
   * @param visible - Visibility state
   * @returns Promise resolving when save is complete
   */
  async saveVisibility(visible: boolean): Promise<void> {
    try {
      const stored = await chrome.storage.local.get('chatboxSettings');
      const settings = stored.chatboxSettings || {};

      // Save per-URL visibility state
      const currentUrl = normalizeUrl(window.location.href);
      if (!settings.visibilityByUrl) {
        settings.visibilityByUrl = {};
      }
      settings.visibilityByUrl[currentUrl] = visible;
      settings.visible = visible;

      await chrome.storage.local.set({ chatboxSettings: settings });
      logger.debug('CONTENT_SCRIPT', '[Kuma Chat] Visibility saved:', visible);
    } catch (error) {
      logger.error('CONTENT_SCRIPT', '[Kuma Chat] Failed to save visibility:', error);
    }
  }

  /**
   * Save minimized state
   *
   * @param minimized - Minimized state
   * @returns Promise resolving when save is complete
   */
  async saveMinimized(minimized: boolean): Promise<void> {
    try {
      const stored = await chrome.storage.local.get('chatboxSettings');
      const settings = stored.chatboxSettings || {};
      settings.minimized = minimized;

      await chrome.storage.local.set({ chatboxSettings: settings });
      logger.debug('CONTENT_SCRIPT', '[Kuma Chat] Minimized state saved:', minimized);
    } catch (error) {
      logger.error('CONTENT_SCRIPT', '[Kuma Chat] Failed to save minimized state:', error);
    }
  }

  /**
   * Save position
   *
   * @param position - Position and size
   * @returns Promise resolving when save is complete
   */
  async savePosition(position: { x: number; y: number; width: number; height: number }): Promise<void> {
    try {
      const stored = await chrome.storage.local.get('chatboxSettings');
      const settings = stored.chatboxSettings || {};
      settings.position = position;

      await chrome.storage.local.set({ chatboxSettings: settings });
      logger.debug('CONTENT_SCRIPT', '[Kuma Chat] Position saved:', position);
    } catch (error) {
      logger.error('CONTENT_SCRIPT', '[Kuma Chat] Failed to save position:', error);
    }
  }

  /**
   * Toggle transparency setting
   *
   * @returns Promise resolving when save is complete
   */
  async toggleTransparency(): Promise<void> {
    try {
      const stored = await chrome.storage.local.get('chatboxSettings');
      const settings = stored.chatboxSettings || {};
      settings.transparencyEnabled = !settings.transparencyEnabled;

      await chrome.storage.local.set({ chatboxSettings: settings });
      logger.debug('CONTENT_SCRIPT', '[Kuma Chat] Transparency toggled:', settings.transparencyEnabled);
    } catch (error) {
      logger.error('CONTENT_SCRIPT', '[Kuma Chat] Failed to toggle transparency:', error);
    }
  }
}
