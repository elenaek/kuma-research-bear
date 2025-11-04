/**
 * Verbosity-specific prompt components
 *
 * These components control the length and detail level of AI responses.
 * Scale: 1 (most concise) to 5 (most detailed)
 */

/**
 * Level 1: Extremely Concise
 * - Minimal responses (1-2 sentences)
 * - Only essential information
 * - Direct answers with no elaboration
 */
const VERBOSITY_LEVEL_1 = `
RESPONSE LENGTH GUIDELINES:
- Keep responses extremely brief and to the point
- Use 1-2 sentences maximum
- Focus only on the most essential information
- Avoid any elaboration, examples, or additional context
- Be as direct and concise as possible
`.trim();

/**
 * Level 2: Brief
 * - Short responses (2-3 sentences)
 * - Key points only
 * - Minimal context
 */
const VERBOSITY_LEVEL_2 = `
RESPONSE LENGTH GUIDELINES:
- Keep responses brief but complete
- Use 2-3 sentences
- Cover key points without extensive detail
- Include only necessary context
- Be concise while ensuring clarity
`.trim();

/**
 * Level 3: Balanced (Default)
 * - Moderate length (3-5 sentences)
 * - Balance between brevity and completeness
 * - Essential context included
 */
const VERBOSITY_LEVEL_3 = `
RESPONSE LENGTH GUIDELINES:
- Provide balanced, moderate-length responses
- Use 3-5 sentences
- Balance brevity with completeness
- Include essential context and key details
- Ensure clarity without over-elaboration
`.trim();

/**
 * Level 4: Detailed
 * - Comprehensive responses (5-8 sentences)
 * - Full explanations with context
 * - Supporting details included
 */
const VERBOSITY_LEVEL_4 = `
RESPONSE LENGTH GUIDELINES:
- Provide detailed and thorough responses
- Use 5-8 sentences
- Include comprehensive explanations
- Add relevant context and supporting details
- Elaborate on key points for better understanding
`.trim();

/**
 * Level 5: Comprehensive
 * - Extended responses (8-15 sentences)
 * - Full depth with examples
 * - Rich context and elaboration
 */
const VERBOSITY_LEVEL_5 = `
RESPONSE LENGTH GUIDELINES:
- Provide comprehensive, in-depth responses
- Use 8-15 sentences
- Include extensive explanations with examples
- Add rich context, implications, and elaboration
- Cover related concepts and provide thorough understanding
- Use analogies and detailed examples when helpful
`.trim();

/**
 * Map verbosity levels to their instructions
 */
const VERBOSITY_INSTRUCTIONS = {
  1: VERBOSITY_LEVEL_1,
  2: VERBOSITY_LEVEL_2,
  3: VERBOSITY_LEVEL_3,
  4: VERBOSITY_LEVEL_4,
  5: VERBOSITY_LEVEL_5,
};

/**
 * Get the appropriate verbosity instruction based on user setting
 * @param level Verbosity level (1-5, default: 3)
 */
export function getVerbosityInstruction(level: number = 3): string {
  // Clamp to valid range
  const clampedLevel = Math.min(5, Math.max(1, Math.round(level))) as 1 | 2 | 3 | 4 | 5;
  return VERBOSITY_INSTRUCTIONS[clampedLevel];
}

/**
 * Get user-friendly label for verbosity level
 */
export function getVerbosityLabel(level: number): string {
  const labels = {
    1: 'Very Concise',
    2: 'Concise',
    3: 'Balanced',
    4: 'Detailed',
    5: 'Comprehensive',
  };
  const clampedLevel = Math.min(5, Math.max(1, Math.round(level))) as 1 | 2 | 3 | 4 | 5;
  return labels[clampedLevel];
}

/**
 * Estimate token count for verbosity instructions
 */
export function getVerbosityTokenCount(): number {
  // Each verbosity instruction is approximately 50-80 tokens
  return 65;
}
