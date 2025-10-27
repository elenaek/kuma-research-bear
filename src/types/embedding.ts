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
 * Combines semantic and keyword search for better coverage
 */
export interface HybridSearchConfig {
  /**
   * Whether to use hybrid search (semantic + keyword)
   * If false, falls back to semantic-only search
   */
  enabled: boolean;

  /**
   * Weight for semantic search score (0-1)
   * Keyword search gets (1 - alpha)
   * Higher values favor semantic understanding
   * Lower values favor exact keyword matches
   * Default: 0.7 (70% semantic, 30% keyword)
   */
  alpha: number;
}

/**
 * Default hybrid search configuration
 * Balanced approach favoring semantic understanding
 */
export const DEFAULT_HYBRID_CONFIG: HybridSearchConfig = {
  enabled: true,
  alpha: 0.7, // 70% semantic, 30% keyword
};

/**
 * Get optimal dtype for a given backend
 * WebGPU: fp32 (native GPU operations, ~300MB, better parallelization)
 * WASM: q4 (optimized for CPU, ~80MB, fallback)
 */
export function getOptimalDtype(device: 'webgpu' | 'wasm'): 'fp32' | 'q8' | 'q4' {
  return device === 'webgpu' ? 'fp32' : 'q4';
}
