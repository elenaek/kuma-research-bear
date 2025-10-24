import { h } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { LottiePlayer, LoopPurpose } from '../../shared/components/LottiePlayer.tsx';

interface AskKumaButtonProps {
  x: number;
  y: number;
  visible: boolean;
  onClick: () => void;
}

export const AskKumaButton = ({ x, y, visible, onClick }: AskKumaButtonProps) => {
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (visible && buttonRef.current) {
      // Ensure button doesn't go off-screen
      const button = buttonRef.current;
      const rect = button.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      // Adjust position if button would be off-screen
      if (rect.right > viewportWidth) {
        button.style.left = `${viewportWidth - rect.width - 10}px`;
      }
      if (rect.bottom > viewportHeight) {
        button.style.top = `${y - rect.height - 10}px`;
      }
    }
  }, [visible, x, y]);

  if (!visible) {
    return null;
  }

  return (
    <button
      ref={buttonRef}
      className="ask-kuma-button"
      style={{
        position: 'fixed',
        left: `${x}px`,
        top: `${y}px`,
        zIndex: 2147483646, // Below chatbox (2147483647) but above most page content
      }}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
      onMouseDown={(e) => {
        // Prevent text deselection
        e.preventDefault();
      }}
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
  );
};
