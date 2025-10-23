import { useEffect, useRef, useImperativeHandle, forwardRef } from 'preact/compat';
import { DotLottie } from '@lottiefiles/dotlottie-web';

interface LottiePlayerProps {
  path: string;

  // Size options
  size?: number;           // Creates square (width=height=size)
  width?: string;          // Custom width (overrides size)
  height?: string;         // Custom height (overrides size)

  // Playback options
  autoplay?: boolean;      // Default: true
  loop?: boolean;          // Default: true

  // Segment control
  segment?: [number, number]; // [startFrame, endFrame] to loop

  // Styling
  className?: string;

  // Advanced behavior
  autoStartLoop?: boolean; // Auto-start looping from midpoint (for popup bear)
  loopPurpose?: LoopPurpose; // Purpose of the loop (for popup bear)
}

export interface LottiePlayerHandle {
  play: () => void;
  pause: () => void;
  stop: () => void;
  setSegment: (start: number, end: number) => void;
  playOnce: () => void;      // Play full animation, then loop second half
  startLooping: () => void;  // Jump to midpoint and loop
}

export enum LoopPurpose {
  POPUP = 'popup',
  SIDEPANEL = 'sidepanel',
  QASection = 'qasection',
}

/**
 * Unified Lottie Animation Player
 *
 * Supports multiple use cases:
 * - Simple auto-play/loop for loading states
 * - Segment-based looping for specific frame ranges
 * - Imperative control via ref for complex animations
 *
 * @example Simple usage
 * ```tsx
 * <LottiePlayer path="/lotties/kuma-thinking.lottie" size={120} />
 * ```
 *
 * @example Segment looping
 * ```tsx
 * <LottiePlayer
 *   path="/lotties/kuma.lottie"
 *   size={120}
 *   segment={[50, 100]} // Loop frames 50-100
 * />
 * ```
 *
 * @example Imperative control
 * ```tsx
 * const ref = useRef<LottiePlayerHandle>();
 * <LottiePlayer ref={ref} path="/lotties/kuma.lottie" width="118px" height="118px" />
 * // Then call ref.current.playOnce() or ref.current.setSegment(50, 100)
 * ```
 */
