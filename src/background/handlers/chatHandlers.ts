import { MessageType, ChatMessage, ConversationState, SourceInfo } from '../../types/index.ts';
import { getPaperByUrl, getRelevantChunksSemantic, updatePaper } from '../../utils/dbService.ts';
import { aiService } from '../../utils/aiService.ts';
import { getOptimalRAGChunkCount } from '../../utils/adaptiveRAGService.ts';
import { inputQuotaService } from '../../utils/inputQuotaService.ts';
import { JSONSchema } from '../../utils/typeToSchema.ts';
import { logger } from '../../utils/logger.ts';

/**
 * Chat Message Handlers
 * Handles chat-related operations with streaming support
 */

/**
 * JSON Schema for structured chat responses
 * LLM returns: { answer: string, sources: string[] }
 */
const CHAT_RESPONSE_SCHEMA: JSONSchema = {
  type: "object",
  properties: {
    answer: {
      type: "string",
      description: `Your conversational response to the user's question.
Be friendly and helpful like a supportive colleague. Explain complex concepts in simple, everyday language avoiding unnecessary jargon.
Keep responses concise but detailed enough to answer the user's question. Be encouraging and supportive.

Math formatting with LaTeX:
- Use $expr$ for inline math, $$expr$$ for display equations
- CRITICAL: In JSON strings, backslashes must be escaped by doubling them

LaTeX Escaping Rules (CRITICAL - READ CAREFULLY):
- Every LaTeX command needs TWO backslashes in your JSON output
- Example: To render \\alpha, you must write: "The value is \\\\alpha"
- Example: To render \\theta, you must write: "The formula uses \\\\theta"
- Example: To render \\frac{a}{b}, you must write: "The fraction \\\\frac{a}{b}"

IMPORTANT - Commands that look like escape sequences:
- \\text{...} → Write as \\\\text{...} (NOT \\text which becomes tab + "ext")
- \\theta → Write as \\\\theta (NOT \\theta which could break)
- \\nabla → Write as \\\\nabla (NOT \\nabla which becomes newline + "abla")
- \\nu → Write as \\\\nu (NOT \\nu which becomes newline + "u")
- \\rho → Write as \\\\rho (NOT \\rho which becomes carriage return + "ho")
- \\times, \\tan, \\tanh → Write as \\\\times, \\\\tan, \\\\tanh
- \\ne, \\neq, \\not → Write as \\\\ne, \\\\neq, \\\\not

More examples: \\\\alpha, \\\\beta, \\\\gamma, \\\\ell, \\\\sum, \\\\int, \\\\boldsymbol{x}, \\\\frac{a}{b}

Use markdown formatting to make your response easier to read (e.g., **bold**, *italic*, bullet points, numbered lists, etc.).
Reference specific sections when used in producing answer. Remember conversation context for coherent follow-ups.`
    },
    sources: {
      type: "array",
      items: { type: "string" },
      description: "Array of hierarchical citations actually used (e.g., 'Section: Methods > Data Collection > P 3')"
    }
  },
  required: ["answer", "sources"]
};

/**
 * Extract LaTeX expressions from raw JSON string content and replace with safe placeholders
 * This protects LaTeX from being corrupted by JSON escape sequence processing
 *
 * Handles: $...$, $$...$$, \(...\), \[...\]
 * Returns: { content: string with placeholders, latex: array of extracted expressions }
 *
 * NOTE: LaTeX is stored as-is (with double backslashes from JSON). Unescaping happens
 * during rehydration to ensure correct order of operations.
 */
function extractLatexFromRawJson(content: string): { content: string; latex: string[] } {
  const latex: string[] = [];
  let processed = content;
  let counter = 0;

  // Extract display math first ($$...$$ and \[...\])
  processed = processed.replace(/\$\$([\s\S]+?)\$\$/g, (match) => {
    const placeholder = `{{LATEX_${counter}}}`;
    latex.push(match); // Store as-is with double backslashes
    counter++;
    return placeholder;
  });

  processed = processed.replace(/\\\[([\s\S]+?)\\\]/g, (match) => {
    const placeholder = `{{LATEX_${counter}}}`;
    latex.push(match); // Store as-is
    counter++;
    return placeholder;
  });

  // Extract inline math ($...$ and \(...\))
  processed = processed.replace(/\$([^\$]+?)\$/g, (match) => {
    const placeholder = `{{LATEX_${counter}}}`;
    latex.push(match); // Store as-is
    counter++;
    return placeholder;
  });

  processed = processed.replace(/\\\(([\s\S]+?)\\\)/g, (match) => {
    const placeholder = `{{LATEX_${counter}}}`;
    latex.push(match); // Store as-is
    counter++;
    return placeholder;
  });

  return { content: processed, latex };
}

/**
 * Rehydrate LaTeX expressions by replacing placeholders with original LaTeX
 * Unescapes each LaTeX expression during rehydration to convert double backslashes
 * from JSON (e.g., \\text) to single backslashes for KaTeX (e.g., \text)
 */
function rehydrateLatex(content: string, latex: string[]): string {
  let result = content;
  latex.forEach((latexExpr, index) => {
    const placeholder = `{{LATEX_${index}}}`;
    // Unescape the LaTeX expression when rehydrating (convert \\ to \)
    const unescapedLatex = unescapeJsonString(latexExpr);
    result = result.replaceAll(placeholder, unescapedLatex);
  });
  return result;
}

/**
 * Unescape JSON string literals (convert \\n to actual newlines, etc.)
 * When we extract answer from raw JSON string during streaming, it contains literal escape sequences.
 * This function converts them to actual characters for proper display.
 *
 * IMPORTANT: This should be called AFTER extractLatexFromRawJson() to avoid corrupting LaTeX!
 * LaTeX expressions like \nu, \frac, \text contain backslashes that would be misinterpreted
 * as JSON escape sequences (\n → newline, \t → tab, \f → form feed, \r → carriage return).
 *
 * Order of operations is critical:
 * 1. Replace \\\\ → placeholder (protects any double-backslashed content)
 * 2. Replace \\n → newline (JSON escape sequence)
 * 3. Replace \\" → quote (JSON escape sequence)
 * 4. Replace placeholder → \\ (restore double backslashes)
 */
