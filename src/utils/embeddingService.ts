import {
  EmbeddingModelConfig,
  EmbeddingVector,
  EmbeddingModelStatus,
  EmbeddingCapabilities,
  EMBEDDING_PREFIXES,
  DEFAULT_EMBEDDING_CONFIG,
  SimilarityScore,
  getOptimalDtype,
} from '../types/embedding.ts';
import { logger } from './logger.ts';

/**
 * EmbeddingService: Manages EmbeddingGemma model for semantic search
 *
 * Uses Transformers.js to run EmbeddingGemma (308M parameters) locally in the browser
 * for privacy-preserving semantic search and RAG functionality.
 *
 * Features:
 * - Lazy model loading (only loads when first needed)
 * - Automatic fallback to keyword search if model unavailable
 * - Task-specific prefixes for optimal embedding quality
 * - Cosine similarity calculation via matmul
 * - Matryoshka truncation for storage efficiency (256 dims default)
 */
class EmbeddingService {
  private model: any = null;
  private tokenizer: any = null;
  private status: EmbeddingModelStatus = 'not-loaded';
  private config: EmbeddingModelConfig = DEFAULT_EMBEDDING_CONFIG;
  private loadPromise: Promise<void> | null = null;
  private device: 'webgpu' | 'wasm' | null = null;  // Track which backend is being used
  private retryCount: number = 0;
  private maxRetries: number = 2;  // Max retry attempts for failed downloads

  /**
   * Helper function to retry an async operation with exponential backoff
   * @private
   */
  private async retryWithBackoff<T>(
    operation: () => Promise<T>,
    retryableErrors: string[],
    operationName: string
  ): Promise<T> {
    let lastError: any;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        const errorMessage = error instanceof Error ? error.message : String(error);

        // Check if error is retryable
        const isRetryable = retryableErrors.some(pattern => errorMessage.includes(pattern));

        if (!isRetryable || attempt === this.maxRetries) {
          // Non-retryable error or max retries reached
          throw error;
        }

        // Calculate backoff delay (exponential: 1s, 2s, 4s...)
        const delay = Math.pow(2, attempt) * 1000;
        logger.warn('EMBEDDINGS', `[Embedding] ${operationName} failed (attempt ${attempt + 1}/${this.maxRetries + 1}), retrying in ${delay}ms...`, {
          error: errorMessage,
        });

        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    throw lastError;
  }

  /**
   * Verify environment and report diagnostics
   * @internal - for debugging purposes
   */
  async verifyEnvironment(): Promise<{
    chromeRuntime: boolean;
    wasmPaths: string[];
    webGPUAvailable: boolean;
    documentsAvailable: boolean;
  }> {
    const diagnostics = {
      chromeRuntime: typeof chrome !== 'undefined' && !!chrome.runtime,
      wasmPaths: [] as string[],
      webGPUAvailable: false,
      documentsAvailable: typeof document !== 'undefined',
    };

    if (diagnostics.chromeRuntime) {
      const expectedWasmFiles = [
        'ort-wasm-simd-threaded.wasm',
        'ort-wasm-simd.wasm',
        'ort-wasm-threaded.wasm',
        'ort-wasm.wasm',
      ];
      diagnostics.wasmPaths = expectedWasmFiles.map(file => chrome.runtime.getURL(file));
    }

    if (typeof navigator !== 'undefined' && 'gpu' in navigator && navigator.gpu) {
      try {
        const adapter = await navigator.gpu.requestAdapter();
        diagnostics.webGPUAvailable = !!adapter;
      } catch (e) {
        // WebGPU not available
      }
    }

    return diagnostics;
  }

