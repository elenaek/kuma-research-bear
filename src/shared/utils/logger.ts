/**
 * Centralized Logger Utility
 *
 * Provides category-based logging that can be toggled from logConfig.ts
 * Preserves all console.log features (colors, object inspection, etc.)
 */

import { LOG_CONFIG, LogConfig, LogLevel, CURRENT_LOG_LEVEL } from './logConfig.ts';

type LogCategory = keyof LogConfig;

/**
 * Logger class with category-based filtering
 */
class Logger {
  /**
   * Check if a category is enabled
   */
  private isEnabled(category: LogCategory): boolean {
    return LOG_CONFIG[category] === true;
  }

  /**
   * Format category prefix for console output
   */
  private formatPrefix(category: LogCategory): string {
    return `[${category}]`;
  }

  /**
   * Debug level logging (most verbose)
   * Use for detailed debugging information
   *
   * @param category - Log category from LogConfig
   * @param args - Any number of arguments to log (same as console.log)
   */
  debug(category: LogCategory, ...args: any[]): void {
    if (CURRENT_LOG_LEVEL <= LogLevel.DEBUG && this.isEnabled(category)) {
      console.log(this.formatPrefix(category), ...args);
    }
  }

  /**
   * Info level logging
   * Use for general informational messages
   *
   * @param category - Log category from LogConfig
   * @param args - Any number of arguments to log
   */
  info(category: LogCategory, ...args: any[]): void {
    if (CURRENT_LOG_LEVEL <= LogLevel.INFO && this.isEnabled(category)) {
      console.info(this.formatPrefix(category), ...args);
    }
  }

  /**
   * Warning level logging
   * Use for potentially problematic situations
   *
   * @param category - Log category from LogConfig
   * @param args - Any number of arguments to log
   */
  warn(category: LogCategory, ...args: any[]): void {
    if (CURRENT_LOG_LEVEL <= LogLevel.WARN && this.isEnabled(category)) {
      console.warn(this.formatPrefix(category), ...args);
    }
  }

  /**
   * Error level logging
   * Use for error conditions
   *
   * @param category - Log category from LogConfig
   * @param args - Any number of arguments to log
   */
  error(category: LogCategory, ...args: any[]): void {
    if (CURRENT_LOG_LEVEL <= LogLevel.ERROR && this.isEnabled(category)) {
      console.error(this.formatPrefix(category), ...args);
    }
  }

  /**
   * Always log regardless of category settings
   * Use sparingly for critical information that must always be visible
   *
   * @param args - Any number of arguments to log
   */
  always(...args: any[]): void {
    console.log('[ALWAYS]', ...args);
  }

  /**
   * Group logs together (collapsible in console)
   *
   * @param category - Log category from LogConfig
   * @param label - Group label
   * @param callback - Function containing logs to group
   */
  group(category: LogCategory, label: string, callback: () => void): void {
    if (CURRENT_LOG_LEVEL <= LogLevel.DEBUG && this.isEnabled(category)) {
      console.group(this.formatPrefix(category), label);
      callback();
      console.groupEnd();
    }
  }

  /**
   * Collapsed group (starts collapsed in console)
   *
   * @param category - Log category from LogConfig
   * @param label - Group label
   * @param callback - Function containing logs to group
   */
  groupCollapsed(category: LogCategory, label: string, callback: () => void): void {
    if (CURRENT_LOG_LEVEL <= LogLevel.DEBUG && this.isEnabled(category)) {
      console.groupCollapsed(this.formatPrefix(category), label);
      callback();
      console.groupEnd();
    }
  }

  /**
   * Table output (for arrays and objects)
   *
   * @param category - Log category from LogConfig
   * @param data - Data to display as table
   */
  table(category: LogCategory, data: any): void {
    if (CURRENT_LOG_LEVEL <= LogLevel.DEBUG && this.isEnabled(category)) {
      console.log(this.formatPrefix(category));
      console.table(data);
    }
  }

  /**
   * Timing utility - start a timer
   *
   * @param category - Log category from LogConfig
   * @param label - Timer label
   */
  time(category: LogCategory, label: string): void {
    if (CURRENT_LOG_LEVEL <= LogLevel.DEBUG && this.isEnabled(category)) {
      console.time(`${this.formatPrefix(category)} ${label}`);
    }
  }

  /**
   * Timing utility - end a timer
   *
   * @param category - Log category from LogConfig
   * @param label - Timer label (must match time() call)
   */
  timeEnd(category: LogCategory, label: string): void {
    if (CURRENT_LOG_LEVEL <= LogLevel.DEBUG && this.isEnabled(category)) {
      console.timeEnd(`${this.formatPrefix(category)} ${label}`);
    }
  }
}

// Export singleton instance
export const logger = new Logger();

// Also export for convenience
export { LogCategory };
