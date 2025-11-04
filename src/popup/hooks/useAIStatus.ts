import { useState, useEffect } from 'preact/hooks';
import * as ChromeService from '../../services/chromeService.ts';
import type { AIAvailability } from '../../shared/types/index.ts';
import { logger } from '../../shared/utils/logger.ts';

export type AIStatus = 'checking' | 'ready' | 'needsInit' | 'downloading' | 'error';
export type DownloadingModel = 'gemini' | 'embedding' | null;

interface UseAIStatusReturn {
  // State
  aiStatus: AIStatus;
  aiAvailability: AIAvailability;
  statusMessage: string;
  isInitializing: boolean;
  isResetting: boolean;
  isInitialLoad: boolean;
  downloadProgress: number; // 0-100 (combined progress)
  currentDownloadingModel: DownloadingModel;

  // Actions
  checkAIStatus: () => Promise<void>;
  handleInitializeAI: () => Promise<void>;
  handleResetAI: () => Promise<void>;
}

/**
 * Custom hook to manage AI status, initialization, and reset
 * Provides state and actions for AI management in the popup
 */
export function useAIStatus(): UseAIStatusReturn {
  const [aiStatus, setAiStatus] = useState<AIStatus>('checking');
  const [aiAvailability, setAiAvailability] = useState<AIAvailability>('no');
  const [statusMessage, setStatusMessage] = useState('Checking AI availability...');
  const [isInitializing, setIsInitializing] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [isInitialLoad, setIsInitialLoad] = useState(true);

  // Initialize download progress from sessionStorage cache for immediate render
  const [downloadProgress, setDownloadProgress] = useState<number>(() => {
    try {
      const cached = sessionStorage.getItem('kuma_download_progress');
      return cached ? parseFloat(cached) : 0;
    } catch {
      return 0;
    }
  });

  const [currentDownloadingModel, setCurrentDownloadingModel] = useState<DownloadingModel>(() => {
    try {
      const cached = sessionStorage.getItem('kuma_downloading_model');
      return (cached || null) as DownloadingModel;
    } catch {
      return null;
    }
  });

  // Check AI status on mount
  useEffect(() => {
    checkAIStatus();
  }, []);

  // Listen for download progress messages
  useEffect(() => {
    const handleMessage = (message: any) => {
      if (message.type === 'MODEL_DOWNLOAD_PROGRESS') {
        const { model, combinedProgress } = message.payload;
        logger.debug('UI', `[useAIStatus] Download progress: ${model} - ${combinedProgress.toFixed(1)}%`);

        setCurrentDownloadingModel(model);
        setDownloadProgress(combinedProgress);

        // Cache to sessionStorage for immediate access on next popup open
        try {
          sessionStorage.setItem('kuma_download_progress', combinedProgress.toString());
          sessionStorage.setItem('kuma_downloading_model', model || '');
        } catch (error) {
          logger.warn('UI', '[useAIStatus] Failed to cache progress in listener:', error);
        }

        // Update status to downloading if we receive progress updates
        // Use functional update to avoid dependency on aiStatus
        setAiStatus((currentStatus) =>
          currentStatus !== 'downloading' ? 'downloading' : currentStatus
        );
      }
    };

    chrome.runtime.onMessage.addListener(handleMessage);

    return () => {
      chrome.runtime.onMessage.removeListener(handleMessage);
    };
  }, []); // Empty dependency array - listener never recreated

  async function checkAIStatus() {
    try {
      const response = await ChromeService.checkAIStatus();

      const availability = response.capabilities?.availability || 'no';
      setAiAvailability(availability);

      // Initialize download progress from response (for popup reinitialization)
      if (response.downloadProgress !== undefined) {
        setDownloadProgress(response.downloadProgress);
        // Cache to sessionStorage for immediate access on next popup open
        try {
          sessionStorage.setItem('kuma_download_progress', response.downloadProgress.toString());
        } catch (error) {
          logger.warn('UI', '[useAIStatus] Failed to cache download progress:', error);
        }
      }
      if (response.currentDownloadingModel !== undefined) {
        setCurrentDownloadingModel(response.currentDownloadingModel);
        // Cache to sessionStorage for immediate access on next popup open
        try {
          sessionStorage.setItem('kuma_downloading_model', response.currentDownloadingModel || '');
        } catch (error) {
          logger.warn('UI', '[useAIStatus] Failed to cache downloading model:', error);
        }
      }

      if (availability === 'available') {
        setAiStatus('ready');
        setStatusMessage('Kuma is ready to help you with your research!');
      } else if (availability === 'downloadable') {
        setAiStatus('needsInit');
        setStatusMessage('Kuma needs to be woken up');
      } else if (availability === 'downloading') {
        setAiStatus('downloading');
        setStatusMessage('Waking Kuma up...');
      } else if (availability === 'unavailable') {
        setAiStatus('error');
        setStatusMessage('Kuma fell asleep again. (Crashed - needs reset)');
      } else {
        setAiStatus('error');
        setStatusMessage('Kuma is missing from his cave. (Not available on this device)');
      }

      // Mark initial load as complete after first status check
      setIsInitialLoad(false);
    } catch (error) {
      setAiStatus('error');
      setStatusMessage('Error checking Kuma\'s status');
      logger.error('UI', '[useAIStatus] Status check failed:', error);
      // Even on error, mark initial load as complete
      setIsInitialLoad(false);
    }
  }

  async function handleInitializeAI() {
    try {
      setIsInitializing(true);
      setStatusMessage('Preparing to wake Kuma...');

      // Trigger initialization (this blocks until complete)
      // Progress updates will come via the message listener
      const initPromise = ChromeService.initializeAI();

      // Immediately check status to catch download state
      await checkAIStatus();

      // Wait for initialization to complete
      const response = await initPromise;

      // Final status check
      await checkAIStatus();

      if (!response.success) {
        alert(`Kuma couldn't wake up. (Failed to initialize AI: ${response.error})`);
      }
    } catch (error) {
      logger.error('UI', '[useAIStatus] Initialization failed:', error);
      alert(`Kuma didn't come. (Failed to initialize AI. Please try again.)`);
      setStatusMessage('Kuma didn\'t come. (Initialization failed)');
    } finally {
      setIsInitializing(false);
    }
  }

  async function handleResetAI() {
    try {
      setIsResetting(true);
      setStatusMessage('Resetting AI...');

      const response = await ChromeService.resetAI();

      if (response.success) {
        // Re-check AI status after successful reset
        await checkAIStatus();
        alert(`✓ ${response.message}`);
      } else {
        alert(`⚠️ ${response.error}`);
        setStatusMessage(response.error || 'Reset failed');
      }
    } catch (error) {
      logger.error('UI', '[useAIStatus] AI reset failed:', error);
      alert('❌ Failed to reset AI. Please try again or restart Chrome.');
      setStatusMessage('Reset failed');
    } finally {
      setIsResetting(false);
    }
  }

  return {
    aiStatus,
    aiAvailability,
    statusMessage,
    isInitializing,
    isResetting,
    isInitialLoad,
    downloadProgress,
    currentDownloadingModel,
    checkAIStatus,
    handleInitializeAI,
    handleResetAI,
  };
}
