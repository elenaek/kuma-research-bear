import { forwardRef } from 'preact/compat';
import { LottieAnimation, LottieAnimationHandle } from './LottieAnimation.tsx';

interface HeaderProps {
  autoStartLoop?: boolean;
}

/**
 * Header component for the popup
 * Displays the Kuma logo (Lottie animation) and title
 */
export const Header = forwardRef<LottieAnimationHandle, HeaderProps>(({ autoStartLoop }, ref) => {
  return (
    <header class="mb-6 text-center">
      {/* Logo - Lottie Animation */}
      <div class="flex justify-center mb-4">
        <LottieAnimation
          ref={ref}
          path="/lotties/kuma-research-bear.lottie"
          width="118px"
          height="118px"
          className="w-28 h-28"
          autoStartLoop={autoStartLoop}
        />
      </div>

      <h1 class="text-2xl font-bold text-gray-800">Kuma the Research Bear</h1>
      <p class="text-sm text-gray-600 pt-2 font-light">
        AI-Powered Bear that helps you understand research papers
      </p>
    </header>
  );
});
