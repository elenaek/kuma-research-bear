/**
 * Centralized Logging Configuration
 *
 * Control debug logging across the entire extension from this single file.
 * Set any category to `true` to enable detailed logging for that feature.
 *
 * Usage:
 * 1. Import logger from './logger'
 * 2. Use logger.debug('CATEGORY_NAME', 'message', data)
 * 3. Toggle the category here to enable/disable logs
 *
 * Example:
 *   import { logger } from '../utils/logger';
 *   logger.debug('LATEX_REPAIR', 'Processing text:', text);
 */

/**
 * Log Levels
 * Control which severity of logs are displayed
 */
export enum LogLevel {
  DEBUG = 0,  // Most verbose - all development logs
  INFO = 1,   // Informational messages
  WARN = 2,   // Warnings and potential issues
  ERROR = 3,  // Errors only
}

/**
 * Current Log Level
 * Only logs at or above this level will be displayed
 *
 * Default: LogLevel.WARN (only warnings and errors)
 * Set to LogLevel.DEBUG to see all logs
 */
export const CURRENT_LOG_LEVEL = LogLevel.DEBUG;

export interface LogConfig {
  // LaTeX and MathJax rendering
  LATEX_REPAIR: boolean;
  MATHJAX_RENDER: boolean;

  // AI and LLM services
  AI_SERVICE: boolean;
  PROMPT_ENGINEERING: boolean;

  // Chat and messaging
  CHATBOX: boolean;
  STREAMING: boolean;

  // Data storage and retrieval
  DATABASE: boolean;
  EMBEDDINGS: boolean;
  RAG: boolean;

  // PDF and document processing
  PDF_EXTRACTION: boolean;
  CHUNKING: boolean;

  // Chrome extension infrastructure
  CHROME_SERVICE: boolean;
  CONTENT_SCRIPT: boolean;
  BACKGROUND_SCRIPT: boolean;
  SETTINGS: boolean;
  NAVIGATION: boolean;

  // UI Components
  UI_COMPONENTS: boolean;

  // Performance and metrics
  PERFORMANCE: boolean;

  // General debugging
  GENERAL: boolean;
}

/**
 * Debug Log Configuration
 *
 * Set to `true` to enable detailed logging for that category.
 * Set to `false` to disable (recommended for production).
 *
 * Default: All disabled for production builds.
 */
export const LOG_CONFIG: LogConfig = {
  // LaTeX and MathJax
  LATEX_REPAIR: false,           // LaTeX command repair logic
  MATHJAX_RENDER: false,          // MathJax rendering process

  // AI and LLM
  AI_SERVICE: true,               // AI service calls and responses
  PROMPT_ENGINEERING: false,      // Prompt construction and validation

  // Chat
  CHATBOX: true,                 // Chat UI and message handling
  STREAMING: true,               // Streaming response processing

  // Data
  DATABASE: false,                // IndexedDB operations
  EMBEDDINGS: false,              // Embedding generation and storage
  RAG: false,                     // RAG retrieval and ranking

  // Documents
  PDF_EXTRACTION: false,          // PDF parsing and extraction
  CHUNKING: false,                // Document chunking logic

  // Chrome Extension
  CHROME_SERVICE: false,          // Chrome API interactions
  CONTENT_SCRIPT: false,          // Content script lifecycle
  BACKGROUND_SCRIPT: false,       // Background script events
  SETTINGS: false,                // User settings and preferences
  NAVIGATION: false,              // Page navigation and routing

  // UI Components
  UI_COMPONENTS: false,           // UI component interactions

  // Performance
  PERFORMANCE: false,             // Timing and performance metrics

  // General
  GENERAL: false,                 // Miscellaneous debug logs
};

/**
 * Quick enable all logs (useful for comprehensive debugging)
 * Uncomment the line below to enable ALL logging categories
 */
// Object.keys(LOG_CONFIG).forEach(key => LOG_CONFIG[key as keyof LogConfig] = true);
