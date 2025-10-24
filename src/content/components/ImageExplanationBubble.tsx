import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import { MarkdownRenderer } from '../../components/MarkdownRenderer.tsx';

interface BubblePosition {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ImageExplanationBubbleProps {
  title: string;
  explanation: string;
  visible: boolean;
  initialPosition: BubblePosition;
  transparencyEnabled: boolean;
  hasInteractedSinceOpen: boolean;
  isLoading: boolean;
  buttonPosition: { x: number; y: number };
  onClose?: () => void;
  onToggleTransparency: () => void;
  onFirstInteraction: () => void;
  onRegenerate: () => void;
  onPositionChange?: (position: BubblePosition) => void;
}

/**
 * Draggable and resizable bubble component to display image explanations
 * Position and size reset when toggled off/on (not persisted)
 */
export const ImageExplanationBubble = ({
  title,
  explanation,
  visible,
  initialPosition,
  transparencyEnabled,
  hasInteractedSinceOpen,
  isLoading,
  buttonPosition,
  onClose,
  onToggleTransparency,
  onFirstInteraction,
  onRegenerate,
  onPositionChange
}: ImageExplanationBubbleProps) => {
  const [position, setPosition] = useState<BubblePosition>(initialPosition);
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [resizeDirection, setResizeDirection] = useState<string | null>(null);
  const [isHovered, setIsHovered] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [arrowAngle, setArrowAngle] = useState(0);
  const prevVisibleRef = useRef(visible);
  const arrowRef = useRef<SVGSVGElement>(null);

  // Reset position only when bubble transitions from hidden to visible
  useEffect(() => {
    if (visible && !prevVisibleRef.current) {
      setPosition(initialPosition);
    }
    prevVisibleRef.current = visible;
  }, [visible]);

  // Calculate compass arrow angle to point at button from actual arrow position
  useEffect(() => {
    if (!arrowRef.current) return;

    // Get actual arrow element's position in viewport
    const arrowRect = arrowRef.current.getBoundingClientRect();
    const arrowCenterX = arrowRect.left + arrowRect.width / 2;
    const arrowCenterY = arrowRect.top + arrowRect.height / 2;

    // Calculate angle from arrow center to button center
    const deltaX = buttonPosition.x - arrowCenterX;
    const deltaY = buttonPosition.y - arrowCenterY;
    const angle = Math.atan2(deltaY, deltaX) * (180 / Math.PI);

    setArrowAngle(angle);
  }, [position.x, position.y, position.width, position.height, buttonPosition.x, buttonPosition.y]);

  // Handle drag start
  const handleDragStart = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('.bubble-close')) {
      return; // Don't drag when clicking close button
    }
    setIsDragging(true);
    setDragOffset({
      x: e.clientX - position.x,
      y: e.clientY - position.y,
    });
    e.preventDefault();
  };

  // Handle resize start
  const handleResizeStart = (e: MouseEvent, direction: string) => {
    setIsResizing(true);
    setResizeDirection(direction);
    e.preventDefault();
    e.stopPropagation();
  };

  // Handle mouse move for dragging and resizing
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        const newX = e.clientX - dragOffset.x;
        const newY = e.clientY - dragOffset.y;

        // Keep bubble within viewport bounds
        const maxX = window.innerWidth - position.width;
        const maxY = window.innerHeight - position.height;

        setPosition({
          ...position,
          x: Math.max(0, Math.min(newX, maxX)),
          y: Math.max(0, Math.min(newY, maxY)),
        });
      } else if (isResizing && resizeDirection) {
        const newPosition = { ...position };

        if (resizeDirection.includes('e')) {
          newPosition.width = Math.max(200, e.clientX - position.x);
        }
        if (resizeDirection.includes('s')) {
          newPosition.height = Math.max(150, e.clientY - position.y);
        }
        if (resizeDirection.includes('w')) {
          const newWidth = Math.max(200, position.width + (position.x - e.clientX));
          newPosition.x = position.x + position.width - newWidth;
          newPosition.width = newWidth;
        }
        if (resizeDirection.includes('n')) {
          const newHeight = Math.max(150, position.height + (position.y - e.clientY));
          newPosition.y = position.y + position.height - newHeight;
          newPosition.height = newHeight;
        }

        setPosition(newPosition);
      }
    };

    const handleMouseUp = () => {
      if (isDragging || isResizing) {
        onPositionChange?.(position);
      }
      setIsDragging(false);
      setIsResizing(false);
      setResizeDirection(null);
    };

    if (isDragging || isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);

      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, isResizing, dragOffset, position, resizeDirection]);

  if (!visible) {
    return null;
  }

  return (
    <div
      className={`image-explanation-bubble animate-fade-in ${visible ? 'visible' : ''}`}
      onClick={() => !hasInteractedSinceOpen && onFirstInteraction()}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
      style={{
        position: 'fixed',
        left: `${position.x}px`,
        top: `${position.y}px`,
        width: `${position.width}px`,
        height: `${position.height}px`,
        opacity: (transparencyEnabled && hasInteractedSinceOpen)
          ? ((isHovered || isFocused || isResizing || isDragging) ? 1 : 0.3)
          : 1,
        transition: 'opacity 0.2s ease-in-out',
      }}
    >
      {/* Resize handles */}
      <div className="resize-handle resize-n" onMouseDown={(e) => handleResizeStart(e as any, 'n')} />
      <div className="resize-handle resize-s" onMouseDown={(e) => handleResizeStart(e as any, 's')} />
      <div className="resize-handle resize-e" onMouseDown={(e) => handleResizeStart(e as any, 'e')} />
      <div className="resize-handle resize-w" onMouseDown={(e) => handleResizeStart(e as any, 'w')} />
      <div className="resize-handle resize-ne" onMouseDown={(e) => handleResizeStart(e as any, 'ne')} />
      <div className="resize-handle resize-nw" onMouseDown={(e) => handleResizeStart(e as any, 'nw')} />
      <div className="resize-handle resize-se" onMouseDown={(e) => handleResizeStart(e as any, 'se')} />
      <div className="resize-handle resize-sw" onMouseDown={(e) => handleResizeStart(e as any, 'sw')} />

      {/* Header bar (draggable) */}
      <div
        className="bubble-header"
        onMouseDown={handleDragStart}
      >
        <div className="bubble-title">
          {/* Compass arrow pointing to source image button */}
          <svg
            ref={arrowRef}
            className="compass-arrow"
            width="20"
            height="20"
            viewBox="0 0 20 20"
            fill="currentColor"
            style={{
              transform: `rotate(${arrowAngle}deg)`,
            }}
          >
            {/* Navigation arrow - GPS/map style pointer with very deep center indent */}
            <path
              d="M 17 10 L 5 3 L 11 10 L 5 17 Z"
              fill="currentColor"
            />
          </svg>
          {title}
        </div>
        <div className="bubble-controls">
          <button
            className="bubble-control-btn"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onRegenerate();
            }}
            disabled={isLoading}
            title={isLoading ? "Regenerating..." : "Regenerate explanation"}
            aria-label="Regenerate explanation"
          >
            <svg className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
          <button
            className="bubble-control-btn"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onToggleTransparency();
            }}
            title={transparencyEnabled ? "Disable auto-transparency" : "Enable auto-transparency"}
            aria-label={transparencyEnabled ? "Disable auto-transparency" : "Enable auto-transparency"}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {transparencyEnabled ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
              )}
            </svg>
          </button>
          {onClose && (
            <button
              className="bubble-close"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onClose();
              }}
              aria-label="Close explanation"
              title="Close explanation"
            >
              ×
            </button>
          )}
        </div>
      </div>

      {/* Content area */}
      <div className="bubble-content">
        <div className="bubble-text">
          <MarkdownRenderer content={explanation} />
        </div>
      </div>
    </div>
  );
};
