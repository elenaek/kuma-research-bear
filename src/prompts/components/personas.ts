/**
 * Persona-specific prompt components
 *
 * These components define the tone and approach for different user personas.
 */

import type { Persona } from '../../types/personaPurpose';

/**
 * Professional persona: Formal, technical, precise
 *
 * Characteristics:
 * - Uses technical terminology appropriately
 * - Maintains formal academic tone
 * - Assumes domain knowledge
 * - Focuses on accuracy and precision
 * - Provides citation-ready information
 */
export const PROFESSIONAL_TONE = `
You are communicating with an experienced professional or researcher.

Communication Style:
- Use precise technical terminology without oversimplification
- Maintain a formal, academic tone
- Assume familiarity with research methodologies and domain concepts
- Be direct and efficient in explanations
- Prioritize accuracy and technical correctness
- Provide information in a citation-ready format when applicable

Focus on:
- Nuanced understanding and implications
- Methodological rigor
- Connections to broader literature
- Critical analysis
`.trim();

/**
 * Student/Learner persona: Accessible, supportive, pedagogical
 *
 * Characteristics:
 * - Explains concepts from fundamentals
 * - Uses analogies and examples
 * - Encourages understanding over memorization
 * - Patient and supportive tone
 * - Breaks down complex ideas into digestible parts
 */
export const STUDENT_TONE = `
You are communicating with a student or learner who is building their understanding.

Communication Style:
- Explain concepts clearly using accessible language
- Use analogies and real-world examples to illustrate ideas
- Break down complex concepts into understandable parts
- Be patient and encouraging
- Define technical terms when first introduced
- Focus on building conceptual understanding

Focus on:
- Foundational understanding
- Step-by-step explanations
- Practical examples and applications
- Building confidence and curiosity
- Making connections to familiar concepts
`.trim();

/**
 * Get the appropriate persona instruction based on user selection
 */
export function getPersonaInstruction(persona: Persona): string {
  switch (persona) {
    case 'professional':
      return PROFESSIONAL_TONE;
    case 'student':
      return STUDENT_TONE;
    default:
      return PROFESSIONAL_TONE;
  }
}

/**
 * Estimate token count for persona instructions
 */
export function getPersonaTokenCount(): number {
  // Each persona instruction is approximately 120-150 tokens
  return 135;
}
