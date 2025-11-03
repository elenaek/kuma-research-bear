import { useState, useEffect } from 'preact/hooks';
import { getVerbosity, setVerbosity } from '../../utils/settingsService.ts';
import { getVerbosityLabel } from '../../prompts/components/verbosity.ts';
import { logger } from '../../utils/logger.ts';

/**
 * Verbosity Slider Component
 * Allows users to adjust response verbosity from concise (1) to comprehensive (5)
 * Settings are persisted globally and affect the length of AI responses
 */
export function VerbositySlider() {
  const [verbosity, setVerbosityState] = useState<number>(3);
  const [isChanging, setIsChanging] = useState(false);

  // Load current verbosity setting on mount
  useEffect(() => {
    getVerbosity().then(level => {
      setVerbosityState(level);
    });
  }, []);

  const handleVerbosityChange = async (event: Event) => {
    const target = event.target as HTMLInputElement;
    const newValue = parseInt(target.value, 10);

    setVerbosityState(newValue);
    setIsChanging(true);

    // Save to settings with debounce
    try {
      await setVerbosity(newValue);
      logger.debug('SETTINGS', 'Verbosity changed to:', newValue);
    } catch (error) {
      logger.error('SETTINGS', 'Error saving verbosity setting:', error);
    } finally {
      // Reset changing state after a brief delay
      setTimeout(() => setIsChanging(false), 300);
    }
  };

  const verbosityLabel = getVerbosityLabel(verbosity);

  return (
    <div class="verbosity-slider-container">
      {/* Label and current value */}
      <div class="flex items-center justify-between mb-2">
        <label for="verbosity-slider" class="text-sm font-medium text-gray-700 dark:text-gray-300">
          Response Length
        </label>
        <span class={`text-sm font-medium transition-colors ${isChanging ? 'text-blue-600 dark:text-blue-400' : 'text-gray-600 dark:text-gray-400'}`}>
          {verbosityLabel}
        </span>
      </div>

      {/* Slider */}
      <div class="relative">
        <input
          id="verbosity-slider"
          type="range"
          min="1"
          max="5"
          step="1"
          value={verbosity}
          onInput={handleVerbosityChange}
          class="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700 slider"
          aria-label="Verbosity level"
          title={`Verbosity: ${verbosityLabel}`}
        />

        {/* Tick marks */}
        <div class="flex justify-between px-1 mt-1">
          {[1, 2, 3, 4, 5].map(val => (
            <div
              key={val}
              class={`w-1 h-1 rounded-full transition-colors ${
                val <= verbosity
                  ? 'bg-blue-600 dark:bg-blue-400'
                  : 'bg-gray-300 dark:bg-gray-600'
              }`}
            />
          ))}
        </div>
      </div>

      {/* Min/Max labels */}
      <div class="flex justify-between mt-1 px-1">
        <span class="text-xs text-gray-500 dark:text-gray-500">Concise</span>
        <span class="text-xs text-gray-500 dark:text-gray-500">Detailed</span>
      </div>
    </div>
  );
}