function unescapeJsonString(str: string): string {
  return str
    .replace(/\\\\/g, '\x00')  // Step 1: Protect double backslashes with placeholder
    .replace(/\\n/g, '\n')     // Step 2: Convert JSON newline escape
    .replace(/\\"/g, '"')      // Step 3: Convert JSON quote escape
    .replace(/\x00/g, '\\');   // Step 4: Restore double backslashes
}

/**
 * Validate that a tab exists and is still available
 */
async function isTabValid(tabId: number): Promise<boolean> {
  try {
    const tab = await chrome.tabs.get(tabId);
    return !!tab;
  } catch (error) {
    // Tab was closed or doesn't exist
    return false;
  }
}

/**
 * Send a streaming chat message chunk to content script
 */
async function sendChatChunk(tabId: number, chunk: string): Promise<void> {
  try {
    // Validate tab exists before sending
    if (!await isTabValid(tabId)) {
      logger.warn('CHATBOX', '[ChatHandlers] Tab', tabId, 'no longer exists, skipping chunk');
      return;
    }

    await chrome.tabs.sendMessage(tabId, {
      type: MessageType.CHAT_STREAM_CHUNK,
      payload: chunk,
    });
  } catch (error) {
    logger.error('CHATBOX', '[ChatHandlers] Error sending chat chunk to tab:', error);
  }
}

/**
 * Send chat stream end message to content script
 */
async function sendChatEnd(tabId: number, fullMessage: string, sources?: string[], sourceInfo?: SourceInfo[]): Promise<void> {
  try {
    // Validate tab exists before sending
    if (!await isTabValid(tabId)) {
      logger.warn('CHATBOX', '[ChatHandlers] Tab', tabId, 'no longer exists, skipping stream end');
      return;
    }

    await chrome.tabs.sendMessage(tabId, {
      type: MessageType.CHAT_STREAM_END,
      payload: { fullMessage, sources, sourceInfo },
    });
  } catch (error) {
    logger.error('CHATBOX', '[ChatHandlers] Error sending chat end to tab:', error);
  }
}

/**
 * Estimate token usage for a given text
 * Rough estimate: ~4 characters per token
 */
function estimateTokenUsage(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Perform pre-summarization check before creating a session
 * If the estimated token usage exceeds threshold, summarize chat history
 * Returns updated conversation state (or original if no summarization needed)
 */
async function performPreSummarization(
  chatHistory: ChatMessage[],
  conversationState: ConversationState,
  paperTitle: string,
  paperId: string
): Promise<ConversationState> {
  // If no chat history, no summarization needed
  if (chatHistory.length === 0) {
    return conversationState;
  }

  // Estimate token usage from chat history
  const recentMessages = chatHistory.slice(-6);
  const recentMessagesText = recentMessages.map(m => m.content).join('\n');
  const summaryText = conversationState.summary || '';

  const estimatedTokens = estimateTokenUsage(recentMessagesText) + estimateTokenUsage(summaryText);

  // Get device-specific input quota and calculate 85% threshold
  const inputQuota = await inputQuotaService.getInputQuota();
  const QUOTA_THRESHOLD = Math.floor(inputQuota * 0.85);

  logger.debug('CHATBOX', `[Pre-Summarization] Estimated tokens: ${estimatedTokens}, Threshold: ${QUOTA_THRESHOLD} (85% of ${inputQuota})`);

  // If estimated usage is below threshold, no summarization needed
  if (estimatedTokens < QUOTA_THRESHOLD) {
    logger.debug('CHATBOX', '[Pre-Summarization] Below threshold, no summarization needed');
    return conversationState;
  }

  logger.debug('CHATBOX', '[Pre-Summarization] Above threshold, performing summarization...');

  // Determine which messages to summarize
  // If we have a summary, only summarize messages after lastSummarizedIndex
  // Otherwise, summarize all except last 6
  const messagesToSummarize = conversationState.lastSummarizedIndex >= 0
    ? chatHistory.slice(conversationState.lastSummarizedIndex + 1, -6)
    : chatHistory.slice(0, -6);

  if (messagesToSummarize.length === 0) {
    logger.debug('CHATBOX', '[Pre-Summarization] No messages to summarize');
    return conversationState;
  }

  logger.debug('CHATBOX', `[Pre-Summarization] Summarizing ${messagesToSummarize.length} messages...`);

  // Perform summarization
  const newSummary = await aiService.summarizeConversation(messagesToSummarize, paperTitle);

  if (!newSummary) {
    logger.warn('CHATBOX', '[Pre-Summarization] Summarization failed, using original state');
    return conversationState;
  }

  // Check if we need to re-summarize combined summaries
  let finalSummary: string;
  let summaryCount: number;

  if (conversationState.summary && conversationState.summaryCount >= 2) {
    // Re-summarize the combined summary to prevent unbounded growth
    logger.debug('CHATBOX', '[Pre-Summarization] Re-summarizing combined summaries (count >= 2)');
    const combinedText = `${conversationState.summary}\n\n${newSummary}`;

    // Create a temporary array with combined summary for re-summarization
    const tempMessages: ChatMessage[] = [
      { role: 'assistant', content: combinedText, timestamp: Date.now() }
    ];

    const reSummarized = await aiService.summarizeConversation(tempMessages, paperTitle);
    finalSummary = reSummarized || newSummary;
    summaryCount = 1; // Reset count after re-summarization
  } else if (conversationState.summary) {
    // Append new summary to existing one
    finalSummary = `${conversationState.summary}\n\n${newSummary}`;
    summaryCount = conversationState.summaryCount + 1;
  } else {
    // First summary
    finalSummary = newSummary;
    summaryCount = 1;
  }

  const newConversationState: ConversationState = {
    summary: finalSummary,
    recentMessages: chatHistory.slice(-6),
    lastSummarizedIndex: chatHistory.length - 7,
    summaryCount
  };

  // Save to database
  await updatePaper(paperId, {
    conversationState: newConversationState,
  });

  logger.debug('CHATBOX', `[Pre-Summarization] ✓ Summarization complete (summaryCount: ${summaryCount})`);

  return newConversationState;
}

/**
 * Process and stream chat response asynchronously
 * This runs in the background without blocking the message response
 */
async function processAndStreamResponse(
  paperUrl: string,
  message: string,
  tabId: number
): Promise<void> {
  try {
    logger.debug('CHATBOX', `[ChatHandlers] Processing chat message for paper: ${paperUrl}`);

    // Retrieve paper from IndexedDB
    const storedPaper = await getPaperByUrl(paperUrl);

    if (!storedPaper) {
      return {
        success: false,
        error: 'Paper not found in storage. Please store the paper first.',
      };
    }

    // Get conversation state for accurate token calculation
    const chatHistory = storedPaper.chatHistory || [];
    const conversationState = storedPaper.conversationState || {
      summary: null,
      recentMessages: [],
      lastSummarizedIndex: -1,
      summaryCount: 0,
    };

    // Prepare conversation state for RAG (with recent messages)
    const recentMessages = chatHistory.slice(-6);
    const ragConversationState = {
      summary: conversationState.summary,
      recentMessages: recentMessages,
    };

    // Get relevant chunks using adaptive limit (will be trimmed later by validation loop)
    const { getAdaptiveChunkLimit } = await import('../../utils/adaptiveRAGService.ts');
    const adaptiveLimit = await getAdaptiveChunkLimit(storedPaper.id, 'chat');
    const relevantChunks = await getRelevantChunksSemantic(storedPaper.id, message, adaptiveLimit);

    if (relevantChunks.length === 0) {
      return {
        success: false,
        error: 'No relevant content found to answer this question.',
      };
    }

    logger.debug('CHATBOX', `[ChatHandlers] Found ${relevantChunks.length} relevant chunks for chat message`);

    // Format context from chunks with position and hierarchy
    const contextChunks = relevantChunks.map(chunk => ({
      content: chunk.content,
      section: chunk.section || 'Unknown section',
      index: chunk.index,
      parentSection: chunk.parentSection,
      paragraphIndex: chunk.paragraphIndex,
      sentenceGroupIndex: chunk.sentenceGroupIndex,
      cssSelector: chunk.cssSelector,
      elementId: chunk.elementId,
      xPath: chunk.xPath,
      startChar: chunk.startChar,
      endChar: chunk.endChar,
    }));

    // Sort chunks by document order (index) for better context
    contextChunks.sort((a, b) => a.index - b.index);

    const sources = Array.from(new Set(contextChunks.map(c => c.section)));

    // Build sourceInfo mapping for scroll-to-source functionality
    // Maps source text to selector information from chunks
    const sourceInfoMap = new Map<string, SourceInfo>();

    for (const chunk of contextChunks) {
      // Build hierarchical citation path (same as in context string)
      const hierarchy = chunk.parentSection
        ? `${chunk.parentSection} > ${chunk.section}`
        : chunk.section;

      // Build source text (section only, no paragraph numbers)
      const sourceText = `Section: ${hierarchy}`;

      // Map all sources that have section info (not just ones with CSS selectors)
      // Text search fallback can find any section heading
      if (chunk.section && !sourceInfoMap.has(sourceText)) {
        sourceInfoMap.set(sourceText, {
          text: sourceText,
          cssSelector: chunk.cssSelector,
          elementId: chunk.elementId,
          xPath: chunk.xPath,
          sectionHeading: chunk.section,
          startChar: chunk.startChar,
          endChar: chunk.endChar,
        });
      }
    }

    // Build context string with position and natural boundary hierarchy
    const contextString = contextChunks
      .map((chunk) => {
        // Build hierarchical citation path
        const hierarchy = chunk.parentSection
          ? `${chunk.parentSection} > ${chunk.section}`
          : chunk.section;

        // Add paragraph/sentence info if available (natural boundaries)
        let citation = `[Section: ${hierarchy}`;
        if (chunk.paragraphIndex !== undefined) {
          citation += ` > P ${chunk.paragraphIndex + 1}`;
          if (chunk.sentenceGroupIndex !== undefined) {
            citation += ` > Sentences`;
          }
        }
        citation += `]`;

        return `${citation}\n${chunk.content}`;
      })
      .join('\n\n---\n\n');

    // Context ID for this paper's chat session
    const contextId = `chat-${storedPaper.id}`;

    // chatHistory and conversationState already retrieved above (lines 202-208)

    // System prompt for the chat session (WITHOUT RAG context to save quota)
    // RAG context will be included in the actual user prompt instead
    const systemPrompt = `You are Kuma, a friendly research bear assistant helping users understand research papers.

Your role:
- Answer questions about the research paper based on the provided context
- If the context doesn't contain enough information, say so honestly

Math formatting with LaTeX:
- Use $expr$ for inline math, $$expr$$ for display equations
- CRITICAL: In JSON strings, backslashes must be escaped by doubling them

LaTeX Escaping Rules (CRITICAL - READ CAREFULLY):
- Every LaTeX command needs TWO backslashes in your JSON output
- Example: To render \\alpha, you must write: "The value is \\\\alpha"
- Example: To render \\theta, you must write: "The formula uses \\\\theta"
- Example: To render \\frac{a}{b}, you must write: "The fraction \\\\frac{a}{b}"

IMPORTANT - Commands that look like escape sequences:
- \\text{...} → Write as \\\\text{...} (NOT \\text which becomes tab + "ext")
- \\theta → Write as \\\\theta (NOT \\theta which could break)
- \\nabla → Write as \\\\nabla (NOT \\nabla which becomes newline + "abla")
- \\nu → Write as \\\\nu (NOT \\nu which becomes newline + "u")
- \\rho → Write as \\\\rho (NOT \\rho which becomes carriage return + "ho")
- \\times, \\tan, \\tanh → Write as \\\\times, \\\\tan, \\\\tanh
- \\ne, \\neq, \\not → Write as \\\\ne, \\\\neq, \\\\not

More examples: \\\\alpha, \\\\beta, \\\\gamma, \\\\ell, \\\\sum, \\\\int, \\\\boldsymbol{x}, \\\\frac{a}{b}

Response Format:
You will respond with a JSON object containing:
- "answer": Your conversational response (see schema for formatting guidelines)
- "sources": An array of citations you actually used (use EXACT hierarchical format from context, e.g., "Section: Methods > Data Collection > P 3")

Only include sources you actually referenced. If you didn't use specific sources, provide an empty array.

Paper title: ${storedPaper.title}`;

    // Check if we need to create a new session with conversation history
    let session = aiService['sessions'].get(contextId);

    // If session exists, check if it needs summarization based on actual usage
    if (session) {
      const currentUsage = session.inputUsage ?? 0;
      const quota = session.inputQuota ?? 0;
      const usagePercentage = quota > 0 ? (currentUsage / quota) * 100 : 0;

      logger.debug('CHATBOX', `[ChatHandlers] Existing session usage: ${currentUsage}/${quota} (${usagePercentage.toFixed(1)}%)`);

      // If session usage is high (>70%), summarize and recreate session
      if (usagePercentage > 70 && chatHistory.length > 0) {
        logger.debug('CHATBOX', '[ChatHandlers] Session usage >70%, triggering summarization and session recreation...');

        // Perform summarization
        const updatedConversationState = await performPreSummarization(
          chatHistory,
          conversationState,
          storedPaper.title,
          storedPaper.id
        );

        // Update stored paper with new conversation state
        await chrome.storage.local.set({
          [`papers.${storedPaper.id}`]: {
            ...storedPaper,
            conversationState: updatedConversationState,
          },
        });

        // Destroy old session
        aiService.destroySessionForContext(contextId);

        // Create new session with summarized history
        let systemPromptContent = systemPrompt;
        if (updatedConversationState.summary) {
          systemPromptContent += `\n\nPrevious conversation summary: ${updatedConversationState.summary}`;
        }

        const initialPrompts: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
          { role: 'system', content: systemPromptContent }
        ];

        // Add recent messages (up to last 6 messages)
        const recentMessages = chatHistory.slice(-6);
        for (const msg of recentMessages) {
          initialPrompts.push({
            role: msg.role,
            content: msg.content
          });
        }

        session = await aiService.getOrCreateSession(contextId, { initialPrompts });
        logger.debug('CHATBOX', '[ChatHandlers] ✓ Session recreated after summarization');
      }
    } else if (chatHistory.length > 0) {
      // No session but have history - create with pre-summarization
      const updatedConversationState = await performPreSummarization(
        chatHistory,
        conversationState,
        storedPaper.title,
        storedPaper.id
      );

      // Create new session with conversation history
      logger.debug('CHATBOX', '[ChatHandlers] Creating new session with', chatHistory.length, 'historical messages');

      // Combine system prompt and conversation summary into single system message
      // (Prompt API only allows one system message at the first position)
      let systemPromptContent = systemPrompt;
      if (updatedConversationState.summary) {
        systemPromptContent += `\n\nPrevious conversation summary: ${updatedConversationState.summary}`;
      }

      const initialPrompts: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
        { role: 'system', content: systemPromptContent }
      ];

      // Add recent messages (up to last 6 messages)
      const recentMessages = chatHistory.slice(-6);
      for (const msg of recentMessages) {
        initialPrompts.push({
          role: msg.role,
          content: msg.content
        });
      }

      session = await aiService.getOrCreateSession(contextId, { initialPrompts });
    } else {
      // First message - create fresh session
      logger.debug('CHATBOX', '[ChatHandlers] Creating fresh session (first message)');
      session = await aiService.getOrCreateSession(contextId, {
        initialPrompts: [{ role: 'system', content: systemPrompt }]
      });
    }

    // Validate prompt size before sending (with summarization-first retry logic)
    let finalContextChunks = contextChunks;
    let finalContextString = contextString;
    let hasSummarized = false; // Track if we've already summarized in this validation
    const MAX_RETRIES = 4; // Increased to 4: 1 validation + 1 summarization retry + 2 chunk trim retries

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      const promptWithContext = `Context from the paper:
${finalContextString}

User question: ${message}`;

      // Validate prompt size using Chrome AI's measureInputUsage()
      const validation = await aiService.validatePromptSize(session, promptWithContext);

      if (validation.fits) {
        logger.debug('CHATBOX', `[ChatHandlers] ✓ Prompt validation passed on attempt ${attempt} (${validation.actualUsage} tokens)`);
        break;
      }

      // Prompt too large - try strategies in order: summarize first, then trim chunks
      logger.warn('CHATBOX', `[ChatHandlers] Prompt too large (${validation.actualUsage} > ${validation.available}) on attempt ${attempt}/${MAX_RETRIES}`);

      // Strategy 1: Summarize conversation (attempt 1 only, if we have history and haven't summarized yet)
      if (attempt === 1 && chatHistory.length > 3 && !hasSummarized) {
        logger.debug('CHATBOX', '[ChatHandlers] Attempting summarization to free up space for RAG context...');

        // Perform summarization
        const updatedConversationState = await performPreSummarization(
          chatHistory,
          conversationState,
          storedPaper.title,
          storedPaper.id
        );

        // Update stored paper with new conversation state
        await updatePaper(storedPaper.id, {
          conversationState: updatedConversationState,
        });

        // Destroy old session and create new one with summarized history
        aiService.destroySessionForContext(contextId);

        let systemPromptContent = systemPrompt;
        if (updatedConversationState.summary) {
          systemPromptContent += `\n\nPrevious conversation summary: ${updatedConversationState.summary}`;
        }

        const initialPrompts: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
          { role: 'system', content: systemPromptContent }
        ];

        // Add recent messages (up to last 6 messages)
        const recentHistoryMessages = chatHistory.slice(-6);
        for (const msg of recentHistoryMessages) {
          initialPrompts.push({
            role: msg.role,
            content: msg.content
          });
        }

        session = await aiService.getOrCreateSession(contextId, { initialPrompts });
        hasSummarized = true;
        logger.debug('CHATBOX', '[ChatHandlers] ✓ Summarization complete, session recreated. Retrying validation...');
        continue; // Retry validation with same chunks but new session
      }

      // Strategy 2: Trim chunks (attempts 2-3)
      if (attempt < MAX_RETRIES) {
        logger.debug('CHATBOX', `[ChatHandlers] Trimming chunks (attempt ${attempt})...`);
        // Remove last 2 chunks and retry (but keep at least 1 chunk)
        const newLength = Math.max(1, finalContextChunks.length - 2);
        finalContextChunks = finalContextChunks.slice(0, newLength);
      } else {
        // Strategy 3: Final fallback - use minimal chunks (just 1-2 most relevant)
        logger.error('CHATBOX', `[ChatHandlers] Max retries reached, using minimal chunks`);
        finalContextChunks = contextChunks.slice(0, Math.min(2, contextChunks.length));
      }

      if (finalContextChunks.length === 0) {
        logger.error('CHATBOX', '[ChatHandlers] No chunks remaining after trimming');
        return {
          success: false,
          error: 'Context too large even after aggressive trimming. Try a shorter question or use a model with larger context.'
        };
      }

      // Rebuild context string with fewer chunks
      finalContextString = finalContextChunks
        .map((chunk) => {
          const hierarchy = chunk.parentSection
            ? `${chunk.parentSection} > ${chunk.section}`
            : chunk.section;

          let citation = `[Section: ${hierarchy}`;
          if (chunk.paragraphIndex !== undefined) {
            citation += ` > P ${chunk.paragraphIndex + 1}`;
            if (chunk.sentenceGroupIndex !== undefined) {
              citation += ` > Sentences`;
            }
          }
          citation += `]`;

          return `${citation}\n${chunk.content}`;
        })
        .join('\n\n---\n\n');
    }

    // Stream the response
    // Include RAG context in the actual prompt (not in initialPrompts) to save quota
    const promptWithContext = `Context from the paper:
${finalContextString}

User question: ${message}`;

    // Stream response with structured output constraint
    // Pattern: {"answer": "text here...", "sources": ["src1", "src2"]}
    let fullResponseJSON = '';
    const stream = session.promptStreaming(promptWithContext, { responseConstraint: CHAT_RESPONSE_SCHEMA });

    // Lookahead buffer to prevent showing closing JSON pattern
    // Pattern is the literal JSON structure: ", "sources
    const CLOSING_PATTERN = '", "sources';
    const LOOKAHEAD_SIZE = CLOSING_PATTERN.length; // 11 characters
    let lastSentLength = 0;
    let answer = '';
    let extractedSources: string[] = [];
    let shouldStopDisplaying = false; // Flag to stop sending to user but continue accumulating JSON

    logger.debug('CHATBOX', '[ChatHandlers] 🔄 Starting structured streaming...');

    for await (const chunk of stream) {
      fullResponseJSON += chunk;

      // Find the answer field boundaries
      if (!fullResponseJSON.includes('"answer"')) continue;

      const answerStart = fullResponseJSON.indexOf('"answer"');
      const colonIndex = fullResponseJSON.indexOf(':', answerStart);
      const openQuoteIndex = fullResponseJSON.indexOf('"', colonIndex + 1);

      if (openQuoteIndex === -1) continue;

      // Extract current answer content (everything after the opening quote)
      const currentAnswer = fullResponseJSON.substring(openQuoteIndex + 1);

      // Check if closing pattern appears anywhere in accumulated answer
      if (!shouldStopDisplaying && currentAnswer.includes(CLOSING_PATTERN)) {
        // Found the pattern! Extract answer up to (but not including) the pattern
        const patternIndex = currentAnswer.indexOf(CLOSING_PATTERN);
        const rawAnswer = currentAnswer.substring(0, patternIndex);

        // Protect LaTeX from JSON escape sequence corruption
        const { content: rawWithPlaceholders, latex: extractedLatex } = extractLatexFromRawJson(rawAnswer);
        const unescapedWithPlaceholders = unescapeJsonString(rawWithPlaceholders);
        answer = rehydrateLatex(unescapedWithPlaceholders, extractedLatex);

        // Send any remaining content that wasn't sent yet
        // Extract from unescaped content since lastSentLength tracks unescaped position
        const finalDelta = answer.substring(lastSentLength);
        if (finalDelta) {
          await sendChatChunk(tabId, finalDelta);
        }

        shouldStopDisplaying = true; // Stop sending to user but continue loop to get full JSON
      }

      // Pattern not found yet - continue streaming with lookahead buffer delay
      // Only stream if we have more than the buffer size (maintains 11-char delay)
      if (!shouldStopDisplaying && currentAnswer.length > LOOKAHEAD_SIZE) {
        let visibleContent = currentAnswer.substring(0, currentAnswer.length - LOOKAHEAD_SIZE);

        // Hold back trailing backslash to prevent incomplete escape sequences
        // If visibleContent ends with \, don't include it (wait for next char to see if it's \n, \t, etc.)
        if (visibleContent.endsWith('\\')) {
          visibleContent = visibleContent.slice(0, -1);
        }

        // Protect LaTeX from JSON escape sequence corruption
        // Process FULL visible content, then extract delta
        const { content: visibleWithPlaceholders, latex: extractedLatex } = extractLatexFromRawJson(visibleContent);
        const unescapedWithPlaceholders = unescapeJsonString(visibleWithPlaceholders);
        const unescapedVisible = rehydrateLatex(unescapedWithPlaceholders, extractedLatex);

        const newDelta = unescapedVisible.substring(lastSentLength);

        if (newDelta) {
          await sendChatChunk(tabId, newDelta);
          lastSentLength = unescapedVisible.length; // Track position in unescaped content
        }
      }
      // If less than 11 chars accumulated, keep buffering (don't send yet)
    }

    logger.debug('CHATBOX', '[ChatHandlers] ✓ Chat response streamed successfully');

    // Parse final JSON to extract sources
    try {
      const parsed = JSON.parse(fullResponseJSON);
      // Use parsed answer if we somehow missed it during streaming
      if (!answer) {
        const rawAnswer = parsed.answer || '';
        // Apply same LaTeX protection as streaming (fallback path)
        const { content: rawWithPlaceholders, latex: extractedLatex } = extractLatexFromRawJson(rawAnswer);
        const unescapedWithPlaceholders = unescapeJsonString(rawWithPlaceholders);
        answer = rehydrateLatex(unescapedWithPlaceholders, extractedLatex);
      }
      extractedSources = parsed.sources || [];
      logger.debug('CHATBOX', '[ChatHandlers] Parsed sources:', extractedSources);
    } catch (error) {
      logger.error('CHATBOX', '[ChatHandlers] Failed to parse final JSON:', error);
      // Use streamed answer, empty sources
      extractedSources = [];
    }

    // Map extracted sources to sourceInfo for scroll-to-source functionality
    const sourceInfoArray: SourceInfo[] = extractedSources
      .map(sourceText => {
        // Normalize by stripping paragraph numbers: "Section: Methods > P 3" → "Section: Methods"
        const normalized = sourceText.replace(/\s*>\s*P\s+\d+(\s*>\s*Sentences)?$/, '');
        return sourceInfoMap.get(normalized);
      })
      .filter((info): info is SourceInfo => info !== undefined);

    logger.debug('CHATBOX', '[ChatHandlers] Mapped sourceInfo:', sourceInfoArray.length, 'out of', extractedSources.length);

    // Send end signal with final answer and sources
    await sendChatEnd(tabId, answer.trim(), extractedSources, sourceInfoArray);

    // Post-stream processing: token tracking and summarization
    // Wrapped in try-catch to prevent failures from affecting the successful stream
    try {
      // Track token usage
      const metadata = aiService.getSessionMetadata(contextId);

      if (metadata) {
        logger.debug('CHATBOX', `[ChatHandlers] Token usage: ${metadata.usagePercentage.toFixed(2)}% (${metadata.inputUsage}/${metadata.inputQuota})`);

        // Check if we need to summarize and clone session
        if (metadata.needsSummarization) {
          logger.debug('CHATBOX', '[ChatHandlers] Token threshold reached (>= 80%), triggering summarization...');

          // Update chat history with new messages
          const newChatHistory: ChatMessage[] = [
            ...chatHistory,
            { role: 'user', content: message, timestamp: Date.now() },
            { role: 'assistant', content: answer.trim(), timestamp: Date.now(), sources: extractedSources, sourceInfo: sourceInfoArray }
          ];

          // Determine which messages to summarize (all except last 6)
          const messagesToSummarize = newChatHistory.slice(
            conversationState.lastSummarizedIndex + 1,
            -6
          );

          if (messagesToSummarize.length > 0) {
            logger.debug('CHATBOX', `[ChatHandlers] Summarizing ${messagesToSummarize.length} messages...`);

            const newSummary = await aiService.summarizeConversation(
              messagesToSummarize,
              storedPaper.title
            );

            // Handle summary growth: re-summarize after 2 summaries to prevent unbounded growth
            let finalSummary: string;
            let summaryCount: number;

            if (conversationState.summary && conversationState.summaryCount >= 2) {
              // Re-summarize the combined summary to prevent unbounded growth
              logger.debug('CHATBOX', '[Post-Stream] Re-summarizing combined summaries (count >= 2)');
              const combinedText = `${conversationState.summary}\n\n${newSummary}`;

              // Create a temporary array with combined summary for re-summarization
              const tempMessages: ChatMessage[] = [
                { role: 'assistant', content: combinedText, timestamp: Date.now() }
              ];

              const reSummarized = await aiService.summarizeConversation(tempMessages, storedPaper.title);
              finalSummary = reSummarized || newSummary;
              summaryCount = 1; // Reset count after re-summarization
            } else if (conversationState.summary) {
              // Append new summary to existing one
              finalSummary = `${conversationState.summary}\n\n${newSummary}`;
              summaryCount = conversationState.summaryCount + 1;
            } else {
              // First summary
              finalSummary = newSummary;
              summaryCount = 1;
            }

            // Update conversation state
            const newConversationState: ConversationState = {
              summary: finalSummary,
              recentMessages: newChatHistory.slice(-6),
              lastSummarizedIndex: newChatHistory.length - 7, // Index of last summarized message
              summaryCount
            };

            // Clone session with updated history
            await aiService.cloneSessionWithHistory(
              contextId,
              newConversationState,
              systemPrompt
            );

            // Save updated state to database
            await updatePaper(storedPaper.id, {
              chatHistory: newChatHistory,
              conversationState: newConversationState,
            });

            logger.debug('CHATBOX', '[ChatHandlers] ✓ Session cloned with summarized history');
          }
        }
      }
    } catch (postProcessError) {
      // Log post-processing errors but don't fail the request
      // The stream was successful and user already received their response
      logger.error('CHATBOX', '[ChatHandlers] Post-stream processing error (non-critical):', postProcessError);
      logger.error('CHATBOX', '[ChatHandlers] Token tracking or summarization failed, but message was delivered successfully');
    }

  } catch (error) {
    logger.error('CHATBOX', '[ChatHandlers] Error processing chat message:', error);

    // Send error as a message to the chat
    await sendChatEnd(
      tabId,
      'Sorry, I encountered an error processing your message. Please try again.',
      []
    );
  }
}

