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
      console.error('[Embedding] Error checking availability:', error);
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

        // Configure Transformers.js environment to use local WASM files
        // This prevents CSP violations by loading from extension resources
        env.allowLocalModels = false;  // Not hosting models locally
        env.allowRemoteModels = true;  // Download model weights from HuggingFace Hub
        env.useBrowserCache = true;    // Use browser cache for model weights

        // Point ONNX Runtime to local WASM files bundled with the extension
        // This prevents CSP violations when loading WASM backend
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
          env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL('');
        }

        this.tokenizer = await AutoTokenizer.from_pretrained(this.config.modelId);

        // Detect and test WebGPU availability
        let targetDevice: 'webgpu' | 'wasm' = 'wasm';

        try {
          // Check if WebGPU API exists and actually works
          if (typeof navigator !== 'undefined' && 'gpu' in navigator && navigator.gpu) {
            console.log('[Embedding] WebGPU API detected, testing adapter...');
            const adapter = await navigator.gpu.requestAdapter();

            if (adapter) {
              targetDevice = 'webgpu';
              console.log('[Embedding] ✓ WebGPU adapter available, will attempt GPU acceleration');
            } else {
              console.log('[Embedding] WebGPU adapter request failed, using WASM backend');
            }
          } else {
            console.log('[Embedding] WebGPU not available, using WASM backend');
          }
        } catch (e) {
          console.log('[Embedding] Error testing WebGPU adapter, falling back to WASM:', e);
        }

        // Select optimal dtype for the target device
        const optimalDtype = getOptimalDtype(targetDevice);
        console.log(`[Embedding] 📦 Loading model with ${optimalDtype} quantization for ${targetDevice.toUpperCase()}`);
        console.log(`[Embedding] Model ID: ${this.config.modelId}`);

        // Estimated model sizes: fp32 (~300MB) for WebGPU, q4 (~80MB) for WASM
        const estimatedSize = optimalDtype === 'fp32' ? '~300MB' : '~80MB';
        console.log(`[Embedding] Estimated download size: ${estimatedSize}`);

        // Try loading with optimal settings for detected backend
        try {
          console.log(`[Embedding] ⏳ Downloading and initializing model... (this may take a minute)`);

          this.model = await AutoModel.from_pretrained(this.config.modelId, {
            dtype: optimalDtype,
            device: targetDevice,
            progress_callback: (progress: any) => {
              // Log download progress
              if (progress.status === 'download') {
                const percent = progress.loaded && progress.total
                  ? ((progress.loaded / progress.total) * 100).toFixed(1)
                  : '?';
                console.log(`[Embedding] 📥 Downloading ${progress.file}: ${percent}%`);
              } else if (progress.status === 'done') {
                console.log(`[Embedding] ✓ Downloaded ${progress.file}`);
              }
            },
          });

          this.device = targetDevice;
          this.status = 'ready';
          console.log(`[Embedding] ✅ Model loaded successfully with ${targetDevice.toUpperCase()} backend (${optimalDtype})`);
          console.log(`[Embedding] 🚀 Ready for inference!`);
        } catch (modelError) {
          // If WebGPU fails, fallback to WASM with q4
          if (targetDevice === 'webgpu') {
            console.warn('[Embedding] ❌ WebGPU model loading failed, falling back to WASM:', modelError);

            const wasmDtype = getOptimalDtype('wasm');
            console.log(`[Embedding] 🔄 Retrying with WASM backend (${wasmDtype})...`);

            this.model = await AutoModel.from_pretrained(this.config.modelId, {
              dtype: wasmDtype, // q4 for WASM
              device: 'wasm',
              progress_callback: (progress: any) => {
                if (progress.status === 'download') {
                  const percent = progress.loaded && progress.total
                    ? ((progress.loaded / progress.total) * 100).toFixed(1)
                    : '?';
                  console.log(`[Embedding] 📥 Downloading ${progress.file}: ${percent}%`);
                } else if (progress.status === 'done') {
                  console.log(`[Embedding] ✓ Downloaded ${progress.file}`);
                }
              },
            });

            this.device = 'wasm';
            this.status = 'ready';
            console.log(`[Embedding] ✅ Model loaded successfully with WASM backend (${wasmDtype}, fallback)`);
          } else {
            throw modelError;
          }
        }
      } catch (error) {
        this.status = 'error';
        console.error('[Embedding] Failed to load model:', error);
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
      console.error('[Embedding] Error generating embedding:', error);
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
      console.error('[Embedding] Error generating batch embeddings:', error);
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
      console.log('[Embedding] Config changed, reloading model...');
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
    console.log('[Embedding] Model unloaded');
  }
}

// Export singleton instance
export const embeddingService = new EmbeddingService();
