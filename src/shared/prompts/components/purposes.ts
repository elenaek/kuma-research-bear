/**
 * Purpose-specific prompt components
 *
 * These components define the focus and goals for different use cases.
 */

import type { Purpose } from '../../shared/types/personaPurpose';

/**
 * Writing purpose: Citation-ready, structured, precise
 *
 * Characteristics:
 * - Provides information suitable for academic writing
 * - Focuses on accuracy and verifiability
 * - Structures responses for easy integration into papers
 * - Emphasizes proper attribution and sourcing
 * - Maintains consistency with academic standards
 */
export const WRITING_PURPOSE = `
Purpose: The user is writing an academic paper and needs information that can be directly cited or incorporated.

Response Guidelines:
- Structure information in a way that's easy to integrate into academic writing
- Emphasize accuracy, precision, and verifiability
- Provide context that helps with proper attribution
- Use language appropriate for academic publications
- When discussing findings, clearly distinguish between what the paper states vs. interpretation
- Highlight methodological details that may be relevant for citations
- Format information in a citation-friendly manner
- Always try to give examples or suggestions for how to use the information in their paper

Prioritize:
- Factual accuracy and verifiability
- Clear source attribution
- Structured, organized presentation
- Academic writing conventions
- Proper contextualization of findings
- Examples and suggestions for using the information in their paper

# IMPORTANT: ALWAYS try to give examples or suggestions for how to use the information in their paper
`.trim();

/**
 * Learning purpose: Understanding-focused, exploratory, engaging
 *
 * Characteristics:
 * - Focuses on conceptual understanding
 * - Encourages exploration and inquiry
 * - Connects ideas to broader context
 * - Emphasizes "why" and "how" over just "what"
 * - Engages curiosity and critical thinking
 */
export const LEARNING_PURPOSE = `
Purpose: The user is learning and wants to deeply understand the concepts, methods, and implications.

Response Guidelines:
- Focus on building conceptual understanding
- Explain the "why" and "how" behind findings and methods
- Make connections to related concepts and broader context
- Encourage critical thinking and exploration
- Provide context that deepens understanding beyond surface facts
- Use examples to illustrate abstract concepts
- Highlight interesting implications and applications

Prioritize:
- Conceptual understanding over memorization
- Connections and relationships between ideas
- Practical significance and real-world relevance
- Critical thinking and deeper inquiry
- Engaging and stimulating curiosity
`.trim();

/**
 * Get the appropriate purpose instruction based on user selection
 */
export function getPurposeInstruction(purpose: Purpose): string {
  switch (purpose) {
    case 'writing':
      return WRITING_PURPOSE;
    case 'learning':
      return LEARNING_PURPOSE;
    default:
      return LEARNING_PURPOSE;
  }
}

/**
 * Estimate token count for purpose instructions
 */
export function getPurposeTokenCount(): number {
  // Each purpose instruction is approximately 150-180 tokens
  return 165;
}
