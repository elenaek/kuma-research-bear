import { useState, useEffect } from 'preact/hooks';
import * as ChromeService from '../../services/ChromeService.ts';
import type { AIAvailability } from '../../types/index.ts';

export type AIStatus = 'checking' | 'ready' | 'needsInit' | 'downloading' | 'error';

interface UseAIStatusReturn {
  // State
  aiStatus: AIStatus;
  aiAvailability: AIAvailability;
  statusMessage: string;
  isInitializing: boolean;
  isResetting: boolean;

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
  const [pollInterval, setPollInterval] = useState<number | null>(null);

  // Check AI status on mount
  useEffect(() => {
    checkAIStatus();
  }, []);

  // Continuous polling when in downloading state
  useEffect(() => {
    // Start polling if we're in downloading state and not already polling
    if (aiStatus === 'downloading' && !pollInterval) {
      console.log('[useAIStatus] Starting download progress polling...');
      const interval = window.setInterval(async () => {
        await checkAIStatus();
      }, 2000); // Poll every 2 seconds

      setPollInterval(interval);
    }

    // Stop polling if no longer downloading
    if (aiStatus !== 'downloading' && pollInterval) {
      console.log('[useAIStatus] Stopping download progress polling');
      clearInterval(pollInterval);
      setPollInterval(null);
    }

    // Cleanup on unmount
    return () => {
      if (pollInterval) {
        clearInterval(pollInterval);
      }
    };
  }, [aiStatus, pollInterval]);

  async function checkAIStatus() {
    try {
      const response = await ChromeService.checkAIStatus();

      const availability = response.capabilities?.availability || 'no';
      setAiAvailability(availability);

      if (availability === 'available') {
        setAiStatus('ready');
        setStatusMessage('Kuma is ready to help you with your research!');
      } else if (availability === 'downloadable') {
        setAiStatus('needsInit');
        setStatusMessage('Kuma needs to be woken up');
      } else if (availability === 'downloading') {
        setAiStatus('downloading');
        setStatusMessage('Kuma loading in...');
      } else if (availability === 'unavailable') {
        setAiStatus('error');
        setStatusMessage('Kuma fell asleep again. (Crashed - needs reset)');
      } else {
        setAiStatus('error');
        setStatusMessage('Kuma is missing from his cave. (Not available on this device)');
      }
    } catch (error) {
      setAiStatus('error');
      setStatusMessage('Error checking Kuma\'s status');
      console.error('[useAIStatus] Status check failed:', error);
    }
  }

  async function handleInitializeAI() {
    let localPollInterval: number | null = null;

    try {
      setIsInitializing(true);
      setStatusMessage('Preparing to wake Kuma...');

      // Start aggressive polling during initialization to detect download state
      console.log('[useAIStatus] Starting aggressive polling during initialization');
      localPollInterval = window.setInterval(async () => {
        await checkAIStatus();
      }, 1000); // Poll every 1 second during active initialization

      // Trigger initialization (this blocks until complete)
      const response = await ChromeService.initializeAI();

      // Clear local polling (global polling will continue if still downloading)
      if (localPollInterval) {
        clearInterval(localPollInterval);
        localPollInterval = null;
      }

      // Final status check
      await checkAIStatus();

      if (response.success) {
        alert('Kuma is here! You can now use all features.');
      } else {
        alert(`Kuma didn't come. (Failed to initialize AI: ${response.error})`);
      }
    } catch (error) {
      console.error('[useAIStatus] Initialization failed:', error);
      alert(`Kuma didn't come. (Failed to initialize AI. Please try again.)`);
      setStatusMessage('Kuma didn\'t come. (Initialization failed)');
    } finally {
      if (localPollInterval) {
        clearInterval(localPollInterval);
      }
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
      console.error('[useAIStatus] AI reset failed:', error);
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
    checkAIStatus,
    handleInitializeAI,
    handleResetAI,
  };
}
