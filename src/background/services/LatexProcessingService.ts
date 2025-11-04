/**
 * LaTeX Processing Service
 *
 * Handles extraction, protection, and rehydration of LaTeX expressions during
 * JSON streaming operations. This service ensures LaTeX content is not corrupted
 * by JSON escape sequence processing.
 *
 * Key Responsibilities:
 * - Extract LaTeX expressions and replace with safe placeholders
 * - Rehydrate placeholders with properly unescaped LaTeX
 * - Handle both display math ($$...$$, \[...\]) and inline math ($...$, \(...\))
 * - Unescape JSON string literals without corrupting LaTeX
 *
 * Usage Pattern:
 * 1. Extract LaTeX from raw JSON string → returns content with placeholders + latex array
 * 2. Process the content (unescape JSON, parse, etc.)
 * 3. Rehydrate LaTeX → restore LaTeX expressions in final content
 *
 * Example:
 * ```typescript
 * const latexService = new LatexProcessingService();
 *
 * // Extract LaTeX (protects it from JSON processing)
 * const { content: safeContent, latex } = latexService.extractLatexFromRawJson(rawJson);
 *
 * // Process content safely (no LaTeX corruption)
 * const processed = processContent(safeContent);
 *
 * // Restore LaTeX expressions
 * const final = latexService.rehydrateLatex(processed, latex);
 * ```
 */
export class LatexProcessingService {
  /**
   * Extract LaTeX expressions from raw JSON string content and replace with safe placeholders
   * This protects LaTeX from being corrupted by JSON escape sequence processing
   *
   * Handles: $...$, $$...$$, \(...\), \[...\]
   * Returns: { content: string with placeholders, latex: array of extracted expressions }
   *
   * NOTE: LaTeX is stored as-is (with double backslashes from JSON). Unescaping happens
   * during rehydration to ensure correct order of operations.
   *
   * @param content - Raw JSON string content containing LaTeX expressions
   * @returns Object with placeholder-replaced content and array of extracted LaTeX expressions
   *
   * @example
   * const result = service.extractLatexFromRawJson('Answer: $E = mc^2$ and $$F = ma$$');
   * // result.content: 'Answer: {{LATEX_0}} and {{LATEX_1}}'
   * // result.latex: ['$E = mc^2$', '$$F = ma$$']
   */
  extractLatexFromRawJson(content: string): { content: string; latex: string[] } {
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
   *
   * @param content - Content with LaTeX placeholders
   * @param latex - Array of extracted LaTeX expressions (from extractLatexFromRawJson)
   * @returns Content with LaTeX expressions restored and properly unescaped
   *
   * @example
   * const final = service.rehydrateLatex('Answer: {{LATEX_0}}', ['$E = mc^2$']);
   * // final: 'Answer: $E = mc^2$'
   */
  rehydrateLatex(content: string, latex: string[]): string {
    let result = content;
    latex.forEach((latexExpr, index) => {
      const placeholder = `{{LATEX_${index}}}`;
      // Unescape the LaTeX expression when rehydrating (convert \\ to \)
      const unescapedLatex = this.unescapeJsonString(latexExpr);
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
   *
   * @param str - String with JSON escape sequences
   * @returns String with escape sequences converted to actual characters
   *
   * @example
   * // Called on content AFTER LaTeX extraction
   * const { content, latex } = service.extractLatexFromRawJson(rawJson);
   * const unescaped = service.unescapeJsonString(content); // Public API
   *
   * // Also called internally by rehydrateLatex on each LaTeX expression
   */
  unescapeJsonString(str: string): string {
    return str
      .replace(/\\\\/g, '\x00')  // Step 1: Protect double backslashes with placeholder
      .replace(/\\n/g, '\n')     // Step 2: Convert JSON newline escape
      .replace(/\\"/g, '"')      // Step 3: Convert JSON quote escape
      .replace(/\x00/g, '\\');   // Step 4: Restore double backslashes
  }
}
