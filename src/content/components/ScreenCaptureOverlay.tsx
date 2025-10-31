import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';

export interface SelectionRect {
  x: number;        // Viewport X coordinate
  y: number;        // Viewport Y coordinate
  width: number;
  height: number;
  pageX: number;    // Absolute page X coordinate (includes scroll offset)
  pageY: number;    // Absolute page Y coordinate (includes scroll offset)
}

interface ScreenCaptureOverlayProps {
  visible: boolean;
  onSelectionComplete: (rect: SelectionRect) => void;
  onCancel: () => void;
}

/**
 * Screen Capture Overlay
 * Full-screen overlay for selecting a region to capture
 * User drags to create selection rectangle, then clicks to confirm or ESC to cancel
 */
export const ScreenCaptureOverlay = ({
  visible,
  onSelectionComplete,
  onCancel
}: ScreenCaptureOverlayProps) => {
  const [isDragging, setIsDragging] = useState(false);
  const [startPoint, setStartPoint] = useState<{ x: number; y: number } | null>(null);
  const [currentPoint, setCurrentPoint] = useState<{ x: number; y: number } | null>(null);
  const [selectionRect, setSelectionRect] = useState<SelectionRect | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  // Calculate selection rectangle from start and current points
  const calculateRect = (start: { x: number; y: number }, current: { x: number; y: number }): SelectionRect => {
    const x = Math.min(start.x, current.x);
    const y = Math.min(start.y, current.y);
    const width = Math.abs(current.x - start.x);
    const height = Math.abs(current.y - start.y);

    // Calculate absolute page coordinates (viewport + scroll offset)
    const pageX = x + window.scrollX;
    const pageY = y + window.scrollY;

    return { x, y, width, height, pageX, pageY };
  };

  // Handle mouse down - start selection
  const handleMouseDown = (e: MouseEvent) => {
    if (e.target !== overlayRef.current) return; // Only start on overlay background

    setIsDragging(true);
    const point = { x: e.clientX, y: e.clientY };
    setStartPoint(point);
    setCurrentPoint(point);
    setSelectionRect(null);
  };

  // Handle mouse move - update selection
  const handleMouseMove = (e: MouseEvent) => {
    if (!isDragging || !startPoint) return;

    const point = { x: e.clientX, y: e.clientY };
    setCurrentPoint(point);
  };

  // Handle mouse up - finalize selection
  const handleMouseUp = (e: MouseEvent) => {
    if (!isDragging || !startPoint || !currentPoint) return;

    setIsDragging(false);
    const rect = calculateRect(startPoint, currentPoint);

    // Minimum size requirement (20x20px)
    if (rect.width < 20 || rect.height < 20) {
      setStartPoint(null);
      setCurrentPoint(null);
      setSelectionRect(null);
      return;
    }

    setSelectionRect(rect);
  };

  // Handle click on confirmed selection - submit
  const handleSelectionClick = (e: MouseEvent) => {
    e.stopPropagation();
    if (selectionRect) {
      onSelectionComplete(selectionRect);
    }
  };

  // Handle keyboard events
  useEffect(() => {
    if (!visible) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel();
      } else if (e.key === 'Enter' && selectionRect) {
        onSelectionComplete(selectionRect);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [visible, selectionRect, onSelectionComplete, onCancel]);

  // Reset state when visibility changes
  useEffect(() => {
    if (!visible) {
      setIsDragging(false);
      setStartPoint(null);
      setCurrentPoint(null);
      setSelectionRect(null);
    }
  }, [visible]);

  if (!visible) {
    return null;
  }

  // Calculate current selection rect for rendering
  const currentRect = selectionRect ||
    (isDragging && startPoint && currentPoint ? calculateRect(startPoint, currentPoint) : null);

  return (
    <div
      ref={overlayRef}
      className="screen-capture-overlay"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        zIndex: 2147483646, // Above PDF button, below chatbox
        cursor: isDragging ? 'crosshair' : 'default',
      }}
    >
      {/* Instructions */}
      <div
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          background: 'rgba(0, 0, 0, 0.65)',
          color: 'white',
          padding: '20px 32px',
          borderRadius: '12px',
          fontSize: '16px',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          textAlign: 'center',
          pointerEvents: 'none',
          display: currentRect ? 'none' : 'block',
        }}
      >
        <div style={{ fontSize: '18px', fontWeight: '600', marginBottom: '8px' }}>
          Capture Image Area
        </div>
        <div style={{ opacity: 0.9 }}>
          Click and drag to select an area
        </div>
        <div style={{ opacity: 0.7, fontSize: '14px', marginTop: '12px' }}>
          Press ESC to cancel
        </div>
      </div>

      {/* Selection rectangle */}
      {currentRect && (
        <div
          onClick={selectionRect ? handleSelectionClick : undefined}
          style={{
            position: 'absolute',
            left: `${currentRect.x}px`,
            top: `${currentRect.y}px`,
            width: `${currentRect.width}px`,
            height: `${currentRect.height}px`,
            border: '2px dashed oklch(37.9% 0.146 265.522)',
            background: 'transparent', // Selected area is completely clear - no tint
            cursor: selectionRect ? 'pointer' : 'crosshair',
            boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.3)',
          }}
        >
          {/* Dimensions tooltip */}
          <div
            style={{
              position: 'absolute',
              top: '-30px',
              left: '0',
              background: 'rgba(0, 0, 0, 0.85)',
              color: 'white',
              padding: '4px 8px',
              borderRadius: '4px',
              fontSize: '12px',
              fontFamily: 'monospace',
              whiteSpace: 'nowrap',
              pointerEvents: 'none',
            }}
          >
            {currentRect.width} × {currentRect.height}
          </div>

          {/* Confirm hint (only show when selection is finalized) */}
          {selectionRect && (
            <div
              style={{
                position: 'absolute',
                bottom: '-40px',
                left: '50%',
                transform: 'translateX(-50%)',
                background: 'oklch(37.9% 0.146 265.522)',
                color: 'white',
                padding: '8px 16px',
                borderRadius: '6px',
                fontSize: '14px',
                fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                whiteSpace: 'nowrap',
                pointerEvents: 'none',
                boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)',
              }}
            >
              Click to capture • Press ESC to cancel
            </div>
          )}
        </div>
      )}
    </div>
  );
};
