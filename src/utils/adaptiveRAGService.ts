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
 * Calculate actual prompt tokens based on real conversation state
 * Provides accurate token estimation instead of fixed estimates
 */
function calculateActualPromptTokens(
  useCase: 'chat' | 'qa' | 'analysis' | 'definition',
  conversationState?: {
    summary?: string | null;
    recentMessages?: Array<{ content: string }>;
  }
): { promptTokens: number; breakdown: { system: number; summary: number; messages: number; overhead: number } } {
  // Base system prompts (measured from actual prompts)
  const systemPromptSizes = {
    chat: 250,
    qa: 150,
    analysis: 150,
    definition: 100,
  };

  const systemTokens = systemPromptSizes[useCase];

  // Calculate summary tokens (if exists)
  const summaryText = conversationState?.summary || '';
  const summaryTokens = summaryText ? Math.ceil(summaryText.length / 4) : 0;

  // Calculate recent messages tokens (if exist)
  const recentMessages = conversationState?.recentMessages || [];
  const messagesText = recentMessages.map(m => m.content).join('\n');
  const messagesTokens = messagesText ? Math.ceil(messagesText.length / 4) : 0;

  // Overhead for formatting, labels, separators
  const overheadTokens = 50;

  const totalPromptTokens = systemTokens + summaryTokens + messagesTokens + overheadTokens;

  return {
    promptTokens: totalPromptTokens,
    breakdown: {
      system: systemTokens,
      summary: summaryTokens,
      messages: messagesTokens,
      overhead: overheadTokens,
    },
  };
}

/**
 * Trim chunks by token budget
 * Takes oversampled chunks (sorted by relevance) and trims to fit within inputQuota
 * Uses minimum token threshold (1000 tokens) instead of minimum chunk count
 *
 * @param chunks - Array of chunks sorted by relevance (most relevant first)
 * @param useCase - The type of operation (affects prompt size estimate)
 * @param conversationState - Optional conversation state for accurate token calculation (chat only)
 * @returns Object with trimmed chunks and budget status
 */
