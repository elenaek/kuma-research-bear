import { QuestionAnswer } from '../../../shared/types/index.ts';
import { BaseAIStrategy } from './BaseAIStrategy.ts';
import { buildQAPrompt } from '../../../shared/prompts/templates/qa.ts';
import { getOutputLanguage, getPersona, getPurpose, getVerbosity } from '../../../shared/utils/settingsService.ts';

/**
 * Strategy for answering questions about research papers using RAG
 * Validates prompt size and retries with fewer chunks if needed
 */
export class QAStrategy extends BaseAIStrategy {
  /**
   * Answer a question using retrieved context chunks from the paper
   * Implements adaptive chunk trimming if prompt is too large
   */
  async answerQuestion(
    question: string,
    contextChunks: Array<{
      content: string;
      section?: string;
      index: number;
      parentSection?: string;
      paragraphIndex?: number;
      sentenceGroupIndex?: number;
    }>,
    contextId: string = 'qa'
  ): Promise<QuestionAnswer> {
    this.logDebug('Answering question using RAG...');

    // Get user's preferred output language
    const outputLanguage = await getOutputLanguage();

    // Validate and trim chunks if needed (with retry logic)
    let finalContextChunks = contextChunks;
    const MAX_RETRIES = 3;

    const buildContext = (chunks: typeof contextChunks) => {
      return chunks
        .map((chunk) => {
          // Build hierarchical citation path
          const hierarchy = chunk.parentSection
            ? `${chunk.parentSection} > ${chunk.section || 'Unknown'}`
            : (chunk.section || 'Unknown section');

          // Add paragraph/sentence info if available (natural boundaries)
          let citation = `[${hierarchy}`;
          if (chunk.paragraphIndex !== undefined) {
            citation += ` > Para ${chunk.paragraphIndex + 1}`;
            if (chunk.sentenceGroupIndex !== undefined) {
              citation += ` > Sentences`;
            }
          }
          citation += `]`;

          return `${citation}\n${chunk.content}`;
        })
        .join('\n\n---\n\n');
    };

    const persona = await getPersona();
    const purpose = await getPurpose();
    const verbosity = await getVerbosity();
    const systemPrompt = buildQAPrompt(outputLanguage as 'en' | 'es' | 'ja', persona, purpose, verbosity);

    // Include language in context ID to ensure separate sessions per language
    const languageContextId = `${contextId}-${outputLanguage}`;

    // Create session first for validation
    const session = await this.getOrCreateSession(languageContextId, {
      systemPrompt,
      expectedInputs: [{ type: "text", languages: ["en", "es", "ja"] }],
      expectedOutputs: [{ type: "text", languages: [outputLanguage || "en"] }],
      temperature: 0.0,
      topK: 1
    });

    // Validate prompt size with retry logic
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      const context = buildContext(finalContextChunks);
      const input = `Based on the following excerpts from a research paper, answer this question:

Question: ${question}

Paper Context:
${context}

Provide a clear, accurate answer based on the information above.
Use markdown formatting for better readability:
- Use **bold** for key findings or important concepts
- Use bullet points or numbered lists for multiple items
- Use *italic* for emphasis
- Mention which sections you used in your answer`;

      // Validate prompt size using Chrome AI's measureInputUsage()
      const validation = await this.validatePromptSize(session, input);

      if (validation.fits) {
        this.logDebug(`[Q&A] ✓ Prompt validation passed on attempt ${attempt} (${validation.actualUsage} tokens)`);
        break;
      }

      // Prompt too large - try trimming more chunks
      this.logWarn(`[Q&A] Prompt too large (${validation.actualUsage} > ${validation.available}), trimming chunks... (attempt ${attempt}/${MAX_RETRIES})`);

      if (attempt >= MAX_RETRIES) {
        // Last attempt - use minimal chunks (just 1-2 most relevant)
        this.logError(`[Q&A] Max retries reached, using minimal chunks`);
        finalContextChunks = contextChunks.slice(0, Math.min(2, contextChunks.length));
      } else {
        // Remove last 2 chunks and retry (but keep at least 1 chunk)
        const newLength = Math.max(1, finalContextChunks.length - 2);
        finalContextChunks = finalContextChunks.slice(0, newLength);
      }

      if (finalContextChunks.length === 0) {
        throw new Error('Context too large even after aggressive trimming. Try a shorter question or use a model with larger context.');
      }
    }

    // Build final context and input with validated chunks
    const context = buildContext(finalContextChunks);
    const input = `Based on the following excerpts from a research paper, answer this question:

Question: ${question}

Paper Context:
${context}

Provide a clear, accurate answer based on the information above.
Use markdown formatting for better readability:
- Use **bold** for key findings or important concepts
- Use bullet points or numbered lists for multiple items
- Use *italic* for emphasis
- Mention which sections you used in your answer`;

    try {
      const answer = await this.executePrompt(
        input,
        systemPrompt,
        undefined,
        languageContextId,
        [{ type: "text", languages: ["en", "es", "ja"] }],  // expectedInputs
        [{ type: "text", languages: [outputLanguage || "en"] }],  // expectedOutputs
        0.0,
        1
      );

      // Extract section references from the answer (simple heuristic)
      const sources: string[] = [];
      contextChunks.forEach(chunk => {
        if (chunk.section && answer.toLowerCase().includes(chunk.section.toLowerCase().slice(0, 15))) {
          if (!sources.includes(chunk.section)) {
            sources.push(chunk.section);
          }
        }
      });

      // If no sources detected, use all sections
      if (sources.length === 0) {
        sources.push(...contextChunks.map(c => c.section || 'Content').filter((v, i, a) => a.indexOf(v) === i));
      }

      return {
        question,
        answer,
        sources,
        timestamp: Date.now(),
      };
    } catch (error) {
      this.logError('Question answering failed:', error);
      return {
        question,
        answer: 'Sorry, I encountered an error while trying to answer this question. Please try again.',
        sources: [],
        timestamp: Date.now(),
      };
    } finally {
      // Cleanup session after successful Q&A operation
      try {
        await this.destroySession(languageContextId);
      } catch (cleanupError) {
        this.logWarn(`Failed to cleanup Q&A session: ${languageContextId}`, cleanupError);
      }
    }
  }
}
