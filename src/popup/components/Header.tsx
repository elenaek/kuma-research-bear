import { forwardRef } from 'preact/compat';
import { LottiePlayer, LottiePlayerHandle, LoopPurpose } from '../../shared/components/LottiePlayer.tsx';

interface HeaderProps {
  autoStartLoop?: boolean;
}

/**
 * Header component for the popup
 * Displays the Kuma logo (Lottie animation), title, and language selector
 */
export const Header = forwardRef<LottiePlayerHandle, HeaderProps>(({ autoStartLoop }, ref) => {
  return (
    <header class="mb-6 relative">
      {/* Logo - Lottie Animation */}
      <div class="flex justify-center mb-4">
        <LottiePlayer
          ref={ref}
          path="/lotties/kuma-research-bear.lottie"
          width="118px"
          height="118px"
          className="w-28 h-28"
          autoplay={false}
          autoStartLoop={autoStartLoop}
          loopPurpose={LoopPurpose.POPUP}
        />
      </div>

      {/* Title */}
      <h1 class="text-2xl font-bold text-gray-800 text-center">Kuma the Research Bear</h1>

      <p class="text-sm text-gray-600 text-center font-light pt-2">
        AI-Powered Bear that helps you understand research papers
      </p>
    </header>
  );
});
