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
- Use code blocks with \`\`\` for code examples`,
  tokens: 50,
};

/**
 * JSON response format reminder
 */
export const JSON_FORMAT_REMINDER: PromptComponent = {
  content: `Remember: You are outputting JSON, so all strings must be properly escaped.`,
  tokens: 15,
};
