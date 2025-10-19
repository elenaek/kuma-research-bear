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

  // Check AI status on mount
  useEffect(() => {
    checkAIStatus();
  }, []);

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
    try {
      setIsInitializing(true);
      setStatusMessage('Kuma is waking up...');

      const response = await ChromeService.initializeAI();

      if (response.success) {
        setAiStatus('ready');
        setStatusMessage('Kuma is ready to help you with your research!');
        alert('Kuma is here! You can now use all features.');
      } else {
        alert(`Kuma didn't come. (Failed to initialize AI: ${response.error})`);
        setStatusMessage(response.error || 'Initialization failed');
      }
    } catch (error) {
      console.error('[useAIStatus] Initialization failed:', error);
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
