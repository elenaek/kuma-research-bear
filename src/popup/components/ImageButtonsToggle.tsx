interface ImageButtonsToggleProps {
  showImageButtons: boolean;
  onToggle: () => void;
}

/**
 * Toggle component for showing/hiding image explanation buttons
 */
export const ImageButtonsToggle = ({ showImageButtons, onToggle }: ImageButtonsToggleProps) => {
  return (
    <div class="card mb-4 mt-4">
      <label class="flex items-center justify-between cursor-pointer">
        <div class="flex-1">
          <span class="text-sm font-medium text-gray-700">Image Explanation Buttons</span>
          <p class="text-xs text-gray-500 mt-0.5">Show AI explanation buttons on detected images</p>
        </div>
        <div class="relative inline-flex items-center cursor-pointer ml-4">
          <input
            type="checkbox"
            checked={showImageButtons}
            onChange={onToggle}
            class="sr-only peer"
          />
          <div class="w-11 h-6 bg-gray-300 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-green-600 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-gradient-to-r peer-checked:from-green-600 peer-checked:to-green-800"></div>
        </div>
      </label>
    </div>
  );
};
