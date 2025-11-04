import { BaseOperationOrchestrator } from './base/BaseOperationOrchestrator.ts';
import { GlossaryTerm, GlossaryResult, StoredPaper } from '../../shared/types/index.ts';
import { aiService } from '../../shared/utils/aiService.ts';
import { updatePaperGlossary, updatePartialPaperGlossary } from '../../shared/utils/dbService.ts';
import {
  sendGlossaryProgress,
  sendGlossaryBatchComplete,
  setOperationStart,
  setOperationComplete,
  clearGlossaryProgressState,
} from '../utils/handlerUtils.ts';
import { logger } from '../../shared/utils/logger.ts';

/**
 * GlossaryWorkflowOrchestrator - Orchestrates manual glossary generation workflow
 *
 * Responsibilities:
 * - Extract terms from paper chunks using AI
 * - Deduplicate terms in batches
 * - Generate definitions for each term using RAG + AI
 * - Send progressive updates to UI
 * - Store partial and final results
 *
 * Algorithm:
 * 1. Chunk paper text (5000 chars, 1000 overlap)
 * 2. Extract terms from each chunk (10 per chunk)
 * 3. Batched deduplication (200 terms per batch)
 * 4. Generate definitions in batches (10 at a time)
 * 5. Static deduplication (remove exact duplicates)
 * 6. Store final glossary
 *
 * Features:
 * - Progressive UI updates (batch completion messages)
 * - Partial result storage (resume on failure)
 * - Request deduplication (prevent duplicate requests)
 * - Automatic state management
 */
export class GlossaryWorkflowOrchestrator extends BaseOperationOrchestrator {
  protected getOperationName(): string {
    return 'Glossary Generation';
  }

  protected getProgressField(): string {
    return 'glossaryProgress';
  }

  protected getIsOperatingField(): string {
    return 'isGeneratingGlossary';
  }

  /**
   * Execute glossary generation workflow
   *
   * @param paperUrl - Paper URL
   * @param tabId - Tab ID for state management
   * @param contextId - Context ID for AI sessions
   * @returns Glossary result
   */
  async execute(
    paperUrl: string,
    tabId: number | undefined,
    contextId: string
  ): Promise<GlossaryResult> {
    return await this.withRequestDeduplication(
      paperUrl,
      tabId,
      'glossary-manual',
      async () => {
        // Retrieve paper
        const storedPaper = await this.ensurePaperExists(paperUrl);

        // Set operation start
        await setOperationStart(
          tabId,
          'glossary',
          storedPaper,
          '🐻 Kuma is generating a glossary for the research paper...'
        );

        logger.debug(
          'GLOSSARY_WORKFLOW',
          `Generating glossary manually for paper: ${storedPaper.title}`
        );

        // Step 1: Extract terms from text chunks
        const allTerms = await this.extractTermsFromChunks(storedPaper, contextId, tabId);

        if (allTerms.length === 0) {
          throw new Error('No terms extracted from chunks');
        }

        // Step 2: Batched deduplication
        const deduplicatedTerms = await this.deduplicateTerms(
          allTerms,
          storedPaper.title,
          contextId,
          tabId
        );

        logger.debug('GLOSSARY_WORKFLOW', `✓ Final deduplicated terms: ${deduplicatedTerms.length}`);

        // Step 3: Generate definitions for each technical term
        const glossaryTerms = await this.generateDefinitionsForTerms(
          deduplicatedTerms,
          storedPaper,
          contextId,
          tabId
        );

        // Static deduplication: Remove any duplicate terms by acronym
        const finalGlossaryTerms = this.staticDeduplication(glossaryTerms);

        // Sort terms alphabetically
        finalGlossaryTerms.sort((a, b) => a.acronym.localeCompare(b.acronym));

        return {
          terms: finalGlossaryTerms,
          timestamp: Date.now(),
        };
      }
    ).then(async (result) => {
      if (!result.success || !result.result) {
        throw new Error(result.error || 'Glossary generation failed');
      }

      const glossary = result.result;
      const storedPaper = await this.ensurePaperExists(paperUrl);

      // Store in IndexedDB
      const outputLanguage = await this.getOutputLanguage();
      await updatePaperGlossary(storedPaper.id, glossary, outputLanguage);
      logger.debug('GLOSSARY_WORKFLOW', '✓ Glossary stored in IndexedDB');

      // Update completion tracking
      await this.updateCompletionStatus(tabId, storedPaper.url);

      // Set operation complete
      await setOperationComplete(
        tabId,
        'glossary',
        '🐻 Kuma has finished generating the glossary!'
      );
      await clearGlossaryProgressState(tabId);

      // Clear the progress message after a delay
      this.clearProgressMessageAfterDelay(tabId, this.getProgressField());

      logger.debug('GLOSSARY_WORKFLOW', '✓ Manual glossary generation complete');
      return glossary;
    }).catch(async (error) => {
      logger.error('GLOSSARY_WORKFLOW', 'Error generating manual glossary:', error);

      // Handle error state
      await this.handleError(tabId, error, this.getProgressField());
      await clearGlossaryProgressState(tabId);

      throw error;
    }).finally(async () => {
      // Always destroy all glossary sessions when done
      const { aiService } = await import('../../shared/utils/aiService.ts');
      await aiService.destroySessionForContext(contextId);
    });
  }

