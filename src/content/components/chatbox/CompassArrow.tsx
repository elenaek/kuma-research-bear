import { h } from 'preact';

interface CompassArrowProps {
  angle: number;
  size?: number;
}

/**
 * Compass arrow component that points to the source image
 * Used in image chat tabs to help users locate the referenced image on the page
 */
export const CompassArrow = ({ angle, size = 20 }: CompassArrowProps) => {
  return (
    <svg
      class="chatbox-compass-arrow"
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="currentColor"
      style={{
        transform: `rotate(${angle}deg)`,
        flexShrink: 0,
      }}
      title="Points to source image"
    >
      <path
        d="M 17 10 L 5 3 L 11 10 L 5 17 Z"
        fill="currentColor"
      />
    </svg>
  );
};
