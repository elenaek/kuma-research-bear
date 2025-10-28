import { h } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { LottiePlayer, LoopPurpose } from '../../shared/components/LottiePlayer.tsx';

interface SelectionToolbarProps {
  x: number;
  y: number;
  visible: boolean;
  onAskKuma: () => void;
  onAddCitation: () => void;
}

export const SelectionToolbar = ({ x, y, visible, onAskKuma, onAddCitation }: SelectionToolbarProps) => {
  const toolbarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (visible && toolbarRef.current) {
      // Ensure toolbar doesn't go off-screen
      const toolbar = toolbarRef.current;
      const rect = toolbar.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      // Adjust position if toolbar would be off-screen
      if (rect.right > viewportWidth) {
        toolbar.style.left = `${viewportWidth - rect.width - 10}px`;
      }
      if (rect.bottom > viewportHeight) {
        toolbar.style.top = `${y - rect.height - 10}px`;
      }
      if (rect.left < 0) {
        toolbar.style.left = '10px';
      }
    }
  }, [visible, x, y]);

  if (!visible) {
    return null;
  }

  return (
    <div
      ref={toolbarRef}
      className="selection-toolbar"
      style={{
        position: 'fixed',
        left: `${x}px`,
        top: `${y}px`,
        zIndex: 2147483646, // Below chatbox (2147483647) but above most page content
      }}
    >
      <button
        className="toolbar-button ask-kuma-btn"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onAskKuma();
        }}
        onMouseDown={(e) => {
          // Prevent text deselection
          e.preventDefault();
        }}
        title="Ask Kuma about this selection"
      >
        <LottiePlayer
          path={chrome.runtime.getURL('lotties/kuma-qanda.lottie')}
          size={32}
          autoplay={true}
          loop={true}
          loopPurpose={LoopPurpose.QASection}
          autoStartLoop={true}
        />
        <span>Ask Kuma</span>
      </button>

      <div className="toolbar-divider" />

      <button
        className="toolbar-button add-citation-btn"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onAddCitation();
        }}
        onMouseDown={(e) => {
          // Prevent text deselection
          e.preventDefault();
        }}
        title="Add citation for this selection"
      >
        <svg width="32" height="32" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path
            d="M7 4.5C7 4.22386 7.22386 4 7.5 4H12.5C12.7761 4 13 4.22386 13 4.5C13 4.77614 12.7761 5 12.5 5H7.5C7.22386 5 7 4.77614 7 4.5Z"
            fill="currentColor"
          />
          <path
            d="M6 7.5C6 7.22386 6.22386 7 6.5 7H13.5C13.7761 7 14 7.22386 14 7.5C14 7.77614 13.7761 8 13.5 8H6.5C6.22386 8 6 7.77614 6 7.5Z"
            fill="currentColor"
          />
          <path
            d="M6.5 10C6.22386 10 6 10.2239 6 10.5C6 10.7761 6.22386 11 6.5 11H10.5C10.7761 11 11 10.7761 11 10.5C11 10.2239 10.7761 10 10.5 10H6.5Z"
            fill="currentColor"
          />
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M4 2C2.89543 2 2 2.89543 2 4V16C2 17.1046 2.89543 18 4 18H16C17.1046 18 18 17.1046 18 16V4C18 2.89543 17.1046 2 16 2H4ZM16 3H4C3.44772 3 3 3.44772 3 4V16C3 16.5523 3.44772 17 4 17H16C16.5523 17 17 16.5523 17 16V4C17 3.44772 16.5523 3 16 3Z"
            fill="currentColor"
          />
          <path
            d="M15 12C15 11.4477 14.5523 11 14 11C13.4477 11 13 11.4477 13 12V13H12C11.4477 13 11 13.4477 11 14C11 14.5523 11.4477 15 12 15H13V16C13 16.5523 13.4477 17 14 17C14.5523 17 15 16.5523 15 16V15H16C16.5523 15 17 14.5523 17 14C17 13.4477 16.5523 13 16 13H15V12Z"
            fill="currentColor"
          />
        </svg>
        <span>Add Citation</span>
      </button>
    </div>
  );
};