export const LottiePlayer = forwardRef<LottiePlayerHandle, LottiePlayerProps>(
  (
    {
      path,
      size,
      width,
      height,
      autoplay = true,
      loop = true,
      segment,
      className = '',
      autoStartLoop = false,
      loopPurpose
    },
    ref
  ) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const animationRef = useRef<DotLottie | null>(null);
    const hasPlayedOnceRef = useRef(false);

    // Determine dimensions
    const finalWidth = width || (size ? `${size}px` : '64px');
    const finalHeight = height || (size ? `${size}px` : '64px');

    // Initialize animation
    useEffect(() => {
      if (!canvasRef.current) return;

      const animation = new DotLottie({
        canvas: canvasRef.current,
        src: path,
        autoplay: false, // We'll control play manually
        loop: segment ? true : loop, // If segment is provided, always loop
      });

      animationRef.current = animation;

      // Handle initial playback
      animation.addEventListener('load', () => {
        const totalFrames = animation.totalFrames;

        // If segment is provided explicitly, set it immediately
        if (segment) {
          animation.setSegment(segment[0], segment[1]);
        }

        else if (loopPurpose === LoopPurpose.QASection && totalFrames) {
          animation.setSegment(1, totalFrames);
        }
        else if (loopPurpose === LoopPurpose.SIDEPANEL && totalFrames) {
          animation.setSegment(2, totalFrames);
        }

        // Auto-play if requested
        // Only auto-play if autoStartLoop is not explicitly set (undefined)
        // If autoStartLoop={false}, keep static. If autoStartLoop={true}, handled by useEffect below
        if (autoplay && autoStartLoop === undefined) {
          animation.play();
        }
      });

      return () => {
        animation.destroy();
      };
    }, [path, autoplay, loop, segment, loopPurpose]);

    // Expose imperative methods via ref
    useImperativeHandle(ref, () => ({
      play: () => {
        const animation = animationRef.current;
        if (!animation) return;
        animation.play();
      },

      pause: () => {
        const animation = animationRef.current;
        if (!animation) return;
        animation.pause();
      },

      stop: () => {
        const animation = animationRef.current;
        if (!animation) return;
        animation.stop();
      },

      setSegment: (start: number, end: number) => {
        const animation = animationRef.current;
        if (!animation) return;
        animation.setSegment(start, end);
        animation.setLoop(true);
      },

      playOnce: () => {
        const animation = animationRef.current;
        if (!animation) return;

        // If already looping, stop it first so we can restart from beginning
        if (hasPlayedOnceRef.current) {
          animation.stop();
        }

        hasPlayedOnceRef.current = true;

        const playAnimation = () => {
          const totalFrames = animation.totalFrames;
          if (!totalFrames) {
            setTimeout(playAnimation, 100);
            return;
          }

          const midpoint = Math.floor(totalFrames / 2);

          // Reset to beginning and play full animation once
          animation.setSegment(0, totalFrames);
          animation.setLoop(false);
          animation.play();

          // On complete, loop second half
          const onComplete = () => {
            animation.removeEventListener('complete', onComplete);
            console.log('[LottiePlayer] Setting segment:', midpoint, 'to', totalFrames);
            animation.setSegment(midpoint, totalFrames);
            animation.setLoop(true);
            animation.play();
          };

          animation.addEventListener('complete', onComplete);
        };

        playAnimation();
      },

      startLooping: (loopPurpose: LoopPurpose = LoopPurpose.POPUP) => {
        const animation = animationRef.current;
        if (!animation) return;

        hasPlayedOnceRef.current = true;

        const startLoop = () => {
          const totalFrames = animation.totalFrames;
          if (!totalFrames) {
            setTimeout(startLoop, 100);
            return;
          }

          if(loopPurpose === LoopPurpose.POPUP) {
          const midpoint = Math.floor(totalFrames / 2);
            console.log('[LottiePlayer] Auto-starting loop from midpoint:', midpoint, 'to', totalFrames);
            animation.setSegment(midpoint, totalFrames);
            animation.setLoop(true);
            animation.play();
          } else if(loopPurpose === LoopPurpose.SIDEPANEL) {
            animation.setSegment(2, totalFrames);
            animation.setLoop(true);
            animation.play();
          } else if(loopPurpose === LoopPurpose.QASection) {
            animation.setSegment(1, totalFrames);
            animation.setLoop(true);
            animation.play();
          }
        };

        startLoop();
      },
    }));

    // Handle autoStartLoop prop (for popup bear)
    useEffect(() => {
      if (autoStartLoop && !hasPlayedOnceRef.current && animationRef.current && loopPurpose) {
        const animation = animationRef.current;

        const startLoop = () => {
          const totalFrames = animation.totalFrames;
          if (!totalFrames) {
            setTimeout(startLoop, 100);
            return;
          }

          // Only set flag after we successfully start the loop
          hasPlayedOnceRef.current = true;

          if(loopPurpose === LoopPurpose.POPUP) {
            const midpoint = Math.floor(totalFrames / 2);
            console.log('[LottiePlayer] Auto-starting loop from midpoint:', midpoint, 'to', totalFrames);
            animation.setSegment(midpoint, totalFrames);
            animation.setLoop(true);
            animation.play();
          } else if(loopPurpose === LoopPurpose.SIDEPANEL) {
            animation.setSegment(2, totalFrames);
            animation.setLoop(true);
            animation.play();
          } else if(loopPurpose === LoopPurpose.QASection) {
            animation.setSegment(1, totalFrames);
            animation.setLoop(true);
            animation.play();
          }
        };

        startLoop();
      }
    }, [autoStartLoop, loopPurpose]);

    return (
      <canvas
        ref={canvasRef}
        className={className}
        style={{ width: finalWidth, height: finalHeight }}
      />
    );
  }
);