/**
 * Handle sending a chat message with streaming response
 * Returns immediately to prevent message channel timeout
 * Actual streaming happens asynchronously
 */
export async function handleSendChatMessage(payload: any, sender: chrome.runtime.MessageSender): Promise<any> {
  const { paperUrl, message } = payload;
  const tabId = sender.tab?.id;

  if (!paperUrl || !message) {
    return {
      success: false,
      error: 'Paper URL and message are required',
    };
  }

  if (!tabId) {
    return {
      success: false,
      error: 'Tab ID is required for streaming responses',
    };
  }

  // Start streaming in background (don't block on it)
  processAndStreamResponse(paperUrl, message, tabId).catch(error => {
    logger.error('CHATBOX', '[ChatHandlers] Unhandled streaming error:', error);
  });

  // Return success immediately to prevent message channel timeout
  // Actual response will come via CHAT_STREAM_CHUNK and CHAT_STREAM_END messages
  return { success: true };
}

/**
 * Update chat history for a paper
 */
export async function handleUpdateChatHistory(payload: any): Promise<any> {
  const { paperUrl, chatHistory } = payload;

  if (!paperUrl || !chatHistory) {
    return {
      success: false,
      error: 'Paper URL and chat history are required',
    };
  }

  try {
    logger.debug('CHATBOX', `[ChatHandlers] Updating chat history for paper: ${paperUrl}`);

    // Get the paper
    const storedPaper = await getPaperByUrl(paperUrl);

    if (!storedPaper) {
      return {
        success: false,
        error: 'Paper not found in storage',
      };
    }

    // Update the chat history
    await updatePaper(storedPaper.id, { chatHistory });

    logger.debug('CHATBOX', '[ChatHandlers] ✓ Chat history updated successfully');
    return { success: true };
  } catch (error) {
    logger.error('CHATBOX', '[ChatHandlers] Error updating chat history:', error);
    return {
      success: false,
      error: `Failed to update chat history: ${String(error)}`,
    };
  }
}

