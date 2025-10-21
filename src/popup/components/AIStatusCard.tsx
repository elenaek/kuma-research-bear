import { Loader, PawPrint, RefreshCw } from 'lucide-preact';
import type { AIStatus } from '../hooks/useAIStatus.ts';
import type { AIAvailability } from '../../types/index.ts';

interface AIStatusCardProps {
  aiStatus: AIStatus;
  aiAvailability: AIAvailability;
  statusMessage: string;
  isInitializing: boolean;
  isResetting: boolean;
  isDetecting: boolean;
  isExplaining: boolean;
  isAnalyzing: boolean;
  isGeneratingGlossary: boolean;
  isChunking: boolean;
  detectionStatus: string | null;
  onInitialize: () => void;
  onReset: () => void;
}

/**
 * AI Status Card component
 * Displays AI availability status and provides controls for initialization and reset
 */
export function AIStatusCard({
  aiStatus,
  aiAvailability,
  statusMessage,
  isInitializing,
  isResetting,
  isDetecting,
  isExplaining,
  isAnalyzing,
  isGeneratingGlossary,
  isChunking,
  detectionStatus,
  onInitialize,
  onReset,
}: AIStatusCardProps) {
  // Determine status dot style
  const getStatusDotClass = () => {
    if (aiStatus === 'ready' && (isDetecting || isExplaining || isAnalyzing || isChunking)) {
      return 'kuma-working';
    }
    if (aiStatus === 'ready') {
      return 'ready';
    }
    if (aiStatus === 'error') {
      return 'error';
    }
    return 'kuma-working';
  };

  // Determine status message
  const getDisplayMessage = () => {
    if (aiStatus === 'ready' && detectionStatus && (isDetecting || isExplaining || isAnalyzing || isGeneratingGlossary || isChunking)) {
      return detectionStatus;
    }
    if (aiStatus === 'ready') {
      return 'Kuma is ready to help you with your research!';
    }
    if (aiStatus === 'error') {
      return 'Kuma is full asleep again. (AI Model Crashed)';
    }
    return statusMessage;
  };

  return (
    <div class="card mb-4">
      <div class="flex items-center gap-3">
        <span class={`status-dot rounded-full ${getStatusDotClass()}`} />
        <span class="text-sm text-gray-700">{getDisplayMessage()}</span>
      </div>

      {/* Initialize AI Button */}
      {aiStatus === 'needsInit' && (
        <button
          onClick={onInitialize}
          disabled={isInitializing}
          class="btn btn-primary w-full mt-3 hover:cursor-pointer"
        >
          {isInitializing ? (
            <>
              <Loader size={16} class="animate-spin" />
              Kuma is waking up...
            </>
          ) : (
            <>
              <PawPrint size={16} />
              Wake Kuma up
            </>
          )}
        </button>
      )}

      {/* Downloading Status */}
      {aiStatus === 'downloading' && (
        <div class="mt-3 flex items-center gap-2 text-sm text-gray-600">
          <Loader size={16} class="animate-spin" />
          <span>Please wait while Kuma wakes up (AI model downloads)...</span>
        </div>
      )}

      {/* Error/Crashed Status */}
      {aiStatus === 'error' && aiAvailability === 'unavailable' && (
        <div class="mt-3 p-3 bg-yellow-50 border border-yellow-200 rounded text-xs">
          <p class="font-semibold text-yellow-800 mb-2">Kuma full asleep again. (AI Model Crashed)</p>

          {/* Try Reset First */}
          <button
            onClick={onReset}
            disabled={isResetting}
            class="btn btn-primary w-full mb-3 text-xs hover:cursor-pointer"
          >
            {isResetting ? (
              <>
                <Loader size={14} class="animate-spin" />
                Kuma is waking up...
              </>
            ) : (
              <>
                <RefreshCw size={14} />
                Try to wake Kuma up (Restart Extension)
              </>
            )}
          </button>

          <p class="text-yellow-700 mb-2">If reset doesn't work, manually fix:</p>
          <ol class="list-decimal ml-4 text-yellow-700 space-y-1">
            <li>Open: <code class="bg-yellow-100 px-1">chrome://flags/#optimization-guide-on-device-model</code></li>
            <li>Set to "Enabled BypassPerfRequirement"</li>
            <li>Restart Chrome completely</li>
            <li>Reload this extension</li>
          </ol>
          <p class="mt-2 text-yellow-600">Note: Kuma still works using basic detection (arXiv, PubMed, etc.)</p>
        </div>
      )}
    </div>
  );
}
