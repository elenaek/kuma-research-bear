import { AILanguageModelSession } from '../../../shared/types/index.ts';
import { AISessionManager } from './AISessionManager.ts';
import { logger } from '../../../shared/utils/logger.ts';

/**
 * Configuration for prompt timeout and retry behavior
 */
export interface PromptTimeoutConfig {
  /** Timeout duration in milliseconds (default: 60000ms = 60s) */
  timeoutMs?: number;
  /** Maximum number of retry attempts (default: 2) */
  maxRetries?: number;
  /** Delay between retries in milliseconds (default: 1000ms = 1s) */
  retryDelayMs?: number;
  /** Whether to destroy and recreate session on timeout (default: true) */
  recreateSessionOnTimeout?: boolean;
}

/**
 * Prompt execution options
 */
export interface PromptExecutionOptions {
  /** Response constraint (e.g., JSON schema) */
  responseConstraint?: any;
  /** Abort signal for cancellation */
  signal?: AbortSignal;
}

/**
 * PromptExecutor - Executes prompts with timeout and retry logic
 *
 * Responsibilities:
 * - Execute prompts against AI sessions
 * - Implement timeout using Promise.race
 * - Retry failed prompts with exponential backoff
 * - Recreate sessions on timeout if configured
 * - Handle abort signals for cancellation
 */
export class PromptExecutor {
  constructor(private sessionManager: AISessionManager) {}

  /**
   * Execute prompt with timeout and retry
   *
   * @param contextId - Context identifier for the session
   * @param input - Prompt input
   * @param config - Timeout and retry configuration
   * @param options - Execution options (response constraint, abort signal)
   * @returns Prompt response
   */
  async executeWithTimeout(
    contextId: string,
    input: string,
    config: PromptTimeoutConfig = {},
    options: PromptExecutionOptions = {}
  ): Promise<string> {
    // Apply defaults
    const finalConfig: Required<PromptTimeoutConfig> = {
      timeoutMs: config.timeoutMs ?? 60000, // 60 seconds
      maxRetries: config.maxRetries ?? 2,
      retryDelayMs: config.retryDelayMs ?? 1000, // 1 second
      recreateSessionOnTimeout: config.recreateSessionOnTimeout ?? true,
    };

    logger.debug('PROMPT_EXECUTOR', `[Prompt] contextId: ${contextId}`);
    logger.debug('PROMPT_EXECUTOR', `[Prompt] Timeout config:`, finalConfig);

    let lastError: any;

    // Retry loop
    for (let attempt = 1; attempt <= finalConfig.maxRetries; attempt++) {
      try {
        logger.debug('PROMPT_EXECUTOR', `[Prompt] Attempt ${attempt}/${finalConfig.maxRetries} for context: ${contextId}`);

        // Get session
        const session = this.sessionManager.getSession(contextId);
        if (!session) {
          throw new Error(`No session found for context: ${contextId}`);
        }

        // Create abort controller for this request
        const abortController = new AbortController();

        // Register abort controller
        this.sessionManager.registerAbortController(contextId, abortController);

        try {
          // Create timeout promise
          const timeoutPromise = new Promise<string>((_, reject) =>
            setTimeout(() => reject(new Error('PROMPT_TIMEOUT')), finalConfig.timeoutMs)
          );

          // Create the actual prompt call
          const promptPromise = session.prompt(input, {
            ...options,
            signal: abortController.signal
          });

          // Race the promises
          const response = await Promise.race([promptPromise, timeoutPromise]);

          // Clear the request tracking on success
          this.sessionManager.unregisterAbortController(contextId);

          logger.debug('PROMPT_EXECUTOR', `[Prompt] ✓ Success on attempt ${attempt}/${finalConfig.maxRetries}`);
          return response;

        } catch (error: any) {
          // Clear the request tracking
          this.sessionManager.unregisterAbortController(contextId);

          // Check if it was an abort
          if (error.name === 'AbortError') {
            logger.debug('PROMPT_EXECUTOR', `[Prompt] Request aborted for context: ${contextId}`);
            throw new Error('AI request was cancelled');
          }

          // Check if it was a timeout
          const isTimeout = error.message === 'PROMPT_TIMEOUT';

          if (isTimeout && attempt < finalConfig.maxRetries) {
            logger.warn('PROMPT_EXECUTOR', `[Prompt] Timeout after ${finalConfig.timeoutMs}ms (attempt ${attempt}/${finalConfig.maxRetries})`);

            // Optionally destroy and recreate session
            if (finalConfig.recreateSessionOnTimeout) {
              logger.debug('PROMPT_EXECUTOR', `[Prompt] Recreating session for context: ${contextId}`);
              await this.sessionManager.destroySession(contextId);
              // Note: Session recreation will need to be handled by the caller
              // since we need session options which the executor doesn't have
            }

            // Wait before retry
            logger.debug('PROMPT_EXECUTOR', `[Prompt] Waiting ${finalConfig.retryDelayMs}ms before retry...`);
            await this.sleep(finalConfig.retryDelayMs);

            // Continue to next attempt
            lastError = error;
            continue;
          }

          // For non-timeout errors or final timeout, throw immediately
          throw error;
        }
      } catch (error) {
        lastError = error;

        // If this is the last attempt, throw
        if (attempt === finalConfig.maxRetries) {
          logger.error('PROMPT_EXECUTOR', `[Prompt] All ${finalConfig.maxRetries} attempts failed for context: ${contextId}`);
          throw error;
        }

        // Otherwise continue to next retry
        logger.warn('PROMPT_EXECUTOR', `[Prompt] Attempt ${attempt} failed, retrying...`, error);
      }
    }

    // Should never reach here, but throw last error if we do
    throw lastError || new Error('Prompt execution failed');
  }

  /**
   * Execute prompt without timeout/retry (for simple cases)
   *
   * @param contextId - Context identifier for the session
   * @param input - Prompt input
   * @param options - Execution options
   * @returns Prompt response
   */
  async execute(
    contextId: string,
    input: string,
    options: PromptExecutionOptions = {}
  ): Promise<string> {
    const session = this.sessionManager.getSession(contextId);
    if (!session) {
      throw new Error(`No session found for context: ${contextId}`);
    }

    logger.debug('PROMPT_EXECUTOR', `[Prompt] Executing for context: ${contextId}`);

    const response = await session.prompt(input, options);

    logger.debug('PROMPT_EXECUTOR', `[Prompt] ✓ Success for context: ${contextId}`);
    return response;
  }

  /**
   * Execute prompt with streaming response
   *
   * @param contextId - Context identifier for the session
   * @param input - Prompt input
   * @param options - Execution options
   * @returns Readable stream
   */
  async executeStreaming(
    contextId: string,
    input: string,
    options: PromptExecutionOptions = {}
  ): Promise<ReadableStream> {
    const session = this.sessionManager.getSession(contextId);
    if (!session) {
      throw new Error(`No session found for context: ${contextId}`);
    }

    logger.debug('PROMPT_EXECUTOR', `[Prompt] Starting streaming for context: ${contextId}`);

    const stream = await session.promptStreaming(input, options);

    logger.debug('PROMPT_EXECUTOR', `[Prompt] ✓ Stream started for context: ${contextId}`);
    return stream;
  }

  /**
   * Cancel active prompt execution
   *
   * @param contextId - Context identifier
   */
  cancelExecution(contextId: string): void {
    this.sessionManager.abortRequest(contextId);
  }

  /**
   * Sleep utility for retry delays
   *
   * @param ms - Milliseconds to sleep
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