/**
 * Get chat history for a paper
 */
export async function handleGetChatHistory(payload: any): Promise<any> {
  const { paperUrl } = payload;

  if (!paperUrl) {
    return {
      success: false,
      error: 'Paper URL is required',
    };
  }

  try {
    logger.debug('CHATBOX', `[ChatHandlers] Getting chat history for paper: ${paperUrl}`);

    // Get the paper
    const storedPaper = await getPaperByUrl(paperUrl);

    if (!storedPaper) {
      return {
        success: false,
        error: 'Paper not found in storage',
      };
    }

    const chatHistory = storedPaper.chatHistory || [];
    logger.debug('CHATBOX', `[ChatHandlers] ✓ Retrieved ${chatHistory.length} chat messages`);

    return { success: true, chatHistory };
  } catch (error) {
    logger.error('CHATBOX', '[ChatHandlers] Error getting chat history:', error);
    return {
      success: false,
      error: `Failed to get chat history: ${String(error)}`,
    };
  }
}

/**
 * Clear chat history for a paper
 * Also destroys the session to start fresh
 */
export async function handleClearChatHistory(payload: any): Promise<any> {
  const { paperUrl } = payload;

  if (!paperUrl) {
    return {
      success: false,
      error: 'Paper URL is required',
    };
  }

  try {
    logger.debug('CHATBOX', `[ChatHandlers] Clearing chat history for paper: ${paperUrl}`);

    // Get the paper
    const storedPaper = await getPaperByUrl(paperUrl);

    if (!storedPaper) {
      return {
        success: false,
        error: 'Paper not found in storage',
      };
    }

    // Clear the chat history and conversation state
    await updatePaper(storedPaper.id, {
      chatHistory: [],
      conversationState: {
        summary: null,
        recentMessages: [],
        lastSummarizedIndex: -1,
        summaryCount: 0,
      },
    });

    // Destroy the session to start fresh
    const contextId = `chat-${storedPaper.id}`;
    aiService.destroySessionForContext(contextId);

    logger.debug('CHATBOX', '[ChatHandlers] ✓ Chat history cleared and session destroyed');
    return { success: true };
  } catch (error) {
    logger.error('CHATBOX', '[ChatHandlers] Error clearing chat history:', error);
    return {
      success: false,
      error: `Failed to clear chat history: ${String(error)}`,
    };
  }
}

