import { useEffect, useRef } from 'preact/hooks';
import { DotLottie } from '@lottiefiles/dotlottie-web';

interface LottieLoaderProps {
  path: string;
  size?: number; // Size in pixels (creates square)
  className?: string;
}

/**
 * Simple Lottie Animation Loader
 * Auto-plays and loops continuously - perfect for loading states
 */
export function LottieLoader({ path, size = 64, className = '' }: LottieLoaderProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current) return;

    const animation = new DotLottie({
      canvas: canvasRef.current,
      src: path,
      autoplay: false,
      loop: true,
    });

    // Wait for animation to load, then set segment to first 50%
    animation.addEventListener('load', () => {
      const totalFrames = animation.totalFrames;
      const midpoint = Math.floor(totalFrames / 2);

      // Set segment to loop only first 50%
      animation.setSegment(0, midpoint);
      animation.play();
    });

    return () => animation.destroy();
  }, [path]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ width: `${size}px`, height: `${size}px` }}
    />
  );
}
