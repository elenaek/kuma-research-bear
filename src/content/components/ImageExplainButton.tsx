import { h } from 'preact';
import { useRef, useEffect } from 'preact/hooks';
import { LottiePlayer, LottiePlayerHandle, LoopPurpose } from '../../shared/components/LottiePlayer.tsx';

interface ImageExplainButtonProps {
  visible: boolean;
  hasExplanation: boolean;
  isLoading: boolean;
  onClick: () => void;
}

/**
 * Docked button component for image explanations
 * Shows kuma-qanda.lottie animation and toggles explanation display
 */
export const ImageExplainButton = ({
  visible,
  hasExplanation,
  isLoading,
  onClick
}: ImageExplainButtonProps) => {
  const qandaLottieRef = useRef<LottiePlayerHandle>(null);

  // Control Q&A lottie animation based on loading state
  useEffect(() => {
    if (hasExplanation) return; // Don't control if showing thinking-glasses lottie

    if (isLoading && qandaLottieRef.current) {
      // Start looping animation when loading begins
      qandaLottieRef.current.startLooping(LoopPurpose.QASection);
    } else if (!isLoading && qandaLottieRef.current) {
      // Stop and reset to frame 1 when not loading
      qandaLottieRef.current.stop();
    }
  }, [isLoading, hasExplanation]);

  if (!visible) {
    return null;
  }

  return (
    <button
      className={`image-explain-button ${hasExplanation ? 'has-explanation' : ''} ${isLoading ? 'loading' : ''}`}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
      title={hasExplanation ? 'Toggle explanation' : 'Explain this image'}
      aria-label={hasExplanation ? 'Toggle image explanation' : 'Get AI explanation for this image'}
    >
      {hasExplanation ? (
        // Show thinking glasses bear (static, frame 1)
        <LottiePlayer
          path={chrome.runtime.getURL('lotties/kuma-thinking-glasses.lottie')}
          size={42}
          autoplay={false}
          loop={false}
        />
      ) : (
        // Show Q&A bear (controlled imperatively via ref)
        <LottiePlayer
          ref={qandaLottieRef}
          path={chrome.runtime.getURL('lotties/kuma-qanda.lottie')}
          size={48}
          autoplay={false}
          loop={false}
          loopPurpose={LoopPurpose.QASection}
        />
      )}
    </button>
  );
};
