import { useEffect, useRef, useImperativeHandle, forwardRef } from 'preact/compat';
import { DotLottie } from '@lottiefiles/dotlottie-web';

interface LottieAnimationProps {
  path: string;
  width?: string;
  height?: string;
  className?: string;
  autoStartLoop?: boolean;
}

export interface LottieAnimationHandle {
  playOnce: () => void;
  startLooping: () => void;
  stopAnimation: () => void;
}

/**
 * DotLottie Animation component with custom playback control
 * - Initially shows first frame (static)
 * - playOnce() plays full animation, then loops second half
 * - startLooping() jumps to midpoint and loops immediately
 * - autoStartLoop prop triggers looping on mount
 */
export const LottieAnimation = forwardRef<LottieAnimationHandle, LottieAnimationProps>(
  ({ path, width = '118px', height = '118px', className = '', autoStartLoop = false }, ref) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const animationRef = useRef<DotLottie | null>(null);
    const hasPlayedOnceRef = useRef(false);

    useEffect(() => {
      if (!canvasRef.current) return;

      // Load DotLottie animation
      const animation = new DotLottie({
        canvas: canvasRef.current,
        src: path,
        autoplay: false,
        loop: false,
      });

      animationRef.current = animation;

      // Cleanup on unmount
      return () => {
        animation.destroy();
      };
    }, [path]);

    // Expose methods to parent via ref
    useImperativeHandle(ref, () => ({
      playOnce: () => {
        const animation = animationRef.current;
        if (!animation || hasPlayedOnceRef.current) return;

        hasPlayedOnceRef.current = true;

        // Wait for animation to be loaded before getting frame count
        const playAnimation = () => {
          const totalFrames = animation.totalFrames;
          if (!totalFrames) {
            // If not loaded yet, wait a bit
            setTimeout(playAnimation, 100);
            return;
          }

          const midpoint = Math.floor(totalFrames / 2);

          // Play full animation once
          animation.setLoop(false);
          animation.play();

          // On complete, loop second half
          const onComplete = () => {
            animation.removeEventListener('complete', onComplete);

            // Debug logging
            console.log('[Lottie] Setting segment:', midpoint, 'to', totalFrames);

            // Set segment to second half using actual frame numbers
            animation.setSegment(midpoint, totalFrames);
            animation.setLoop(true);
            animation.play();
          };

          animation.addEventListener('complete', onComplete);
        };

        playAnimation();
      },

      startLooping: () => {
        const animation = animationRef.current;
        if (!animation) return;

        hasPlayedOnceRef.current = true; // Mark as played to prevent playOnce override

        // Wait for animation to be loaded
        const startLoop = () => {
          const totalFrames = animation.totalFrames;
          if (!totalFrames) {
            setTimeout(startLoop, 100);
            return;
          }

          const midpoint = Math.floor(totalFrames / 2);

          // Debug logging
          console.log('[Lottie] Auto-starting loop from midpoint:', midpoint, 'to', totalFrames);

          // Jump to midpoint and loop
          animation.setSegment(midpoint, totalFrames);
          animation.setLoop(true);
          animation.play();
        };

        startLoop();
      },

      stopAnimation: () => {
        const animation = animationRef.current;
        if(!animation) return;
        animation.stop();
      }
    }));


    // Auto-start looping if prop is true (but only if user hasn't manually triggered)
    useEffect(() => {
      // Only auto-start if prop is true AND user hasn't clicked "Detect Paper" yet
      if (autoStartLoop && !hasPlayedOnceRef.current && animationRef.current) {
        // Use the startLooping logic directly
        const animation = animationRef.current;
        hasPlayedOnceRef.current = true; // Prevent both playOnce and repeat auto-starts

        const startLoop = () => {
          const totalFrames = animation.totalFrames;
          if (!totalFrames) {
            setTimeout(startLoop, 100);
            return;
          }

          const midpoint = Math.floor(totalFrames / 2);
          console.log('[Lottie] Auto-starting loop from midpoint:', midpoint, 'to', totalFrames);

          animation.setSegment(midpoint, totalFrames);
          animation.setLoop(true);
          animation.play();
        };

        startLoop();
      }
    }, [autoStartLoop]); // Respond to prop changes

    return (
      <canvas
        ref={canvasRef}
        className={className}
        style={{ width, height }}
      />
    );
  }
);
