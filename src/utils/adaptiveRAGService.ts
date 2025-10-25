/**
 * Adaptive RAG Service
 * Provides dynamic chunk count calculation for RAG retrieval based on inputQuota
 * Ensures retrieved chunks + prompt + response fit within context window
 */

import { inputQuotaService } from './inputQuotaService.ts';
import { getPaperById } from './dbService.ts';

/**
 * Get optimal number of RAG chunks to retrieve for a given use case
 * Adapts based on user's Gemini Nano inputQuota and paper's average chunk size
 *
 * @param useCase - The type of operation (chat, qa, analysis, definition)
 * @param avgChunkSize - Average chunk size from paper metadata (optional)
 * @returns Optimal number of chunks to retrieve (2-8)
 */
export async function getOptimalRAGChunkCount(
  useCase: 'chat' | 'qa' | 'analysis' | 'definition',
  avgChunkSize?: number
): Promise<number> {
  return await inputQuotaService.getOptimalRAGChunkCount(useCase, avgChunkSize);
}

/**
 * Get all optimal chunk counts for different use cases
 * Useful for debugging or displaying to user
 */
export async function getAllOptimalCounts(): Promise<{
  chat: number;
  qa: number;
  analysis: number;
  definition: number;
}> {
  const [chat, qa, analysis, definition] = await Promise.all([
    getOptimalRAGChunkCount('chat'),
    getOptimalRAGChunkCount('qa'),
    getOptimalRAGChunkCount('analysis'),
    getOptimalRAGChunkCount('definition'),
  ]);

  return { chat, qa, analysis, definition };
}

/**
 * Get adaptive chunk limit for retrieval based on paper's average chunk size
 * Returns a higher limit (oversampled) which will be trimmed later by token budget
 *
 * Strategy:
 * - Large chunks (>1000 chars) → 3x multiplier (conservative)
 * - Small/medium chunks (≤1000 chars) → 4x multiplier (aggressive)
 * - Apply dynamic cap based on chunk size to prevent performance issues
 *
 * @param paperId - Paper ID to look up chunk statistics
 * @param useCase - The type of operation (chat, qa, analysis, definition)
 * @returns Number of chunks to retrieve (before trimming by token budget)
 */
export async function getAdaptiveChunkLimit(
  paperId: string,
  useCase: 'chat' | 'qa' | 'analysis' | 'definition'
): Promise<number> {
  // Get paper's average chunk size from metadata
  const paper = await getPaperById(paperId);
  const avgChunkSize = paper?.metadata?.averageChunkSize || 500; // Default 500 chars

  // Get optimal count from existing logic (baseline), passing avgChunkSize
  const optimalCount = await getOptimalRAGChunkCount(useCase, avgChunkSize);

  // Determine multiplier based on average chunk size
  let multiplier: number;
  if (avgChunkSize > 1000) {
    multiplier = 3; // Large chunks → conservative (3x)
  } else {
    multiplier = 4; // Small/medium chunks → aggressive (4x)
  }

  const oversampledCount = optimalCount * multiplier;

  // Calculate dynamic cap based on average chunk size
  let dynamicCap: number;
  if (avgChunkSize < 500) {
    dynamicCap = 40; // Many small chunks (short paragraphs)
  } else if (avgChunkSize < 1000) {
    dynamicCap = 30; // Medium chunks
  } else {
    dynamicCap = 20; // Large chunks (long paragraphs)
  }

  const adaptiveLimit = Math.min(oversampledCount, dynamicCap);

  console.log(`[Adaptive RAG] Paper avgChunkSize=${avgChunkSize}, multiplier=${multiplier}x, limit=${adaptiveLimit} (optimal=${optimalCount}, cap=${dynamicCap})`);

  return adaptiveLimit;
}

/**
 * Trim chunks by token budget
 * Takes oversampled chunks (sorted by relevance) and trims to fit within inputQuota
 * Accounts for chunk label overhead and includes minimum 2 chunks when possible
 *
 * @param chunks - Array of chunks sorted by relevance (most relevant first)
 * @param useCase - The type of operation (affects prompt size estimate)
 * @returns Object with trimmed chunks and budget status
 */
