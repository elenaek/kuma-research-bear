import { useState, useEffect, useRef } from 'preact/hooks';
import { ChatboxPosition } from '../../shared/types/index.ts';

interface UseDragResizeOptions {
  initialPosition: ChatboxPosition;
  onPositionChange: (position: ChatboxPosition, shouldSave?: boolean) => void;
  chatboxRef: { current: HTMLDivElement | null };
}

interface UseDragResizeReturn {
  position: ChatboxPosition;
  isDragging: boolean;
  isResizing: boolean;
  resizeDirection: string | null;
  handleDragStart: (e: MouseEvent) => void;
  handleTabMouseDown: (e: MouseEvent) => void;
  handleTabMouseUp: () => void;
  handleResizeStart: (e: MouseEvent, direction: string) => void;
}

/**
 * Custom hook for handling chatbox dragging and resizing
 *
 * Features:
 * - Drag chatbox by header/tab bar (with viewport bounds)
 * - Long-press drag support for tabs (500ms delay)
 * - Resize from 8 directions (n, s, e, w, ne, nw, se, sw)
 * - Real-time position updates during drag/resize
 * - Save position to storage on mouseup
 */
export function useDragResize({
  initialPosition,
  onPositionChange,
  chatboxRef,
}: UseDragResizeOptions): UseDragResizeReturn {
  const [position, setPosition] = useState(initialPosition);
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [resizeDirection, setResizeDirection] = useState<string | null>(null);
  const [dragTimer, setDragTimer] = useState<number | null>(null);
  const [dragStartPos, setDragStartPos] = useState<{ x: number; y: number } | null>(null);

  // Handle mouse down on header or tab bar for dragging
  const handleDragStart = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('.chatbox-controls')) {
      return; // Don't drag when clicking controls
    }
    setIsDragging(true);
    setDragOffset({
      x: e.clientX - position.x,
      y: e.clientY - position.y,
    });
    e.preventDefault();
  };

  // Handle long press on tab to initiate drag
  const handleTabMouseDown = (e: MouseEvent) => {
    e.stopPropagation(); // Prevent immediate drag from parent

    const startX = e.clientX;
    const startY = e.clientY;
    setDragStartPos({ x: startX, y: startY });

    // Start timer for long press (500ms)
    const timer = window.setTimeout(() => {
      // Start dragging after delay
      setIsDragging(true);
      setDragOffset({
        x: e.clientX - position.x,
        y: e.clientY - position.y,
      });
      setDragTimer(null);
    }, 500);

    setDragTimer(timer);
  };

  // Clean up timer on mouse up or mouse leave
  const handleTabMouseUp = () => {
    if (dragTimer) {
      clearTimeout(dragTimer);
      setDragTimer(null);
    }
    setDragStartPos(null);
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

        // Keep chatbox within viewport bounds
        // Use actual rendered dimensions (handles minimized vs expanded state)
        const actualWidth = chatboxRef.current?.getBoundingClientRect().width ?? position.width;
        const actualHeight = chatboxRef.current?.getBoundingClientRect().height ?? position.height;
        const maxX = window.innerWidth - actualWidth;
        const maxY = window.innerHeight - actualHeight;

        const newPosition = {
          ...position,
          x: Math.max(0, Math.min(newX, maxX)),
          y: Math.max(0, Math.min(newY, maxY)),
        };

        setPosition(newPosition);
        // Update compass in real-time during drag without saving to storage
        onPositionChange(newPosition, false);
      } else if (isResizing && resizeDirection) {
        const newPosition = { ...position };

        if (resizeDirection.includes('e')) {
          newPosition.width = Math.max(300, e.clientX - position.x);
        }
        if (resizeDirection.includes('s')) {
          newPosition.height = Math.max(400, e.clientY - position.y);
        }
        if (resizeDirection.includes('w')) {
          const newWidth = Math.max(300, position.width + (position.x - e.clientX));
          newPosition.x = position.x + position.width - newWidth;
          newPosition.width = newWidth;
        }
        if (resizeDirection.includes('n')) {
          const newHeight = Math.max(400, position.height + (position.y - e.clientY));
          newPosition.y = position.y + position.height - newHeight;
          newPosition.height = newHeight;
        }

        setPosition(newPosition);
        // Update compass in real-time during resize without saving to storage
        onPositionChange(newPosition, false);
      }
    };

    const handleMouseUp = () => {
      if (isDragging || isResizing) {
        // Save final position to storage on mouseup
        onPositionChange(position, true);
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

  // Clean up drag timer on unmount
  useEffect(() => {
    return () => {
      if (dragTimer) {
        clearTimeout(dragTimer);
      }
    };
  }, [dragTimer]);

  return {
    position,
    isDragging,
    isResizing,
    resizeDirection,
    handleDragStart,
    handleTabMouseDown,
    handleTabMouseUp,
    handleResizeStart,
  };
}