  /**
   * Check if Transformers.js and WebGPU/WASM are available
   */
  async checkAvailability(): Promise<EmbeddingCapabilities> {
    try {
      // Service workers don't have access to DOM APIs needed for embeddings
      // Only run in content scripts or sidepanel contexts
      if (typeof document === 'undefined') {
        return {
          available: false,
          status: 'unavailable',
          error: 'Embeddings only available in content script context',
        };
      }

      // Try to import Transformers.js
      const { AutoModel } = await import('@huggingface/transformers');

      if (!AutoModel) {
        return {
          available: false,
          status: 'unavailable',
          error: 'Transformers.js not available',
        };
      }

      return {
        available: true,
        status: this.status,
        modelConfig: this.config,
        device: this.device ?? undefined,  // Include backend device if loaded
      };
    } catch (error) {
      logger.error('EMBEDDINGS', '[Embedding] Error checking availability:', error);
      return {
        available: false,
        status: 'unavailable',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Load the EmbeddingGemma model
   * Uses singleton pattern - only loads once
   */
  async loadModel(): Promise<void> {
    // If already loaded, return immediately
    if (this.status === 'ready') {
      return;
    }

    // If currently loading, wait for existing load to complete
    if (this.loadPromise) {
      return this.loadPromise;
    }

    // Start loading
    this.status = 'loading';

    this.loadPromise = (async () => {
      try {
        const { AutoTokenizer, AutoModel, env } = await import('@huggingface/transformers');

        // Note: Using @huggingface/transformers 3.7.6+ for EmbeddingGemma support
        logger.debug('EMBEDDINGS', '[Embedding] Loading transformers.js library...');

        // Configure Transformers.js environment to use local WASM files
        // This prevents CSP violations by loading from extension resources
        env.allowLocalModels = false;  // Not hosting models locally
        env.allowRemoteModels = true;  // Download model weights from HuggingFace Hub
        env.useBrowserCache = true;    // Use browser cache for model weights

        // Point ONNX Runtime to local WASM files bundled with the extension
        // This prevents CSP violations when loading WASM backend
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
          const wasmBasePath = chrome.runtime.getURL('');
          env.backends.onnx.wasm.wasmPaths = wasmBasePath;

          // Enhanced diagnostics: Log the actual WASM path being used
          logger.debug('EMBEDDINGS', '[Embedding] WASM base path configured:', wasmBasePath);

          // Log expected WASM file URLs for verification
          const expectedWasmFiles = [
            'ort-wasm-simd-threaded.wasm',
            'ort-wasm-simd.wasm',
            'ort-wasm-threaded.wasm',
            'ort-wasm.wasm'
          ];
          logger.debug('EMBEDDINGS', '[Embedding] Expected WASM files:');
          expectedWasmFiles.forEach(file => {
            const fullUrl = chrome.runtime.getURL(file);
            logger.debug('EMBEDDINGS', `  - ${fullUrl}`);
          });
        } else {
          logger.warn('EMBEDDINGS', '[Embedding] chrome.runtime.getURL not available - WASM loading may fail!');
        }

        // Load tokenizer with enhanced error handling and retry logic
        logger.debug('EMBEDDINGS', '[Embedding] Loading tokenizer for model:', this.config.modelId);
        try {
          this.tokenizer = await this.retryWithBackoff(
            async () => await AutoTokenizer.from_pretrained(this.config.modelId),
            ['ERR_FILE_NOT_FOUND', 'content-length', 'network', 'fetch'],
            'Tokenizer loading'
          );
          logger.debug('EMBEDDINGS', '[Embedding] ✓ Tokenizer loaded successfully');
        } catch (tokenizerError) {
          logger.error('EMBEDDINGS', '[Embedding] ❌ Failed to load tokenizer after retries:', {
            error: tokenizerError,
            modelId: this.config.modelId,
            message: tokenizerError instanceof Error ? tokenizerError.message : String(tokenizerError),
            stack: tokenizerError instanceof Error ? tokenizerError.stack : undefined,
            retriesAttempted: this.maxRetries,
          });
          throw tokenizerError;
        }

        // Detect and test WebGPU availability
        let targetDevice: 'webgpu' | 'wasm' = 'wasm';

        try {
          // Check if WebGPU API exists and actually works
          if (typeof navigator !== 'undefined' && 'gpu' in navigator && navigator.gpu) {
            logger.debug('EMBEDDINGS', '[Embedding] WebGPU API detected, testing adapter...');
            const adapter = await navigator.gpu.requestAdapter();

            if (adapter) {
              targetDevice = 'webgpu';
              logger.debug('EMBEDDINGS', '[Embedding] ✓ WebGPU adapter available, will attempt GPU acceleration');
            } else {
              logger.debug('EMBEDDINGS', '[Embedding] WebGPU adapter request failed, using WASM backend');
            }
          } else {
            logger.debug('EMBEDDINGS', '[Embedding] WebGPU not available, using WASM backend');
          }
        } catch (e) {
          logger.debug('EMBEDDINGS', '[Embedding] Error testing WebGPU adapter, falling back to WASM:', e);
        }

        // Select optimal dtype for the target device
        const optimalDtype = getOptimalDtype(targetDevice);
        logger.debug('EMBEDDINGS', `[Embedding] 📦 Loading model with ${optimalDtype} quantization for ${targetDevice.toUpperCase()}`);
        logger.debug('EMBEDDINGS', `[Embedding] Model ID: ${this.config.modelId}`);

        // Estimated model sizes: fp32 (~300MB) for WebGPU, q4 (~80MB) for WASM
        const estimatedSize = optimalDtype === 'fp32' ? '~300MB' : '~80MB';
        logger.debug('EMBEDDINGS', `[Embedding] Estimated download size: ${estimatedSize}`);

        // Try loading with optimal settings for detected backend
        try {
          logger.debug('EMBEDDINGS', `[Embedding] ⏳ Downloading and initializing model... (this may take a minute)`);
          logger.debug('EMBEDDINGS', `[Embedding] Model configuration:`, {
            modelId: this.config.modelId,
            device: targetDevice,
            dtype: optimalDtype,
            estimatedSize: estimatedSize,
          });

          // Track all file downloads for cumulative progress
          const fileProgress: Record<string, { loaded: number; total: number }> = {};
          const downloadedFiles: string[] = [];
          const failedFiles: string[] = [];

          this.model = await AutoModel.from_pretrained(this.config.modelId, {
            dtype: optimalDtype,
            device: targetDevice,
            progress_callback: (progress: any) => {
              // Log download progress with enhanced tracking
              if (progress.status === 'download') {
                const percent = progress.loaded && progress.total
                  ? ((progress.loaded / progress.total) * 100).toFixed(1)
                  : '?';
                logger.debug('EMBEDDINGS', `[Embedding] 📥 Downloading ${progress.file}: ${percent}%`);

                // Track progress for all files (not just onnx files)
                if (progress.file && progress.loaded !== undefined && progress.total !== undefined) {
                  fileProgress[progress.file] = {
                    loaded: progress.loaded,
                    total: progress.total
                  };

                  // Calculate cumulative progress across all files
                  let totalLoaded = 0;
                  let totalSize = 0;
                  for (const file in fileProgress) {
                    totalLoaded += fileProgress[file].loaded;
                    totalSize += fileProgress[file].total;
                  }

                  const cumulativeProgress = totalSize > 0 ? totalLoaded / totalSize : 0;

                  // Map embedding progress to 80-100% of combined progress
                  const combinedProgress = 80 + (cumulativeProgress * 20);

                  logger.debug('EMBEDDINGS', `[Embedding] Overall progress: ${(cumulativeProgress * 100).toFixed(1)}% (${totalLoaded}/${totalSize} bytes across ${Object.keys(fileProgress).length} files)`);

                  chrome.runtime.sendMessage({
                    type: 'MODEL_DOWNLOAD_PROGRESS',
                    payload: {
                      model: 'embedding',
                      progress: cumulativeProgress * 100, // 0-100%
                      combinedProgress: combinedProgress, // 80-100%
                    },
                  }).catch(() => {
                    // No listeners, that's ok
                  });
                }
              } else if (progress.status === 'done') {
                logger.debug('EMBEDDINGS', `[Embedding] ✓ Downloaded ${progress.file}`);
                if (progress.file && !downloadedFiles.includes(progress.file)) {
                  downloadedFiles.push(progress.file);
                }
              } else if (progress.status === 'error') {
                logger.error('EMBEDDINGS', `[Embedding] ❌ Failed to download ${progress.file}:`, progress.error);
                if (progress.file && !failedFiles.includes(progress.file)) {
                  failedFiles.push(progress.file);
                }
              }
            },
          });

          this.device = targetDevice;
          this.status = 'ready';

          // Log download summary
          logger.debug('EMBEDDINGS', `[Embedding] Download summary:`, {
            totalFiles: downloadedFiles.length,
            downloadedFiles,
            failedFiles: failedFiles.length > 0 ? failedFiles : 'none',
          });

          // Log model config for diagnostics (especially model_type)
          try {
            if (this.model && this.model.config) {
              logger.debug('EMBEDDINGS', `[Embedding] Model config:`, {
                model_type: this.model.config.model_type,
                architectures: this.model.config.architectures,
                hidden_size: this.model.config.hidden_size,
                num_hidden_layers: this.model.config.num_hidden_layers,
              });
            }
          } catch (configError) {
            logger.debug('EMBEDDINGS', '[Embedding] Could not read model config');
          }

          logger.debug('EMBEDDINGS', `[Embedding] ✅ Model loaded successfully with ${targetDevice.toUpperCase()} backend (${optimalDtype})`);
          logger.debug('EMBEDDINGS', `[Embedding] 🚀 Ready for inference!`);
        } catch (modelError) {
          // If WebGPU fails, fallback to WASM with q4
          if (targetDevice === 'webgpu') {
            logger.warn('EMBEDDINGS', '[Embedding] ❌ WebGPU model loading failed, falling back to WASM:', {
              error: modelError,
              message: modelError instanceof Error ? modelError.message : String(modelError),
              stack: modelError instanceof Error ? modelError.stack : undefined,
            });

            const wasmDtype = getOptimalDtype('wasm');
            logger.debug('EMBEDDINGS', `[Embedding] 🔄 Retrying with WASM backend (${wasmDtype})...`);

            // Track all file downloads for cumulative progress (fallback path)
            const fileProgressFallback: Record<string, { loaded: number; total: number }> = {};
            const downloadedFilesFallback: string[] = [];
            const failedFilesFallback: string[] = [];

            this.model = await AutoModel.from_pretrained(this.config.modelId, {
              dtype: wasmDtype, // q4 for WASM
              device: 'wasm',
              progress_callback: (progress: any) => {
                if (progress.status === 'download') {
                  const percent = progress.loaded && progress.total
                    ? ((progress.loaded / progress.total) * 100).toFixed(1)
                    : '?';
                  logger.debug('EMBEDDINGS', `[Embedding] 📥 Downloading ${progress.file}: ${percent}%`);

                  // Track progress for all files (fallback path)
                  if (progress.file && progress.loaded !== undefined && progress.total !== undefined) {
                    fileProgressFallback[progress.file] = {
                      loaded: progress.loaded,
                      total: progress.total
                    };

                    // Calculate cumulative progress across all files
                    let totalLoaded = 0;
                    let totalSize = 0;
                    for (const file in fileProgressFallback) {
                      totalLoaded += fileProgressFallback[file].loaded;
                      totalSize += fileProgressFallback[file].total;
                    }

                    const cumulativeProgress = totalSize > 0 ? totalLoaded / totalSize : 0;

                    // Map embedding progress to 80-100% of combined progress
                    const combinedProgress = 80 + (cumulativeProgress * 20);

                    logger.debug('EMBEDDINGS', `[Embedding] Overall progress: ${(cumulativeProgress * 100).toFixed(1)}% (${totalLoaded}/${totalSize} bytes across ${Object.keys(fileProgressFallback).length} files)`);

                    chrome.runtime.sendMessage({
                      type: 'MODEL_DOWNLOAD_PROGRESS',
                      payload: {
                        model: 'embedding',
                        progress: cumulativeProgress * 100, // 0-100%
                        combinedProgress: combinedProgress, // 80-100%
                      },
                    }).catch(() => {
                      // No listeners, that's ok
                    });
                  }
                } else if (progress.status === 'done') {
                  logger.debug('EMBEDDINGS', `[Embedding] ✓ Downloaded ${progress.file}`);
                  if (progress.file && !downloadedFilesFallback.includes(progress.file)) {
                    downloadedFilesFallback.push(progress.file);
                  }
                } else if (progress.status === 'error') {
                  logger.error('EMBEDDINGS', `[Embedding] ❌ Failed to download ${progress.file}:`, progress.error);
                  if (progress.file && !failedFilesFallback.includes(progress.file)) {
                    failedFilesFallback.push(progress.file);
                  }
                }
              },
            });

            this.device = 'wasm';
            this.status = 'ready';

            // Log download summary (fallback path)
            logger.debug('EMBEDDINGS', `[Embedding] Download summary (fallback):`, {
              totalFiles: downloadedFilesFallback.length,
              downloadedFiles: downloadedFilesFallback,
              failedFiles: failedFilesFallback.length > 0 ? failedFilesFallback : 'none',
            });

            // Log model config (fallback path)
            try {
              if (this.model && this.model.config) {
                logger.debug('EMBEDDINGS', `[Embedding] Model config (fallback):`, {
                  model_type: this.model.config.model_type,
                  architectures: this.model.config.architectures,
                  hidden_size: this.model.config.hidden_size,
                  num_hidden_layers: this.model.config.num_hidden_layers,
                });
              }
            } catch (configError) {
              logger.debug('EMBEDDINGS', '[Embedding] Could not read model config (fallback)');
            }

            logger.debug('EMBEDDINGS', `[Embedding] ✅ Model loaded successfully with WASM backend (${wasmDtype}, fallback)`);
          } else {
            throw modelError;
          }
        }
      } catch (error) {
        this.status = 'error';

        // Enhanced error diagnostics
        const errorInfo: any = {
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          modelId: this.config.modelId,
          context: 'Model loading failed',
        };

        // Add specific diagnostics for common errors
        if (errorInfo.message?.includes('gemma3_text')) {
          errorInfo.diagnosis = 'Model config contains unsupported model_type "gemma3_text". This indicates transformers.js version is too old.';
          errorInfo.recommendation = 'Upgrade @huggingface/transformers to version 3.4.0 or later. Current version may be 3.1.2 which lacks EmbeddingGemma support.';
          errorInfo.requiredVersion = '3.4.0+';
          errorInfo.upgradeCommand = 'npm install @huggingface/transformers@latest';
        } else if (errorInfo.message?.includes('ERR_FILE_NOT_FOUND')) {
          errorInfo.diagnosis = 'WASM or model files not found. Likely a path configuration or CSP issue.';
          errorInfo.recommendation = 'Check WASM path configuration and web_accessible_resources in manifest.json';
        } else if (errorInfo.message?.includes('content-length')) {
          errorInfo.diagnosis = 'Network or caching issue preventing file downloads.';
          errorInfo.recommendation = 'Try clearing browser cache or checking network connectivity.';
        }

        logger.error('EMBEDDINGS', '[Embedding] Failed to load model:', errorInfo);
        throw error;
      }
    })();

    return this.loadPromise;
  }

  /**
   * Generate embedding for a single text
   * Automatically adds task-specific prefix
   *
   * @param text - Text to embed
   * @param isQuery - If true, uses query prefix; otherwise document prefix
   * @returns Embedding vector (Float32Array with dimensions specified in config)
   */
  async generateEmbedding(text: string, isQuery: boolean = false): Promise<EmbeddingVector> {
    // Ensure model is loaded
    if (this.status !== 'ready') {
      await this.loadModel();
    }

    // Add task-specific prefix
    const prefix = isQuery ? EMBEDDING_PREFIXES.query : EMBEDDING_PREFIXES.document;
    const prefixedText = prefix + text;

    try {
      // Tokenize with strict length limits to avoid WASM memory issues
      const inputs = await this.tokenizer(prefixedText, {
        padding: true,
        truncation: true,
        max_length: 512,  // Reduced from 2048 to fit in WASM memory
      });

      // Generate embedding
      const { sentence_embedding } = await this.model(inputs);

      // Extract embedding as Float32Array
      let embedding = sentence_embedding.data as Float32Array;

      // Truncate to configured dimensions using Matryoshka Representation Learning (MRL)
      // EmbeddingGemma supports truncation without retraining
      if (this.config.dimensions < 768) {
        embedding = embedding.slice(0, this.config.dimensions);
      }

      return embedding;
    } catch (error) {
      logger.error('EMBEDDINGS', '[Embedding] Error generating embedding:', error);
      throw error;
    }
  }

  /**
   * Generate embeddings for multiple texts in batch
   * More efficient than calling generateEmbedding multiple times
   *
   * @param texts - Array of texts to embed
   * @param isQuery - If true, uses query prefix; otherwise document prefix
   * @returns Array of embedding vectors
   */
  async generateEmbeddingsBatch(texts: string[], isQuery: boolean = false): Promise<EmbeddingVector[]> {
    // Ensure model is loaded
    if (this.status !== 'ready') {
      await this.loadModel();
    }

    // Add task-specific prefix to all texts
    const prefix = isQuery ? EMBEDDING_PREFIXES.query : EMBEDDING_PREFIXES.document;
    const prefixedTexts = texts.map(text => prefix + text);

    try {
      // Tokenize all texts with strict length limits
      const inputs = await this.tokenizer(prefixedTexts, {
        padding: true,
        truncation: true,
        max_length: 512,  // Reduced from 2048 to fit in WASM memory
      });

      // Generate embeddings
      const { sentence_embedding } = await this.model(inputs);

      // Extract embeddings as array of Float32Array
      const embeddings: EmbeddingVector[] = [];
      const dims = this.config.dimensions;

      for (let i = 0; i < texts.length; i++) {
        const start = i * 768; // Full dimensions
        const end = start + dims; // Truncate to configured dimensions
        const embedding = new Float32Array(sentence_embedding.data.slice(start, end));
        embeddings.push(embedding);
      }

      return embeddings;
    } catch (error) {
      logger.error('EMBEDDINGS', '[Embedding] Error generating batch embeddings:', error);
      throw error;
    }
  }

  /**
   * Calculate cosine similarity between two embeddings
   *
   * @param embedding1 - First embedding vector
   * @param embedding2 - Second embedding vector
   * @returns Similarity score (0-1, higher is more similar)
   */
  cosineSimilarity(embedding1: EmbeddingVector, embedding2: EmbeddingVector): number {
    if (embedding1.length !== embedding2.length) {
      throw new Error('Embeddings must have the same dimensions');
    }

    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;

    for (let i = 0; i < embedding1.length; i++) {
      dotProduct += embedding1[i] * embedding2[i];
      norm1 += embedding1[i] * embedding1[i];
      norm2 += embedding2[i] * embedding2[i];
    }

    const magnitude1 = Math.sqrt(norm1);
    const magnitude2 = Math.sqrt(norm2);

    if (magnitude1 === 0 || magnitude2 === 0) {
      return 0;
    }

    return dotProduct / (magnitude1 * magnitude2);
  }

  /**
   * Calculate cosine similarities between a query embedding and multiple document embeddings
   * Returns sorted array of similarity scores
   *
   * @param queryEmbedding - Query embedding vector
   * @param documentEmbeddings - Array of document embedding vectors
   * @param chunkIds - Array of chunk IDs corresponding to documentEmbeddings
   * @param topK - Number of top results to return (default: all)
   * @returns Array of {chunkId, score} sorted by score (descending)
   */
  calculateSimilarities(
    queryEmbedding: EmbeddingVector,
    documentEmbeddings: EmbeddingVector[],
    chunkIds: string[],
    topK?: number
  ): SimilarityScore[] {
    if (documentEmbeddings.length !== chunkIds.length) {
      throw new Error('documentEmbeddings and chunkIds must have the same length');
    }

    const scores: SimilarityScore[] = [];

    for (let i = 0; i < documentEmbeddings.length; i++) {
      const score = this.cosineSimilarity(queryEmbedding, documentEmbeddings[i]);
      scores.push({
        chunkId: chunkIds[i],
        score,
      });
    }

    // Sort by score (descending)
    scores.sort((a, b) => b.score - a.score);

    // Return top K if specified
    if (topK && topK < scores.length) {
      return scores.slice(0, topK);
    }

    return scores;
  }

  /**
   * Get current model status
   */
  getStatus(): EmbeddingModelStatus {
    return this.status;
  }

  /**
   * Get current model configuration
   */
  getConfig(): EmbeddingModelConfig {
    return { ...this.config };
  }

  /**
   * Update model configuration
   * Note: Requires reloading model if already loaded
   *
   * @param newConfig - New configuration (partial update)
   */
  async updateConfig(newConfig: Partial<EmbeddingModelConfig>): Promise<void> {
    const oldConfig = { ...this.config };
    this.config = { ...this.config, ...newConfig };

    // If model is loaded and config changed, reload
    if (this.status === 'ready' && JSON.stringify(oldConfig) !== JSON.stringify(this.config)) {
      logger.debug('EMBEDDINGS', '[Embedding] Config changed, reloading model...');
      this.unloadModel();
      await this.loadModel();
    }
  }

  /**
   * Unload model to free memory
   */
  unloadModel(): void {
    this.model = null;
    this.tokenizer = null;
    this.status = 'not-loaded';
    this.loadPromise = null;
    this.device = null;
    logger.debug('EMBEDDINGS', '[Embedding] Model unloaded');
  }
}

// Export singleton instance
export const embeddingService = new EmbeddingService();