export async function trimChunksByTokenBudget(
  chunks: import('../types/index.ts').ContentChunk[],
  useCase: 'chat' | 'qa' | 'analysis' | 'definition',
  conversationState?: {
    summary?: string | null;
    recentMessages?: Array<{ content: string }>;
  }
): Promise<{
  chunks: import('../types/index.ts').ContentChunk[];
  budgetStatus: {
    availableTokens: number;
    usedTokens: number;
    minTokensFit: boolean;
    needsSummarization: boolean;
    conversationTokens?: number;
    recentMessageCount?: number;
  };
}> {
  const inputQuota = await inputQuotaService.getInputQuota();

  // Use actual prompt token calculation instead of fixed estimates
  const { promptTokens, breakdown } = calculateActualPromptTokens(useCase, conversationState);
  const responseBuffer = 500; // Reserve tokens for LLM response

  // Calculate available tokens for chunks
  const availableTokens = inputQuota - promptTokens - responseBuffer;

  // Apply adaptive safety margin:
  // - Chat: 75% (less conservative, since we're measuring actual conversation)
  // - Other use cases: 65% (more conservative, no conversation history)
  const safetyMargin = useCase === 'chat' ? 0.75 : 0.65;
  const conservativeTokens = Math.floor(availableTokens * safetyMargin);

  console.log(`[Adaptive RAG] InputQuota=${inputQuota}, Prompt breakdown: system=${breakdown.system}, summary=${breakdown.summary}, messages=${breakdown.messages}, overhead=${breakdown.overhead}`);
  console.log(`[Adaptive RAG] Available tokens: ${availableTokens}, Conservative (${Math.floor(safetyMargin * 100)}%): ${conservativeTokens}`);

  // Add chunks in relevance order until budget exhausted
  const selectedChunks: import('../types/index.ts').ContentChunk[] = [];
  let currentTokens = 0;

  // Use minimum token threshold instead of minimum chunk count
  // 1000 tokens ≈ 4000 chars of content (substantial context)
  const MIN_TOKENS = 1000;

  for (const chunk of chunks) {
    const chunkTokens = chunk.tokenCount;

    // Calculate overhead for chunk label and separator
    // Label format: "[Section: Parent > Child > Para N]" ≈ 15 tokens
    const labelOverhead = 15;
    // Separator: "\n\n---\n\n" between chunks ≈ 2 tokens
    const separatorOverhead = selectedChunks.length > 0 ? 2 : 0;
    const totalChunkCost = chunkTokens + labelOverhead + separatorOverhead;

    // Try to include minimum tokens, but only if they won't catastrophically exceed budget
    if (currentTokens < MIN_TOKENS) {
      // Allow up to 20% overflow for minimum token threshold (relative to conservative limit)
      if (currentTokens + totalChunkCost < conservativeTokens * 1.2) {
        selectedChunks.push(chunk);
        currentTokens += totalChunkCost;
      } else {
        // Even minimum would blow budget - stop here
        console.warn(`[Adaptive RAG] Cannot fit minimum tokens - budget too tight (need ${currentTokens + totalChunkCost}, have ${conservativeTokens})`);
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

  const minTokensFit = currentTokens >= MIN_TOKENS;
  const needsSummarization = currentTokens > conservativeTokens * 0.9 || !minTokensFit;

  const conversationTokens = breakdown.summary + breakdown.messages;
  const recentMessageCount = conversationState?.recentMessages?.length || 0;

  console.log(`[Adaptive RAG] Trimmed ${chunks.length} → ${selectedChunks.length} chunks (${currentTokens}/${conservativeTokens} conservative, ${availableTokens} available)`);
  console.log(`[Adaptive RAG] minTokensFit=${minTokensFit} (${currentTokens} >= ${MIN_TOKENS}), conversationTokens=${conversationTokens}, recentMsgCount=${recentMessageCount}`);

  if (!minTokensFit) {
    console.warn(`[Adaptive RAG] Only ${currentTokens} tokens fit (need ${MIN_TOKENS}) - conversation reduction recommended`);
  }

  return {
    chunks: selectedChunks,
    budgetStatus: {
      availableTokens,
      usedTokens: currentTokens,
      minTokensFit,
      needsSummarization,
      conversationTokens,
      recentMessageCount,
    },
  };
}

/**
 * Progressive conversation history reduction
 * Tries to fit chunks by progressively reducing conversation history
 * Returns the best result with minimal conversation history needed
 *
 * @param chunks - Array of chunks sorted by relevance
 * @param useCase - The type of operation
 * @param conversationState - Current conversation state
 * @returns Best trim result with reduced conversation if needed
 */
export async function trimChunksWithProgressiveFallback(
  chunks: import('../types/index.ts').ContentChunk[],
  useCase: 'chat' | 'qa' | 'analysis' | 'definition',
  conversationState?: {
    summary?: string | null;
    recentMessages?: Array<{ content: string }>;
  }
): Promise<{
  chunks: import('../types/index.ts').ContentChunk[];
  budgetStatus: {
    availableTokens: number;
    usedTokens: number;
    minTokensFit: boolean;
    needsSummarization: boolean;
    conversationTokens?: number;
    recentMessageCount?: number;
  };
  reducedRecentMessages?: number; // How many messages we reduced to (if fallback used)
}> {
  // Level 1: Try with full conversation history (6 recent messages)
  let result = await trimChunksByTokenBudget(chunks, useCase, conversationState);

  if (result.budgetStatus.minTokensFit) {
    console.log('[Adaptive RAG] Level 1: Full conversation history - chunks fit ✓');
    return result;
  }

  // Level 2: Reduce to 3 recent messages
  if (conversationState?.recentMessages && conversationState.recentMessages.length > 3) {
    console.log('[Adaptive RAG] Level 2: Reducing to 3 recent messages...');
    const reducedState = {
      ...conversationState,
      recentMessages: conversationState.recentMessages.slice(-3),
    };
    result = await trimChunksByTokenBudget(chunks, useCase, reducedState);

    if (result.budgetStatus.minTokensFit) {
      console.log('[Adaptive RAG] Level 2: Reduced to 3 messages - chunks fit ✓');
      return { ...result, reducedRecentMessages: 3 };
    }
  }

  // Level 3: Reduce to 1 recent message
  if (conversationState?.recentMessages && conversationState.recentMessages.length > 1) {
    console.log('[Adaptive RAG] Level 3: Reducing to 1 recent message...');
    const reducedState = {
      ...conversationState,
      recentMessages: conversationState.recentMessages.slice(-1),
    };
    result = await trimChunksByTokenBudget(chunks, useCase, reducedState);

    if (result.budgetStatus.minTokensFit) {
      console.log('[Adaptive RAG] Level 3: Reduced to 1 message - chunks fit ✓');
      return { ...result, reducedRecentMessages: 1 };
    }
  }

  // Level 4: Summary only (no recent messages)
  if (conversationState?.recentMessages && conversationState.recentMessages.length > 0) {
    console.log('[Adaptive RAG] Level 4: Summary only (no recent messages)...');
    const reducedState = {
      ...conversationState,
      recentMessages: [],
    };
    result = await trimChunksByTokenBudget(chunks, useCase, reducedState);

    if (result.budgetStatus.minTokensFit) {
      console.log('[Adaptive RAG] Level 4: Summary only - chunks fit ✓');
      return { ...result, reducedRecentMessages: 0 };
    }
  }

  // All fallback levels exhausted - return best effort result
  console.warn('[Adaptive RAG] All fallback levels exhausted - returning best effort result');
  return result;
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