/**
 * IMAGE CHAT HANDLERS (Multi-tabbed Chatbox)
 * Handle multimodal chat about specific images with reduced RAG context
 */

/**
 * Process and stream image chat response asynchronously
 * Similar to processAndStreamResponse but with multimodal support and reduced RAG
 */
async function processAndStreamImageChatResponse(
  paperId: string,
  imageUrl: string,
  imageBlob: Blob,
  message: string,
  tabId: number
): Promise<void> {
  try {
    logger.debug('CHATBOX', `[ImageChatHandlers] Processing image chat message for paper: ${paperId}, image: ${imageUrl}`);

    // Retrieve paper from IndexedDB
    const storedPaper = await getPaperByUrl(imageUrl); // Will fail, need to get by ID
    // Actually, we need to get paper by ID, not URL
    const { getPaperById } = await import('../../utils/dbService.ts');
    const paper = await getPaperById(paperId);

    if (!paper) {
      await sendImageChatEnd(tabId, 'Paper not found in storage. Please store the paper first.', []);
      return;
    }

    // Get relevant chunks using adaptive limit (will be trimmed later by validation loop)
    const { getAdaptiveChunkLimit } = await import('../../utils/adaptiveRAGService.ts');
    const adaptiveLimit = await getAdaptiveChunkLimit(paperId, 'chat');
    const relevantChunks = await getRelevantChunksSemantic(paperId, message, adaptiveLimit);

    if (relevantChunks.length === 0) {
      await sendImageChatEnd(tabId, 'No relevant content found to answer this question.', []);
      return;
    }

    logger.debug('CHATBOX', `[ImageChatHandlers] Found ${relevantChunks.length} relevant chunks for image chat message`);

    // Format context from chunks with position and hierarchy
    const contextChunks = relevantChunks.map(chunk => ({
      content: chunk.content,
      section: chunk.section || 'Unknown section',
      index: chunk.index,
      parentSection: chunk.parentSection,
      paragraphIndex: chunk.paragraphIndex,
      sentenceGroupIndex: chunk.sentenceGroupIndex,
      cssSelector: chunk.cssSelector,
      elementId: chunk.elementId,
      xPath: chunk.xPath,
      startChar: chunk.startChar,
      endChar: chunk.endChar,
    }));

    // Sort chunks by document order (index) for better context
    contextChunks.sort((a, b) => a.index - b.index);

    const sources = Array.from(new Set(contextChunks.map(c => c.section)));

    // Build sourceInfo mapping for scroll-to-source functionality
    // Maps source text to selector information from chunks
    const sourceInfoMap = new Map<string, SourceInfo>();

    for (const chunk of contextChunks) {
      // Build hierarchical citation path (same as in context string)
      const hierarchy = chunk.parentSection
        ? `${chunk.parentSection} > ${chunk.section}`
        : chunk.section;

      // Build source text (section only, no paragraph numbers)
      const sourceText = `Section: ${hierarchy}`;

      // Map all sources that have section info (not just ones with CSS selectors)
      // Text search fallback can find any section heading
      if (chunk.section && !sourceInfoMap.has(sourceText)) {
        sourceInfoMap.set(sourceText, {
          text: sourceText,
          cssSelector: chunk.cssSelector,
          elementId: chunk.elementId,
          xPath: chunk.xPath,
          sectionHeading: chunk.section,
          startChar: chunk.startChar,
          endChar: chunk.endChar,
        });
      }
    }

    // Build context string with position and natural boundary hierarchy
    const contextString = contextChunks
      .map((chunk) => {
        // Build hierarchical citation path
        const hierarchy = chunk.parentSection
          ? `${chunk.parentSection} > ${chunk.section}`
          : chunk.section;

        // Add paragraph/sentence info if available (natural boundaries)
        let citation = `[Section: ${hierarchy}`;
        if (chunk.paragraphIndex !== undefined) {
          citation += ` > P ${chunk.paragraphIndex + 1}`;
          if (chunk.sentenceGroupIndex !== undefined) {
            citation += ` > Sentences`;
          }
        }
        citation += `]`;

        return `${citation}\n${chunk.content}`;
      })
      .join('\n\n---\n\n');

    // Context ID for this image's chat session
    const { getImageChat, updateImageChat } = await import('../../utils/dbService.ts');

    // Generate hash for image URL (same logic as in dbService)
    let hash = 0;
    for (let i = 0; i < imageUrl.length; i++) {
      const char = imageUrl.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    const contextId = `image-chat-${paperId}-img_${Math.abs(hash)}`;

    // chatHistory and conversationState already retrieved above for RAG (lines 824-830)
    // But for imageChat, we need to get from imageChat object, not paper object
    const imageChat = await getImageChat(paperId, imageUrl);
    const imageChatHistory = imageChat?.chatHistory || [];
    const imageChatConversationState = imageChat?.conversationState || {
      summary: null,
      recentMessages: [],
      lastSummarizedIndex: -1,
      summaryCount: 0,
    };

    // System prompt for image chat (multimodal)
    const systemPrompt = `You are Kuma, a friendly research bear assistant helping users understand images from research papers.

Your role:
- Answer questions about the image and how it relates to the paper
- If the context doesn't contain enough information, say so honestly

Math formatting with LaTeX:
- Use $expr$ for inline math, $$expr$$ for display equations
- CRITICAL: In JSON strings, backslashes must be escaped by doubling them

LaTeX Escaping Rules (CRITICAL - READ CAREFULLY):
- Every LaTeX command needs TWO backslashes in your JSON output
- Example: To render \\alpha, you must write: "The value is \\\\alpha"
- Example: To render \\theta, you must write: "The formula uses \\\\theta"
- Example: To render \\frac{a}{b}, you must write: "The fraction \\\\frac{a}{b}"

IMPORTANT - Commands that look like escape sequences:
- \\text{...} → Write as \\\\text{...} (NOT \\text which becomes tab + "ext")
- \\theta → Write as \\\\theta (NOT \\theta which could break)
- \\nabla → Write as \\\\nabla (NOT \\nabla which becomes newline + "abla")
- \\nu → Write as \\\\nu (NOT \\nu which becomes newline + "u")
- \\rho → Write as \\\\rho (NOT \\rho which becomes carriage return + "ho")
- \\times, \\tan, \\tanh → Write as \\\\times, \\\\tan, \\\\tanh
- \\ne, \\neq, \\not → Write as \\\\ne, \\\\neq, \\\\not

More examples: \\\\alpha, \\\\beta, \\\\gamma, \\\\ell, \\\\sum, \\\\int, \\\\boldsymbol{x}, \\\\frac{a}{b}

Response Format:
You will respond with a JSON object containing:
- "answer": Your conversational response (see schema for formatting guidelines)
- "sources": An array of citations you actually used (use EXACT hierarchical format from context, e.g., "Section: Methods > Data Collection > P 3")

Only include sources you actually referenced. If you didn't use specific sources, provide an empty array.

Paper title: ${paper.title}`;

    // Check if we need to create a new session with conversation history
    let session = aiService['sessions'].get(contextId);

    // If session exists, check if it needs summarization based on actual usage
    if (session) {
      const currentUsage = session.inputUsage ?? 0;
      const quota = session.inputQuota ?? 0;
      const usagePercentage = quota > 0 ? (currentUsage / quota) * 100 : 0;

      logger.debug('CHATBOX', `[ImageChatHandlers] Existing session usage: ${currentUsage}/${quota} (${usagePercentage.toFixed(1)}%)`);

      // If session usage is high (>70%), summarize and recreate session
      if (usagePercentage > 70 && imageChatHistory.length > 0) {
        logger.debug('CHATBOX', '[ImageChatHandlers] Session usage >70%, triggering summarization and session recreation...');

        // Perform summarization
        const updatedConversationState = await performPreSummarization(
          imageChatHistory,
          imageChatConversationState,
          paper.title,
          paperId
        );

        // Update stored image chat with new conversation state
        await updateImageChat(paperId, imageUrl, {
          conversationState: updatedConversationState,
        });

        // Destroy old session
        aiService.destroySessionForContext(contextId);

        // Create new session with summarized history
        let systemPromptContent = systemPrompt;
        if (updatedConversationState.summary) {
          systemPromptContent += `\n\nPrevious conversation summary: ${updatedConversationState.summary}`;
        }

        const initialPrompts: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
          { role: 'system', content: systemPromptContent }
        ];

        // Add recent messages (up to last 6)
        const recentMessages = imageChatHistory.slice(-6);
        for (const msg of recentMessages) {
          initialPrompts.push({
            role: msg.role,
            content: msg.content
          });
        }

        session = await aiService.getOrCreateSession(contextId, {
          initialPrompts,
          expectedInputs: [{ type: 'image', languages: ['en'] }]
        });
        logger.debug('CHATBOX', '[ImageChatHandlers] ✓ Session recreated after summarization');
      }
    } else if (imageChatHistory.length > 0) {
      // No session but have history - create with pre-summarization
      const updatedConversationState = await performPreSummarization(
        imageChatHistory,
        imageChatConversationState,
        paper.title,
        paperId
      );

      // Create new multimodal session with conversation history
      logger.debug('CHATBOX', '[ImageChatHandlers] Creating new multimodal session with', imageChatHistory.length, 'historical messages');

      let systemPromptContent = systemPrompt;
      if (updatedConversationState.summary) {
        systemPromptContent += `\n\nPrevious conversation summary: ${updatedConversationState.summary}`;
      }

      const initialPrompts: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
        { role: 'system', content: systemPromptContent }
      ];

      // Add recent messages (up to last 6)
      const recentMessages = imageChatHistory.slice(-6);
      for (const msg of recentMessages) {
        initialPrompts.push({
          role: msg.role,
          content: msg.content
        });
      }

      session = await aiService.getOrCreateSession(contextId, {
        initialPrompts,
        expectedInputs: [{ type: 'image', languages: ['en'] }] // Enable multimodal
      });
    } else {
      // First message - create fresh multimodal session
      logger.debug('CHATBOX', '[ImageChatHandlers] Creating fresh multimodal session (first message)');
      session = await aiService.getOrCreateSession(contextId, {
        initialPrompts: [{ role: 'system', content: systemPrompt }],
        expectedInputs: [{ type: 'image', languages: ['en'] }] // Enable multimodal
      });
    }

    // Validate prompt size before sending (with summarization-first retry logic)
    let finalContextChunks = contextChunks;
    let finalContextString = contextString;
    let hasSummarized = false; // Track if we've already summarized in this validation
    const MAX_RETRIES = 4; // Increased to 4: 1 validation + 1 summarization retry + 2 chunk trim retries

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      const promptWithContext = `Context from the paper:
${finalContextString}

User question: ${message}`;

      // Validate prompt size using Chrome AI's measureInputUsage()
      // Note: For multimodal, we validate the text part (image tokens are fixed)
      const validation = await aiService.validatePromptSize(session, promptWithContext);

      if (validation.fits) {
        logger.debug('CHATBOX', `[ImageChatHandlers] ✓ Prompt validation passed on attempt ${attempt} (${validation.actualUsage} tokens)`);
        break;
      }

      // Prompt too large - try strategies in order: summarize first, then trim chunks
      logger.warn('CHATBOX', `[ImageChatHandlers] Prompt too large (${validation.actualUsage} > ${validation.available}) on attempt ${attempt}/${MAX_RETRIES}`);

      // Strategy 1: Summarize conversation (attempt 1 only, if we have history and haven't summarized yet)
      if (attempt === 1 && imageChatHistory.length > 3 && !hasSummarized) {
        logger.debug('CHATBOX', '[ImageChatHandlers] Attempting summarization to free up space for RAG context...');

        // Perform summarization
        const updatedConversationState = await performPreSummarization(
          imageChatHistory,
          imageChatConversationState,
          `Image from ${storedPaper.title}`,
          paperId
        );

        // Update stored image chat with new conversation state
        await updateImageChat(paperId, imageUrl, {
          conversationState: updatedConversationState,
        });

        // Destroy old session and create new one with summarized history
        aiService.destroySessionForContext(contextId);

        // Recreate multimodal session with summarized history
        let systemPromptContent = systemPrompt;
        if (updatedConversationState.summary) {
          systemPromptContent += `\n\nPrevious conversation summary: ${updatedConversationState.summary}`;
        }

        const initialPrompts: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
          { role: 'system', content: systemPromptContent }
        ];

        // Add recent messages (up to last 6 messages)
        const recentHistoryMessages = imageChatHistory.slice(-6);
        for (const msg of recentHistoryMessages) {
          initialPrompts.push({
            role: msg.role,
            content: msg.content
          });
        }

        session = await aiService.getOrCreateSession(contextId, { initialPrompts });
        hasSummarized = true;
        logger.debug('CHATBOX', '[ImageChatHandlers] ✓ Summarization complete, session recreated. Retrying validation...');
        continue; // Retry validation with same chunks but new session
      }

      // Strategy 2: Trim chunks (attempts 2-3)
      if (attempt < MAX_RETRIES) {
        logger.debug('CHATBOX', `[ImageChatHandlers] Trimming chunks (attempt ${attempt})...`);
        // Remove last 2 chunks and retry (but keep at least 1 chunk)
        const newLength = Math.max(1, finalContextChunks.length - 2);
        finalContextChunks = finalContextChunks.slice(0, newLength);
      } else {
        // Strategy 3: Final fallback - use minimal chunks (just 1-2 most relevant)
        logger.error('CHATBOX', `[ImageChatHandlers] Max retries reached, using minimal chunks`);
        finalContextChunks = contextChunks.slice(0, Math.min(2, contextChunks.length));
      }

      if (finalContextChunks.length === 0) {
        logger.error('CHATBOX', '[ImageChatHandlers] No chunks remaining after trimming');
        await sendImageChatEnd(tabId, 'Context too large even after aggressive trimming. Try a shorter question or use a model with larger context.', []);
        return;
      }

      // Rebuild context string with fewer chunks
      finalContextString = finalContextChunks
        .map((chunk) => {
          const hierarchy = chunk.parentSection
            ? `${chunk.parentSection} > ${chunk.section}`
            : chunk.section;

          let citation = `[Section: ${hierarchy}`;
          if (chunk.paragraphIndex !== undefined) {
            citation += ` > P ${chunk.paragraphIndex + 1}`;
            if (chunk.sentenceGroupIndex !== undefined) {
              citation += ` > Sentences`;
            }
          }
          citation += `]`;

          return `${citation}\n${chunk.content}`;
        })
        .join('\n\n---\n\n');
    }

    // Prepare multimodal message with image and text
    const promptWithContext = `Context from the paper:
${finalContextString}

User question: ${message}`;

    // Use append() for multimodal input (image + text)
    await session.append([
      {
        role: 'user',
        content: [
          { type: 'image', value: imageBlob },
          { type: 'text', value: promptWithContext }
        ]
      }
    ]);

    // Get streaming response with structured output constraint
    // Pattern: {"answer": "text here...", "sources": ["src1", "src2"]}
    let fullResponseJSON = '';
    const stream = session.promptStreaming('', { responseConstraint: CHAT_RESPONSE_SCHEMA });  // Empty prompt since we already appended the message

    // Lookahead buffer to prevent showing closing JSON pattern
    // Pattern is the literal JSON structure: ", "sources
    const CLOSING_PATTERN = '", "sources';
    const LOOKAHEAD_SIZE = CLOSING_PATTERN.length; // 11 characters
    let lastSentLength = 0;
    let answer = '';
    let extractedSources: string[] = [];
    let shouldStopDisplaying = false; // Flag to stop sending to user but continue accumulating JSON

    logger.debug('CHATBOX', '[ImageChatHandlers] 🔄 Starting structured streaming...');

    for await (const chunk of stream) {
      fullResponseJSON += chunk;

      // Find the answer field boundaries
      if (!fullResponseJSON.includes('"answer"')) continue;

      const answerStart = fullResponseJSON.indexOf('"answer"');
      const colonIndex = fullResponseJSON.indexOf(':', answerStart);
      const openQuoteIndex = fullResponseJSON.indexOf('"', colonIndex + 1);

      if (openQuoteIndex === -1) continue;

      // Extract current answer content (everything after the opening quote)
      const currentAnswer = fullResponseJSON.substring(openQuoteIndex + 1);

      // Check if closing pattern appears anywhere in accumulated answer
      if (!shouldStopDisplaying && currentAnswer.includes(CLOSING_PATTERN)) {
        // Found the pattern! Extract answer up to (but not including) the pattern
        const patternIndex = currentAnswer.indexOf(CLOSING_PATTERN);
        const rawAnswer = currentAnswer.substring(0, patternIndex);

        // Protect LaTeX from JSON escape sequence corruption
        const { content: rawWithPlaceholders, latex: extractedLatex } = extractLatexFromRawJson(rawAnswer);
        const unescapedWithPlaceholders = unescapeJsonString(rawWithPlaceholders);
        answer = rehydrateLatex(unescapedWithPlaceholders, extractedLatex);

        // Send any remaining content that wasn't sent yet
        // Extract from unescaped content since lastSentLength tracks unescaped position
        const finalDelta = answer.substring(lastSentLength);
        if (finalDelta) {
          await sendImageChatChunk(tabId, finalDelta);
        }

        shouldStopDisplaying = true; // Stop sending to user but continue loop to get full JSON
      }

      // Pattern not found yet - continue streaming with lookahead buffer delay
      // Only stream if we have more than the buffer size (maintains 11-char delay)
      if (!shouldStopDisplaying && currentAnswer.length > LOOKAHEAD_SIZE) {
        let visibleContent = currentAnswer.substring(0, currentAnswer.length - LOOKAHEAD_SIZE);

        // Hold back trailing backslash to prevent incomplete escape sequences
        // If visibleContent ends with \, don't include it (wait for next char to see if it's \n, \t, etc.)
        if (visibleContent.endsWith('\\')) {
          visibleContent = visibleContent.slice(0, -1);
        }

        // Protect LaTeX from JSON escape sequence corruption
        // Process FULL visible content, then extract delta
        const { content: visibleWithPlaceholders, latex: extractedLatex } = extractLatexFromRawJson(visibleContent);
        const unescapedWithPlaceholders = unescapeJsonString(visibleWithPlaceholders);
        const unescapedVisible = rehydrateLatex(unescapedWithPlaceholders, extractedLatex);

        const newDelta = unescapedVisible.substring(lastSentLength);

        if (newDelta) {
          await sendImageChatChunk(tabId, newDelta);
          lastSentLength = unescapedVisible.length; // Track position in unescaped content
        }
      }
      // If less than 11 chars accumulated, keep buffering (don't send yet)
    }

    logger.debug('CHATBOX', '[ImageChatHandlers] ✓ Image chat response streamed successfully');

    // Parse final JSON to extract sources
    try {
      const parsed = JSON.parse(fullResponseJSON);
      // Use parsed answer if we somehow missed it during streaming
      if (!answer) {
        const rawAnswer = parsed.answer || '';
        // Apply same LaTeX protection as streaming (fallback path)
        const { content: rawWithPlaceholders, latex: extractedLatex } = extractLatexFromRawJson(rawAnswer);
        const unescapedWithPlaceholders = unescapeJsonString(rawWithPlaceholders);
        answer = rehydrateLatex(unescapedWithPlaceholders, extractedLatex);
      }
      extractedSources = parsed.sources || [];
      logger.debug('CHATBOX', '[ImageChatHandlers] Parsed sources:', extractedSources);
    } catch (error) {
      logger.error('CHATBOX', '[ImageChatHandlers] Failed to parse final JSON:', error);
      // Use streamed answer, empty sources
      extractedSources = [];
    }

    // Map extracted sources to sourceInfo for scroll-to-source functionality
    const sourceInfoArray: SourceInfo[] = extractedSources
      .map(sourceText => {
        // Normalize by stripping paragraph numbers: "Section: Methods > P 3" → "Section: Methods"
        const normalized = sourceText.replace(/\s*>\s*P\s+\d+(\s*>\s*Sentences)?$/, '');
        return sourceInfoMap.get(normalized);
      })
      .filter((info): info is SourceInfo => info !== undefined);

    logger.debug('CHATBOX', '[ImageChatHandlers] Mapped sourceInfo:', sourceInfoArray.length, 'out of', extractedSources.length);

    // Send end signal with final answer and sources
    await sendImageChatEnd(tabId, answer.trim(), extractedSources, sourceInfoArray);

    // Post-stream processing: save history and check for summarization
    try {
      // Update chat history with new messages
      const newChatHistory = [
        ...imageChatHistory,
        { role: 'user' as const, content: message, timestamp: Date.now() },
        { role: 'assistant' as const, content: answer.trim(), timestamp: Date.now(), sources: extractedSources, sourceInfo: sourceInfoArray }
      ];

      // Save to IndexedDB
      await updateImageChat(paperId, imageUrl, {
        chatHistory: newChatHistory,
        conversationState: imageChatConversationState,
      });

      // Track token usage
      const metadata = aiService.getSessionMetadata(contextId);

      if (metadata && metadata.needsSummarization) {
        logger.debug('CHATBOX', '[ImageChatHandlers] Token threshold reached, triggering summarization...');

        // Summarize messages
        const messagesToSummarize = newChatHistory.slice(
          imageChatConversationState.lastSummarizedIndex + 1,
          -6
        );

        if (messagesToSummarize.length > 0) {
          const newSummary = await aiService.summarizeConversation(messagesToSummarize, paper.title);

          let finalSummary: string;
          let summaryCount: number;

          if (imageChatConversationState.summary && imageChatConversationState.summaryCount >= 2) {
            // Re-summarize combined summaries
            const combinedText = `${imageChatConversationState.summary}\n\n${newSummary}`;
            const tempMessages = [
              { role: 'assistant' as const, content: combinedText, timestamp: Date.now() }
            ];
            const reSummarized = await aiService.summarizeConversation(tempMessages, paper.title);
            finalSummary = reSummarized || newSummary;
            summaryCount = 1;
          } else if (imageChatConversationState.summary) {
            finalSummary = `${imageChatConversationState.summary}\n\n${newSummary}`;
            summaryCount = imageChatConversationState.summaryCount + 1;
          } else {
            finalSummary = newSummary;
            summaryCount = 1;
          }

          const newConversationState = {
            summary: finalSummary,
            recentMessages: newChatHistory.slice(-6),
            lastSummarizedIndex: newChatHistory.length - 7,
            summaryCount
          };

          // Clone session with updated history (preserve multimodal image support)
          await aiService.cloneSessionWithHistory(
            contextId,
            newConversationState,
            systemPrompt,
            {
              expectedInputs: [{ type: 'image', languages: ['en'] }]
            }
          );

          // Save updated state
          await updateImageChat(paperId, imageUrl, {
            chatHistory: newChatHistory,
            conversationState: newConversationState,
          });

          logger.debug('CHATBOX', '[ImageChatHandlers] ✓ Session cloned with summarized history');
        }
      }
    } catch (postProcessError) {
      logger.error('CHATBOX', '[ImageChatHandlers] Post-stream processing error:', postProcessError);
    }

  } catch (error) {
    logger.error('CHATBOX', '[ImageChatHandlers] Error processing image chat message:', error);
    await sendImageChatEnd(tabId, 'Sorry, I encountered an error processing your message. Please try again.', []);
  }
}

