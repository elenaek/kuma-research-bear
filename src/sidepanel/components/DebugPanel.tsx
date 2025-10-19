interface DebugPanelProps {
  show: boolean;
  debugInfo: any;
  onRefresh: () => void;
  onClearStorage: () => void;
}

/**
 * Debug Panel Component
 * Displays debug information for troubleshooting storage and state issues
 */
export function DebugPanel(props: DebugPanelProps) {
  const { show, debugInfo, onRefresh, onClearStorage } = props;

  if (!show || !debugInfo) {
    return null;
  }

  return (
    <div class="card mb-6 bg-gray-900 text-gray-100 font-mono text-xs">
      <div class="flex items-center justify-between mb-3">
        <h3 class="text-sm font-bold text-yellow-400">🔍 Debug Information</h3>
        <div class="flex gap-2">
          <button
            onClick={onRefresh}
            class="text-xs px-2 py-1 bg-yellow-500 text-gray-900 rounded hover:bg-yellow-400"
          >
            Refresh
          </button>
          <button
            onClick={onClearStorage}
            class="text-xs px-2 py-1 bg-red-500 text-white rounded hover:bg-red-600"
            title="Clear all Chrome storage (useful for removing ghost papers)"
          >
            Clear All Storage
          </button>
        </div>
      </div>

      <div class="space-y-3">
        <div>
          <p class="text-blue-400 font-semibold mb-1">Chrome Storage:</p>
          <pre class="text-xs bg-gray-800 p-2 rounded overflow-x-auto">
            {JSON.stringify(debugInfo.chromeStorage, null, 2)}
          </pre>
        </div>

        <div>
          <p class="text-green-400 font-semibold mb-1">Sidepanel State:</p>
          <pre class="text-xs bg-gray-800 p-2 rounded overflow-x-auto">
            {JSON.stringify(debugInfo.sidepanelState, null, 2)}
          </pre>
        </div>

        {debugInfo.indexedDB && (
          <div>
            <p class="text-purple-400 font-semibold mb-1">IndexedDB Query:</p>
            <pre class="text-xs bg-gray-800 p-2 rounded overflow-x-auto">
              {JSON.stringify(debugInfo.indexedDB, null, 2)}
            </pre>
          </div>
        )}

        <div class="pt-2 border-t border-gray-700">
          <p class="text-red-400 font-semibold mb-1">Diagnosis:</p>
          {!debugInfo.chromeStorage.hasCurrentPaper && (
            <p class="text-red-300">❌ No currentPaper in chrome.storage</p>
          )}
          {debugInfo.chromeStorage.hasCurrentPaper && !debugInfo.indexedDB?.found && (
            <p class="text-red-300">❌ Paper URL in storage but NOT found in IndexedDB</p>
          )}
          {debugInfo.chromeStorage.hasCurrentPaper && debugInfo.indexedDB?.found && !debugInfo.sidepanelState.hasStoredPaper && (
            <p class="text-red-300">❌ Paper in IndexedDB but storedPaper state is null</p>
          )}
          {debugInfo.sidepanelState.hasStoredPaper && (
            <p class="text-green-300">✅ Paper is properly loaded</p>
          )}
        </div>
      </div>
    </div>
  );
}
