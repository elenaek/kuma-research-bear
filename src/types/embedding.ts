/**
 * Type definitions for EmbeddingGemma integration
 * Supports semantic search and RAG functionality
 */

/**
 * Embedding model configuration options
 */
export interface EmbeddingModelConfig {
  /**
   * Model ID from HuggingFace
   * Default: "onnx-community/embeddinggemma-300m-ONNX"
   */
  modelId: string;

  /**
   * Quantization type for model
   * - fp32: Full precision (~300-400MB)
   * - q8: 8-bit quantization (~150-180MB)
   * - q4: 4-bit quantization (~80-100MB, recommended)
   */
  dtype: 'fp32' | 'q8' | 'q4';

  /**
   * Embedding dimension after truncation
   * EmbeddingGemma supports Matryoshka Representation Learning (MRL)
   * Full: 768, Truncated: 512, 256, 128
   * Default: 256 (good balance of accuracy and storage)
   */
  dimensions: 768 | 512 | 256 | 128;
}

/**
 * Embedding vector type
 * Represents the semantic embedding of a text chunk
 */
export type EmbeddingVector = Float32Array;

/**
 * Similarity score between query and document
 */
export interface SimilarityScore {
  chunkId: string;
  score: number;
}

/**
 * Status of embedding model
 */
export type EmbeddingModelStatus =
  | 'not-loaded'
  | 'loading'
  | 'ready'
  | 'error'
  | 'unavailable';

/**
 * Embedding service capabilities
 */
export interface EmbeddingCapabilities {
  available: boolean;
  status: EmbeddingModelStatus;
  modelConfig?: EmbeddingModelConfig;
  device?: 'webgpu' | 'wasm';  // Backend device being used
  error?: string;
}

/**
 * Task-specific prefixes for EmbeddingGemma
 * These prefixes improve embedding quality for specific use cases
 */
export const EMBEDDING_PREFIXES = {
  query: 'task: search result | query: ',
  document: 'title: none | text: ',
} as const;

/**
 * Default embedding model configuration
 * Uses q4 quantization for both WebGPU and WASM (~80MB model size)
 */
export const DEFAULT_EMBEDDING_CONFIG: EmbeddingModelConfig = {
  modelId: 'onnx-community/embeddinggemma-300m-ONNX',
  dtype: 'q4', // 4-bit quantization for both backends
  dimensions: 256, // Balance between accuracy and storage
};

/**
 * Hybrid search configuration
 * Combines semantic embeddings and BM25 lexical search for better coverage
 */
export interface HybridSearchConfig {
  /**
   * Whether to use hybrid search (semantic + BM25)
   * If false, falls back to semantic-only search
   */
  enabled: boolean;

  /**
   * Weight for semantic search score (0-1)
   * BM25 search gets (1 - alpha)
   * Higher values favor semantic understanding
   * Lower values favor exact term matches
   * Default: 0.7 (70% semantic, 30% BM25)
   */
  alpha: number;

  /**
   * BM25 algorithm parameters
   */
  bm25: {
    /**
     * Term frequency saturation parameter
     * Controls how quickly term frequency plateaus
     * Higher values = less saturation (repeated terms help more)
     * Typical range: 1.2-2.0
     * Default: 1.5 (standard value)
     */
    k1: number;

    /**
     * Length normalization parameter
     * Controls impact of document length on scoring
     * 0 = no normalization, 1 = full normalization
     * Typical range: 0.5-0.9
     * Default: 0.75 (standard value)
     */
    b: number;
  };
}

/**
 * Default hybrid search configuration
 * Balanced approach favoring semantic understanding with standard BM25 parameters
 */
export const DEFAULT_HYBRID_CONFIG: HybridSearchConfig = {
  enabled: true,
  alpha: 0.7, // 70% semantic, 30% BM25
  bm25: {
    k1: 1.5,  // Standard term frequency saturation
    b: 0.75   // Standard length normalization
  }
};

/**
 * Get optimal dtype for a given backend
 * WebGPU: fp32 (native GPU operations, ~300MB, better parallelization)
 * WASM: q4 (optimized for CPU, ~80MB, fallback)
 */
export function getOptimalDtype(device: 'webgpu' | 'wasm'): 'fp32' | 'q8' | 'q4' {
  return device === 'webgpu' ? 'fp32' : 'q4';
}