/**
 * Send image chat stream chunk to content script
 */
async function sendImageChatChunk(tabId: number, chunk: string): Promise<void> {
  try {
    if (!await isTabValid(tabId)) {
      logger.warn('CHATBOX', '[ImageChatHandlers] Tab', tabId, 'no longer exists, skipping chunk');
      return;
    }

    await chrome.tabs.sendMessage(tabId, {
      type: MessageType.IMAGE_CHAT_STREAM_CHUNK,
      payload: chunk,
    });
  } catch (error) {
    logger.error('CHATBOX', '[ImageChatHandlers] Error sending image chat chunk:', error);
  }
}

/**
 * Send image chat stream end to content script
 */
async function sendImageChatEnd(tabId: number, fullMessage: string, sources?: string[], sourceInfo?: SourceInfo[]): Promise<void> {
  try {
    if (!await isTabValid(tabId)) {
      logger.warn('CHATBOX', '[ImageChatHandlers] Tab', tabId, 'no longer exists, skipping stream end');
      return;
    }

    await chrome.tabs.sendMessage(tabId, {
      type: MessageType.IMAGE_CHAT_STREAM_END,
      payload: { fullMessage, sources, sourceInfo },
    });
  } catch (error) {
    logger.error('CHATBOX', '[ImageChatHandlers] Error sending image chat end:', error);
  }
}

