/**
 * Formatting components for prompts
 * These constants provide reusable formatting instructions to avoid duplication
 */

import type { PromptComponent } from '../types';

/**
 * LaTeX escaping rules for JSON output
 * This is a critical component used across multiple features to ensure
 * proper LaTeX rendering in JSON strings
 *
 * **IMPORTANT**: This exact text appears in 8+ locations in the codebase.
 * Centralizing it here ensures consistency and easier maintenance.
 */
export const LATEX_RULES: PromptComponent = {
  content: `
#IMPORTANT:
FOR ALL MATH USE LATEX

Always use LaTeX to format any math equations, expressions, or formulas using the following rules:
# Math Formatting with LaTeX:
- Use $expr$ for inline math, $$expr$$ to display equations or formulas on a new line
`,
  tokens: 250, // Approximate token count
};

/**
 * Standard markdown formatting instructions
 */
export const MARKDOWN_FORMATTING: PromptComponent = {
  content: `Use markdown formatting (bold, italic, lists, headers) for readability.`,
  tokens: 15,
};

/**
 * Detailed markdown formatting with examples
 */
export const MARKDOWN_FORMATTING_DETAILED: PromptComponent = {
  content: `Format your response using markdown:
- Use **bold** for emphasis
- Use *italic* for subtle emphasis
- Use lists (- or 1.) for clarity
- Use ## headers for sections
- For any code block examples, include the code in a code block and include the language of the code in the code block. e.g. \`\`\`programming_language\n code \n\`\`\`
- For any inline code, include the code in inline code syntax. e.g. \`code\``,
  tokens: 100,
};

/**
 * JSON response format reminder
 */
export const JSON_FORMAT_REMINDER: PromptComponent = {
  content: `Remember: You are outputting JSON, so all strings must be properly escaped.`,
  tokens: 15,
};