export async function trimChunksByTokenBudget(
  chunks: import('../types/index.ts').ContentChunk[],
  useCase: 'chat' | 'qa' | 'analysis' | 'definition'
): Promise<{
  chunks: import('../types/index.ts').ContentChunk[];
  budgetStatus: {
    availableTokens: number;
    usedTokens: number;
    minChunksFit: boolean;
    needsSummarization: boolean;
  };
}> {
  const inputQuota = await inputQuotaService.getInputQuota();

  // Estimated prompt sizes for different use cases (in tokens)
  // These estimates account for system prompts, conversation history, and formatting overhead
  const promptEstimates = {
    chat: 800,       // System (250) + Summary (300) + Recent messages (200) + overhead (50)
    qa: 350,         // System prompt + question
    analysis: 300,   // Analysis-specific prompt
    definition: 250  // Definition lookup prompt
  };

  const estimatedPromptTokens = promptEstimates[useCase];
  const responseBuffer = 500; // Reserve tokens for LLM response

  // Calculate available tokens for chunks
  const availableTokens = inputQuota - estimatedPromptTokens - responseBuffer;

  // Apply 65% safety margin to account for token estimation inaccuracies
  // (chars/4 is rough, actual tokens may be higher)
  const conservativeTokens = Math.floor(availableTokens * 0.65);

  console.log(`[Adaptive RAG] Available tokens: ${availableTokens}, Conservative (65%): ${conservativeTokens}`);

  // Add chunks in relevance order until budget exhausted
  const selectedChunks: import('../types/index.ts').ContentChunk[] = [];
  let currentTokens = 0;

  const MIN_CHUNKS = 2; // Minimum chunks for meaningful context

  for (const chunk of chunks) {
    const chunkTokens = chunk.tokenCount;

    // Calculate overhead for chunk label and separator
    // Label format: "[Section: Parent > Child > Para N]" ≈ 15 tokens
    const labelOverhead = 15;
    // Separator: "\n\n---\n\n" between chunks ≈ 2 tokens
    const separatorOverhead = selectedChunks.length > 0 ? 2 : 0;
    const totalChunkCost = chunkTokens + labelOverhead + separatorOverhead;

    // Try to include minimum chunks, but only if they won't catastrophically exceed budget
    if (selectedChunks.length < MIN_CHUNKS) {
      // Allow up to 20% overflow for minimum chunks (relative to conservative limit)
      if (currentTokens + totalChunkCost < conservativeTokens * 1.2) {
        selectedChunks.push(chunk);
        currentTokens += totalChunkCost;
      } else {
        // Even minimum chunk would blow budget - stop here
        console.warn(`[Adaptive RAG] Cannot fit minimum chunks - budget too tight (need ${currentTokens + totalChunkCost}, have ${conservativeTokens})`);
        break;
      }
      continue;
    }

    // After minimum, strictly enforce conservative budget
    if (currentTokens + totalChunkCost > conservativeTokens) {
      break;
    }

    selectedChunks.push(chunk);
    currentTokens += totalChunkCost;
  }

  const minChunksFit = selectedChunks.length >= MIN_CHUNKS;
  const needsSummarization = currentTokens > conservativeTokens * 0.9 || !minChunksFit;

  console.log(`[Adaptive RAG] Trimmed ${chunks.length} → ${selectedChunks.length} chunks (${currentTokens}/${conservativeTokens} conservative, ${availableTokens} available, minFit=${minChunksFit})`);

  if (!minChunksFit) {
    console.warn(`[Adaptive RAG] Only ${selectedChunks.length} chunks fit (need ${MIN_CHUNKS}) - summarization recommended`);
  }

  return {
    chunks: selectedChunks,
    budgetStatus: {
      availableTokens,
      usedTokens: currentTokens,
      minChunksFit,
      needsSummarization,
    },
  };
}

/**
 * Check if RAG should be used based on available quota
 * Returns false if quota is too small to support RAG effectively
 */
export async function shouldUseRAG(): Promise<boolean> {
  const inputQuota = await inputQuotaService.getInputQuota();

  // Need at least 512 tokens for minimal RAG (prompt + 1-2 small chunks + response)
  return inputQuota >= 512;
}

/**
 * Get recommended chunk count with explanation
 * Useful for user-facing information
 */
export async function getRecommendationWithExplanation(
  useCase: 'chat' | 'qa' | 'analysis' | 'definition'
): Promise<{
  chunkCount: number;
  inputQuota: number;
  explanation: string;
}> {
  const chunkCount = await getOptimalRAGChunkCount(useCase);
  const inputQuota = await inputQuotaService.getInputQuota();

  const explanations = {
    chat: `Based on your ${inputQuota}-token context window, retrieving ${chunkCount} chunks for conversational context`,
    qa: `Based on your ${inputQuota}-token context window, retrieving ${chunkCount} chunks for question answering`,
    analysis: `Based on your ${inputQuota}-token context window, retrieving ${chunkCount} chunks for paper analysis`,
    definition: `Based on your ${inputQuota}-token context window, retrieving ${chunkCount} chunks for term definitions`,
  };

  return {
    chunkCount,
    inputQuota,
    explanation: explanations[useCase],
  };
}
