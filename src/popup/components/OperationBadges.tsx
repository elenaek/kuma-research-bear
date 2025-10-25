import { CheckCircle, Clock, Loader, AlertCircle } from 'lucide-preact';

interface OperationBadgesProps {
  isDetecting: boolean;
  isChunking: boolean;
  hasDetected: boolean;
  hasChunked: boolean;
  currentChunk: number;
  totalChunks: number;
  detectionFailed?: boolean;  // NEW: Indicates detection failure
}

interface OperationBadgeProps {
  name: string;
  completed: boolean;
  active?: boolean;
  failed?: boolean;  // NEW: Indicates operation failure
}

function OperationBadge({ name, completed, active, failed }: OperationBadgeProps) {
  const getBadgeStyle = () => {
    if (failed) return 'bg-amber-50 text-amber-700 border border-amber-200';
    if (completed) return 'bg-green-50 text-green-700 border border-green-200';
    if (active) return 'bg-yellow-50 text-yellow-700 border border-yellow-200';
    return 'bg-gray-50 text-gray-500 border border-gray-200';
  };

  const getIcon = () => {
    if (failed) return <AlertCircle size={12} class="text-amber-600" />;
    if (completed) return <CheckCircle size={12} class="text-green-600" />;
    if (active) return <Loader size={12} class="text-yellow-600 animate-spin" />;
    return <Clock size={12} class="text-gray-400" />;
  };

  return (
    <div class={`flex items-center gap-1 px-2 py-1 rounded text-xs ${getBadgeStyle()}`}>
      {getIcon()}
      <span class="font-medium">{name}</span>
    </div>
  );
}

/**
 * Operation Badges component
 * Displays status for detection and chunking operations
 */
export function OperationBadges({
  isDetecting,
  isChunking,
  hasDetected,
  hasChunked,
  currentChunk,
  totalChunks,
  detectionFailed = false,
}: OperationBadgesProps) {
  // Determine chunking badge name with progress
  const getChunkingBadgeName = () => {
    if (isChunking && totalChunks > 0) {
      return `Chunking (${currentChunk}/${totalChunks})`;
    }
    return "Chunking";
  };

  return (
    <div class="grid grid-cols-2 gap-2 mt-3">
      <OperationBadge
        name="Detection"
        completed={hasDetected && !detectionFailed}
        active={isDetecting}
        failed={detectionFailed}
      />
      <OperationBadge
        name={getChunkingBadgeName()}
        completed={hasChunked}
        active={isChunking}
      />
    </div>
  );
}