  /**
   * Step 1: Extract terms from text chunks
   */
  private async extractTermsFromChunks(
    storedPaper: StoredPaper,
    contextId: string,
    tabId: number | undefined
  ): Promise<string[]> {
    sendGlossaryProgress('extracting', undefined, undefined, tabId);
    logger.debug('GLOSSARY_WORKFLOW', 'Step 1: Extracting terms from text chunks...');

    // Use same chunking method as hierarchical summarization (5000 chars, 1000 overlap)
    const { chunkContent } = await import('../../shared/utils/contentExtractor.ts');
    const fullText = storedPaper.fullText || storedPaper.abstract;
    const textChunks = chunkContent(fullText, 5000, 1000);

    logger.debug(
      'GLOSSARY_WORKFLOW',
      `Created ${textChunks.length} text chunks (5000 chars, 1000 overlap)`
    );

    // Report initial progress
    sendGlossaryProgress('extracting-terms-from-chunks', 0, textChunks.length, tabId);

    // Extract terms from each chunk SEQUENTIALLY
    const chunkTermsResults = [];
    for (let i = 0; i < textChunks.length; i++) {
      const chunk = textChunks[i];
      logger.debug(
        'GLOSSARY_WORKFLOW',
        `Extracting terms from chunk ${i + 1}/${textChunks.length}...`
      );

      const terms = await aiService.extractTermsFromChunk(
        chunk.content,
        storedPaper.title,
        `${contextId}-extract-chunk-${i}`,
        10 // Extract 10 terms per chunk
      );

      chunkTermsResults.push(terms);

      // Update progress after each chunk
      sendGlossaryProgress('extracting-terms-from-chunks', i + 1, textChunks.length, tabId);
      logger.debug(
        'GLOSSARY_WORKFLOW',
        `✓ Chunk ${i + 1}/${textChunks.length} complete, extracted ${terms.length} terms`
      );

      // Small delay between chunks to prevent resource contention
      if (i < textChunks.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
    }

    logger.debug('GLOSSARY_WORKFLOW', `✓ Extracted terms from all ${textChunks.length} chunks`);

    // Aggregate all terms from chunks
    const allTerms = chunkTermsResults.flatMap((terms) => terms);
    logger.debug('GLOSSARY_WORKFLOW', `✓ Aggregated ${allTerms.length} terms from chunks`);

    return allTerms;
  }

  /**
   * Step 2: Batched deduplication
   */
  private async deduplicateTerms(
    allTerms: string[],
    paperTitle: string,
    contextId: string,
    tabId: number | undefined
  ): Promise<string[]> {
    sendGlossaryProgress('filtering-terms', undefined, undefined, tabId);
    logger.debug('GLOSSARY_WORKFLOW', 'Step 2: Deduplicating terms in batches...');

    const dedupeBatchSize = 200;
    const deduplicatedBatches: string[] = [];

    for (let i = 0; i < allTerms.length; i += dedupeBatchSize) {
      const batch = allTerms.slice(i, i + dedupeBatchSize);
      logger.debug(
        'GLOSSARY_WORKFLOW',
        `Deduplicating batch ${Math.floor(i / dedupeBatchSize) + 1}/${Math.ceil(allTerms.length / dedupeBatchSize)} (${batch.length} terms)...`
      );

      try {
        const deduped = await aiService.deduplicateTermsBatch(
          batch,
          paperTitle,
          Math.ceil(50 * (batch.length / allTerms.length)), // Proportional target
          `${contextId}-dedupe-${i}`
        );
        deduplicatedBatches.push(...deduped);
      } catch (error) {
        logger.error('GLOSSARY_WORKFLOW', 'Error deduplicating batch:', error);
        // Continue with next batch
      }
    }

    logger.debug(
      'GLOSSARY_WORKFLOW',
      `✓ After batched deduplication: ${deduplicatedBatches.length} terms`
    );

    // Final deduplication pass if we have too many terms
    let deduplicatedTerms: string[];
    if (deduplicatedBatches.length > 60) {
      logger.debug(
        'GLOSSARY_WORKFLOW',
        'Final deduplication pass to reach target of ~50 terms...'
      );
      deduplicatedTerms = await aiService.deduplicateTermsBatch(
        deduplicatedBatches,
        paperTitle,
        50,
        `${contextId}-dedupe-final`
      );
    } else {
      deduplicatedTerms = deduplicatedBatches;
    }

    return deduplicatedTerms;
  }

  /**
   * Step 3: Generate definitions for each technical term using RAG + GeminiNano
   */
  private async generateDefinitionsForTerms(
    deduplicatedTerms: string[],
    storedPaper: StoredPaper,
    contextId: string,
    tabId: number | undefined
  ): Promise<GlossaryTerm[]> {
    sendGlossaryProgress('generating-definitions', 0, deduplicatedTerms.length, tabId);
    logger.debug('GLOSSARY_WORKFLOW', 'Step 3: Generating definitions for technical terms...');

    const glossaryTerms: GlossaryTerm[] = [];
    let successCount = 0;

    // Process definitions in batches (10 at a time for progressive UI updates)
    const definitionBatchSize = 10;
    const totalTerms = deduplicatedTerms.length;

    for (let i = 0; i < totalTerms; i += definitionBatchSize) {
      const batch = deduplicatedTerms.slice(i, i + definitionBatchSize);

      try {
        logger.debug(
          'GLOSSARY_WORKFLOW',
          `Generating ${batch.length} definitions in single prompt call (batch ${Math.floor(i / definitionBatchSize) + 1}/${Math.ceil(totalTerms / definitionBatchSize)})...`
        );

        // Generate all definitions in the batch with a SINGLE prompt call
        const batchTerms = await aiService.generateDefinitionsBatchWithRAG(
          batch,
          storedPaper.id,
          storedPaper.title,
          `${contextId}-batch-${i}`,
          true, // Use keyword-only search (faster for exact terms)
          { recentMessages: [] } // Conversation context for budget calculation
        );

        // Collect successful results
        const newTerms: GlossaryTerm[] = [];
        batchTerms.forEach((term, idx) => {
          if (term) {
            glossaryTerms.push(term);
            newTerms.push(term);
            successCount++;
            logger.debug('GLOSSARY_WORKFLOW', `✓ Definition generated for: ${batch[idx]}`);
          } else {
            logger.warn('GLOSSARY_WORKFLOW', `✗ Failed to generate definition for: ${batch[idx]}`);
          }
        });

        logger.debug(
          'GLOSSARY_WORKFLOW',
          `Batch complete: ${batchTerms.filter((t) => t !== null).length}/${batch.length} successful`
        );

        // Broadcast batch completion with new terms for progressive UI updates
        if (newTerms.length > 0) {
          sendGlossaryBatchComplete(storedPaper.url, newTerms, successCount, deduplicatedTerms.length);

          // Update partial glossary in IndexedDB for persistence
          try {
            const outputLanguage = await this.getOutputLanguage();

            // Sort glossaryTerms alphabetically for consistent display
            glossaryTerms.sort((a, b) => a.acronym.localeCompare(b.acronym));

            const partialGlossary = {
              terms: glossaryTerms,
              timestamp: Date.now(),
            };
            await updatePartialPaperGlossary(storedPaper.id, partialGlossary, outputLanguage);
          } catch (error) {
            logger.warn('GLOSSARY_WORKFLOW', 'Failed to store partial glossary:', error);
          }
        }
      } catch (error) {
        logger.error('GLOSSARY_WORKFLOW', 'Error generating batch definitions:', error);
        // Continue to next batch on error
      }

      // Update progress
      sendGlossaryProgress(
        'generating-definitions',
        Math.min(i + definitionBatchSize, totalTerms),
        totalTerms,
        tabId
      );

      // Small delay between batches
      if (i + definitionBatchSize < totalTerms) {
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    }

    logger.debug(
      'GLOSSARY_WORKFLOW',
      `Generated ${successCount}/${deduplicatedTerms.length} definitions successfully`
    );

    return glossaryTerms;
  }

  /**
   * Static deduplication: Remove duplicate terms by acronym (case-insensitive)
   */
  private staticDeduplication(glossaryTerms: GlossaryTerm[]): GlossaryTerm[] {
    const seenAcronyms = new Map<string, GlossaryTerm>();
    glossaryTerms.forEach((term) => {
      const key = term.acronym.toLowerCase();
      if (!seenAcronyms.has(key)) {
        seenAcronyms.set(key, term);
      } else {
        logger.debug('GLOSSARY_WORKFLOW', `Removing duplicate term: ${term.acronym}`);
      }
    });

    const finalGlossaryTerms = Array.from(seenAcronyms.values());
    logger.debug(
      'GLOSSARY_WORKFLOW',
      `After static deduplication: ${finalGlossaryTerms.length} unique terms (removed ${glossaryTerms.length - finalGlossaryTerms.length} duplicates)`
    );

    return finalGlossaryTerms;
  }
}