/**
 * Handle sending an image chat message with streaming response
 */
export async function handleSendImageChatMessage(payload: any, sender: chrome.runtime.MessageSender): Promise<any> {
  const { paperId, imageUrl, imageDataBase64, imageMimeType, message } = payload;
  const tabId = sender.tab?.id;

  if (!paperId || !imageUrl || !imageDataBase64 || !imageMimeType || !message) {
    return {
      success: false,
      error: 'Paper ID, image URL, image data (Base64), image MIME type, and message are required',
    };
  }

  if (!tabId) {
    return {
      success: false,
      error: 'Tab ID is required for streaming responses',
    };
  }

  // Reconstruct Blob from Base64 string (Chrome messaging uses JSON serialization)
  const binaryString = atob(imageDataBase64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  const imageBlob = new Blob([bytes], { type: imageMimeType });
  logger.debug('CHATBOX', '[ImageChatHandlers] Reconstructed blob from Base64:', imageBlob.size, 'bytes, type:', imageBlob.type);

  // Start streaming in background
  processAndStreamImageChatResponse(paperId, imageUrl, imageBlob, message, tabId).catch(error => {
    logger.error('CHATBOX', '[ImageChatHandlers] Unhandled streaming error:', error);
  });

  // Return success immediately
  return { success: true };
}

/**
 * Get image chat history
 */
export async function handleGetImageChatHistory(payload: any): Promise<any> {
  const { paperId, imageUrl } = payload;

  if (!paperId || !imageUrl) {
    return {
      success: false,
      error: 'Paper ID and image URL are required',
    };
  }

  try {
    logger.debug('CHATBOX', `[ImageChatHandlers] Getting image chat history for image: ${imageUrl}`);

    const { getImageChat } = await import('../../utils/dbService.ts');
    const imageChat = await getImageChat(paperId, imageUrl);

    const chatHistory = imageChat?.chatHistory || [];
    logger.debug('CHATBOX', `[ImageChatHandlers] ✓ Retrieved ${chatHistory.length} image chat messages`);

    return { success: true, chatHistory };
  } catch (error) {
    logger.error('CHATBOX', '[ImageChatHandlers] Error getting image chat history:', error);
    return {
      success: false,
      error: `Failed to get image chat history: ${String(error)}`,
    };
  }
}

/**
 * Update image chat history
 */
export async function handleUpdateImageChatHistory(payload: any): Promise<any> {
  const { paperId, imageUrl, chatHistory } = payload;

  if (!paperId || !imageUrl || !chatHistory) {
    return {
      success: false,
      error: 'Paper ID, image URL, and chat history are required',
    };
  }

  try {
    logger.debug('CHATBOX', `[ImageChatHandlers] Updating image chat history for image: ${imageUrl}`);

    const { updateImageChat } = await import('../../utils/dbService.ts');
    await updateImageChat(paperId, imageUrl, { chatHistory });

    logger.debug('CHATBOX', '[ImageChatHandlers] ✓ Image chat history updated successfully');
    return { success: true };
  } catch (error) {
    logger.error('CHATBOX', '[ImageChatHandlers] Error updating image chat history:', error);
    return {
      success: false,
      error: `Failed to update image chat history: ${String(error)}`,
    };
  }
}

/**
 * Clear image chat history
 */
export async function handleClearImageChatHistory(payload: any): Promise<any> {
  const { paperId, imageUrl } = payload;

  if (!paperId || !imageUrl) {
    return {
      success: false,
      error: 'Paper ID and image URL are required',
    };
  }

  try {
    logger.debug('CHATBOX', `[ImageChatHandlers] Clearing image chat history for image: ${imageUrl}`);

    const { deleteImageChat } = await import('../../utils/dbService.ts');
    await deleteImageChat(paperId, imageUrl);

    // Destroy the session
    let hash = 0;
    for (let i = 0; i < imageUrl.length; i++) {
      const char = imageUrl.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    const contextId = `image-chat-${paperId}-img_${Math.abs(hash)}`;
    aiService.destroySessionForContext(contextId);

    logger.debug('CHATBOX', '[ImageChatHandlers] ✓ Image chat history cleared and session destroyed');
    return { success: true };
  } catch (error) {
    logger.error('CHATBOX', '[ImageChatHandlers] Error clearing image chat history:', error);
    return {
      success: false,
      error: `Failed to clear image chat history: ${String(error)}`,
    };
  }
}
