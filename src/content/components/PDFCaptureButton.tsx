import { h } from 'preact';
import { useRef, useEffect } from 'preact/hooks';
import { LoopPurpose } from '../../shared/components/LottiePlayer.tsx';

interface PDFCaptureButtonProps {
  visible: boolean;
  isCapturing: boolean;
  onClick: () => void;
}

/**
 * PDF Screen Capture Button
 * Floating button that appears on PDF pages to initiate screen capture for image explanation
 */
export const PDFCaptureButton = ({ visible, isCapturing, onClick }: PDFCaptureButtonProps) => {
  const lottieRef = useRef<any>(null);

  // Control lottie animation based on capturing state
  useEffect(() => {
    if (isCapturing && lottieRef.current) {
      lottieRef.current.startLooping(LoopPurpose.QASection);
    } else if (!isCapturing && lottieRef.current) {
      lottieRef.current.stop();
    }
  }, [isCapturing]);

  if (!visible) {
    return null;
  }

  return (
    <button
      className={`pdf-capture-button ${isCapturing ? 'capturing' : ''}`}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
      title="Capture & explain image from PDF"
      aria-label="Capture & explain image from PDF"
    >
      <img src={chrome.runtime.getURL('icons/icon48.png')} alt="Kuma" width={32} height={32} />
      {isCapturing && (
        <span className="capture-hint">Click and drag to select area</span>
      )}
    </button>
  );
};
