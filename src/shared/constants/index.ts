/**
 * Shared constants used across the application
 *
 * Note: Most configuration constants are appropriately placed in:
 * - Orchestrators (timeouts, retry limits, chunk sizes)
 * - Types/interfaces (enums, supported values)
 * - Service classes (quotas, thresholds)
 *
 * This file is for truly global, cross-cutting constants.
 */

/**
 * Extension metadata
 */
export const EXTENSION_NAME = 'Kuma Research Bear';
export const EXTENSION_VERSION = '0.5.0';

/**
 * Feature flags (for future use)
 */
export const FEATURE_FLAGS = {
  EXPERIMENTAL_PARALLEL_PROCESSING: false,
  ENHANCED_ERROR_REPORTING: false,
} as const;

/**
 * Application-wide limits
 */
export const APP_LIMITS = {
  MAX_FILE_SIZE_MB: 50,
  MAX_CONCURRENT_OPERATIONS: 3,
} as const;
