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

    animation.addEventListener('load', () => {
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
