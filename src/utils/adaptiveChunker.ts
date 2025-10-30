/**
 * Adaptive Chunker
 * Intelligently chunks research paper sections based on user's inputQuota
 * Preserves semantic boundaries (paragraphs, sentences) and section hierarchy
 */

import { ContentChunk } from '../types/index.ts';
import { inputQuotaService } from './inputQuotaService.ts';
import type { PaperSection } from './researchPaperSplitter.ts';
import { logger } from './logger.ts';

/**
 * Chunk research paper sections adaptively based on inputQuota
 * Respects paragraph and sentence boundaries, applies intelligent overlap
 * Returns chunks along with statistics for adaptive RAG
 */
export async function chunkSections(
  sections: PaperSection[],
  paperId: string
): Promise<{
  chunks: ContentChunk[];
  stats: {
    averageChunkSize: number;
    totalChunks: number;
    minChunkSize: number;
    maxChunkSize: number;
  };
}> {
  try {
    logger.debug('UTILS', `[AdaptiveChunker] Chunking ${sections.length} sections for paper ${paperId}`);

    // Get adaptive sizing from inputQuota service
    const maxAllowedChunkSize = await inputQuotaService.getMaxChunkSize();

    logger.debug('UTILS', `[AdaptiveChunker] Max allowed chunk size: ${maxAllowedChunkSize} chars`);

    const allChunks: ContentChunk[] = [];
    let globalChunkIndex = 0;

    // Process each section
    for (const section of sections) {
      const sectionChunks = chunkSection(
        section,
        paperId,
        maxAllowedChunkSize,
        globalChunkIndex
      );

      allChunks.push(...sectionChunks);
      globalChunkIndex += sectionChunks.length;
    }

    // Calculate statistics
    const chunkSizes = allChunks.map(chunk => chunk.content.length);
    const totalSize = chunkSizes.reduce((sum, size) => sum + size, 0);
    const averageChunkSize = Math.floor(totalSize / allChunks.length);
    const minChunkSize = Math.min(...chunkSizes);
    const maxChunkSize = Math.max(...chunkSizes);

    logger.debug('UTILS', `[AdaptiveChunker] ✓ Created ${allChunks.length} chunks from ${sections.length} sections`);
    logger.debug('UTILS', `[AdaptiveChunker] Stats: avg=${averageChunkSize}, min=${minChunkSize}, max=${maxChunkSize} chars`);
    logger.debug('UTILS', `[AdaptiveChunker] Avg chunks per section: ${(allChunks.length / sections.length).toFixed(1)}`);

    return {
      chunks: allChunks,
      stats: {
        averageChunkSize,
        totalChunks: allChunks.length,
        minChunkSize,
        maxChunkSize,
      },
    };
  } catch (error) {
    logger.error('UTILS', '[AdaptiveChunker] Error chunking sections:', error);
    throw error;
  }
}

/**
 * Extract paragraphs from content
 * Paragraphs are separated by double newlines or <p> tags
 */
function extractParagraphs(content: string): string[] {
  // Split by double newlines (or more)
  const paragraphs = content
    .split(/\n\n+/)
    .map(p => p.trim())
    .filter(p => p.length > 0);

  return paragraphs;
}

/**
 * Extract sentences from text
 * Uses simple sentence boundary detection
 */
function extractSentences(text: string): string[] {
  // Split by sentence boundaries (.!?)
  const sentences = text
    .match(/[^.!?]+[.!?]+/g)
    ?.map(s => s.trim())
    .filter(s => s.length > 0) || [text];

  return sentences;
}

/**
 * Chunk a single section using natural document boundaries
 * Strategy:
 * 1. Always extract paragraphs from section (one chunk per paragraph)
 * 2. If paragraph > maxChunkSize → split by sentences within that paragraph
 * 3. maxChunkSize is a safety limit for abnormally large paragraphs only
 */
function chunkSection(
  section: PaperSection,
  paperId: string,
  maxChunkSize: number,
  startGlobalIndex: number
): ContentChunk[] {
  const { heading, level, parentHeading, content, startIndex, cssSelector, elementId, xPath } = section;

  // ALWAYS chunk by paragraphs (natural document boundaries)
  const paragraphs = extractParagraphs(content);
  logger.debug('UTILS', `[AdaptiveChunker] Chunking section "${heading}" (${content.length} chars) - extracted ${paragraphs.length} paragraphs`);

  const chunks: ContentChunk[] = [];
  let currentChunkIndex = startGlobalIndex;

  for (let i = 0; i < paragraphs.length; i++) {
    const paragraph = paragraphs[i];

    // If paragraph fits within maxChunkSize, create chunk for this paragraph
    if (paragraph.length <= maxChunkSize) {
      const chunkStartChar = startIndex + content.indexOf(paragraph);

      chunks.push({
        id: `chunk_${paperId}_${currentChunkIndex}`,
        paperId,
        content: paragraph,
        index: currentChunkIndex,
        section: heading,
        sectionLevel: level,
        parentSection: parentHeading,
        sectionIndex: currentChunkIndex - startGlobalIndex,
        totalSectionChunks: -1, // Will be updated after processing all chunks
        isResearchPaper: true,
        startChar: chunkStartChar,
        endChar: chunkStartChar + paragraph.length,
        tokenCount: Math.ceil(paragraph.length / 4),
        paragraphIndex: i, // Track paragraph number within section
        cssSelector, // CSS selector from section for scroll-to-source
        elementId, // Element ID from section
        xPath, // XPath from section
      });

      currentChunkIndex++;
    } else {
      // Paragraph exceeds maxChunkSize → chunk by sentences
      logger.debug('UTILS', `[AdaptiveChunker] Paragraph ${i + 1} (${paragraph.length} chars) exceeds max size, chunking by sentences...`);

      const sentences = extractSentences(paragraph);
      let currentSentenceGroup = '';
      let sentenceStartIndex = 0;

      for (let j = 0; j < sentences.length; j++) {
        const sentence = sentences[j];

        // Check if adding this sentence would exceed maxChunkSize
        if (currentSentenceGroup.length + sentence.length + 1 > maxChunkSize && currentSentenceGroup.length > 0) {
          // Save current sentence group as chunk
          const chunkStartChar = startIndex + content.indexOf(paragraph) + sentenceStartIndex;

          chunks.push({
            id: `chunk_${paperId}_${currentChunkIndex}`,
            paperId,
            content: currentSentenceGroup.trim(),
            index: currentChunkIndex,
            section: heading,
            sectionLevel: level,
            parentSection: parentHeading,
            sectionIndex: currentChunkIndex - startGlobalIndex,
            totalSectionChunks: -1,
            isResearchPaper: true,
            startChar: chunkStartChar,
            endChar: chunkStartChar + currentSentenceGroup.length,
            tokenCount: Math.ceil(currentSentenceGroup.length / 4),
            paragraphIndex: i,
            sentenceGroupIndex: Math.floor(j / 3), // Approximate sentence group number
            cssSelector, // CSS selector from section for scroll-to-source
            elementId, // Element ID from section
            xPath, // XPath from section
          });

          currentChunkIndex++;
          sentenceStartIndex += currentSentenceGroup.length;
          currentSentenceGroup = sentence + ' ';
        } else {
          currentSentenceGroup += sentence + ' ';
        }
      }

      // Add remaining sentences as final chunk for this paragraph
      if (currentSentenceGroup.trim().length > 0) {
        const chunkStartChar = startIndex + content.indexOf(paragraph) + sentenceStartIndex;

        chunks.push({
          id: `chunk_${paperId}_${currentChunkIndex}`,
          paperId,
          content: currentSentenceGroup.trim(),
          index: currentChunkIndex,
          section: heading,
          sectionLevel: level,
          parentSection: parentHeading,
          sectionIndex: currentChunkIndex - startGlobalIndex,
          totalSectionChunks: -1,
          isResearchPaper: true,
          startChar: chunkStartChar,
          endChar: chunkStartChar + currentSentenceGroup.length,
          tokenCount: Math.ceil(currentSentenceGroup.length / 4),
          paragraphIndex: i,
          sentenceGroupIndex: Math.floor(sentences.length / 3),
          cssSelector, // CSS selector from section for scroll-to-source
          elementId, // Element ID from section
          xPath, // XPath from section
        });

        currentChunkIndex++;
      }
    }
  }

  // Update totalSectionChunks for all chunks in this section
  const totalChunks = chunks.length;
  chunks.forEach(chunk => {
    chunk.totalSectionChunks = totalChunks;
  });

  logger.debug('UTILS', `[AdaptiveChunker] ✓ Created ${totalChunks} chunks for section "${heading}"`);

  return chunks;
}

