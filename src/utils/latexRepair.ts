/**
 * LaTeX Command Repair Utility
 *
 * Repairs LaTeX commands that were corrupted by JavaScript escape sequence interpretation.
 * When JSON.parse() encounters sequences like \triangle or \nu in JSON strings,
 * it interprets them as escape sequences (\t = tab, \n = newline), corrupting the LaTeX.
 *
 * This utility detects and repairs such corruption within math delimiters ($...$, $$...$$).
 */

import { logger } from './logger.ts';

/**
 * Dictionary of LaTeX commands that contain characters that look like JS escape sequences.
 * Organized by the escape character they contain.
 */
const LATEX_COMMANDS = {
  // Commands containing \t (tab)
  t: [
    'theta', 'Theta',
    'tau',
    'top', 'bot',
    'text', 'textbf', 'textit', 'textrm', 'texttt', 'textsf',
    'triangle', 'triangleq', 'triangleleft', 'triangleright',
    'times',
    'to',
  ],

  // Commands containing \n (newline)
  n: [
    'nu',
    'nabla',
    'neg', 'not',
    'neq', 'nequiv',
    'ni', 'nin', 'notin',
    'normalsize',
    'natural',
  ],

  // Commands containing \r (carriage return)
  r: [
    'rho',
    'rightarrow', 'Rightarrow', 'rightharpoonup', 'rightharpoondown',
    'ref',
    'rangle',
    'real', 'Re',
  ],

  // Commands containing \b (backspace)
  b: [
    'beta',
    'bigcap', 'bigcup', 'bigvee', 'bigwedge',
    'binom',
    'bar', 'bold',
    'bot',
  ],

  // Commands containing \f (form feed)
  f: [
    'frac',
    'forall',
    'flat',
    'phi', 'Phi', 'varphi',
  ],
};

/**
 * Builds a flat set of all LaTeX commands for quick lookup.
 */
function buildCommandSet(): Set<string> {
  const commands = new Set<string>();

  for (const group of Object.values(LATEX_COMMANDS)) {
    for (const cmd of group) {
      commands.add(cmd);
    }
  }

  return commands;
}

const COMMAND_SET = buildCommandSet();

/**
 * Attempts to reconstruct a LaTeX command from corrupted text.
 *
 * @param escapeChar - The escape character that was interpreted (t, n, r, b, f)
 * @param remainder - The remaining text after the escape character
 * @returns The reconstructed LaTeX command (without backslash) or null if not found
 */
function tryReconstructCommand(escapeChar: string, remainder: string): string | null {
  const possibleCommands = LATEX_COMMANDS[escapeChar as keyof typeof LATEX_COMMANDS];
  if (!possibleCommands) return null;

  // Try to match the remainder against possible commands
  for (const cmd of possibleCommands) {
    // Check if remainder matches the command
    // remainder already includes the escape char (e.g., 'triangle' for \t + 'riangle')
    if (remainder.startsWith(cmd)) {
      const nextChar = remainder[cmd.length];

      // Command can be followed by: space, underscore, caret, brace, dollar, or end of string
      if (!nextChar || /[\s_^{}$]/.test(nextChar)) {
        return cmd;
      }
    }
  }

  return null;
}

/**
 * Repairs corrupted LaTeX commands within a math expression.
 *
 * @param mathContent - The content between $ delimiters
 * @returns Repaired content with backslashes restored
 */
function repairMathContent(mathContent: string): string {
  let repaired = mathContent;

  // Replace literal escape characters with their LaTeX equivalents
  // We need to be careful to only replace when it's likely a LaTeX command

  // Handle \t (tab) - U+0009
  repaired = repaired.replace(/\t(\w+)/g, (match, remainder) => {
    logger.debug('LATEX_REPAIR', 'Tab match:', { match: match.replace(/\t/g, '[TAB]'), remainder });
    const cmd = tryReconstructCommand('t', 't' + remainder);
    if (cmd) {
      const result = '\\' + cmd + remainder.slice(cmd.length - 1);
      logger.debug('LATEX_REPAIR', 'Tab reconstructed:', cmd, '→', result);
      return result;
    }
    logger.debug('LATEX_REPAIR', 'Tab not reconstructed');
    return match; // Keep original if can't reconstruct
  });

  // Handle \n (newline) - U+000A
  repaired = repaired.replace(/\n(\w+)/g, (match, remainder) => {
    logger.debug('LATEX_REPAIR', 'Newline match:', { match: match.replace(/\n/g, '[NL]'), remainder });
    const cmd = tryReconstructCommand('n', 'n' + remainder);
    if (cmd) {
      const result = '\\' + cmd + remainder.slice(cmd.length - 1);
      logger.debug('LATEX_REPAIR', 'Newline reconstructed:', cmd, '→', result);
      return result;
    }
    logger.debug('LATEX_REPAIR', 'Newline not reconstructed');
    return match;
  });

  // Handle \r (carriage return) - U+000D
  repaired = repaired.replace(/\r(\w+)/g, (match, remainder) => {
    const cmd = tryReconstructCommand('r', 'r' + remainder);
    if (cmd) {
      return '\\' + cmd + remainder.slice(cmd.length - 1);
    }
    return match;
  });

  // Handle \b (backspace) - U+0008
  repaired = repaired.replace(/\x08(\w+)/g, (match, remainder) => {
    const cmd = tryReconstructCommand('b', 'b' + remainder);
    if (cmd) {
      return '\\' + cmd + remainder.slice(cmd.length - 1);
    }
    return match;
  });

  // Handle \f (form feed) - U+000C
  repaired = repaired.replace(/\f(\w+)/g, (match, remainder) => {
    const cmd = tryReconstructCommand('f', 'f' + remainder);
    if (cmd) {
      return '\\' + cmd + remainder.slice(cmd.length - 1);
    }
    return match;
  });

  return repaired;
}

/**
 * Repairs corrupted LaTeX commands in the entire text.
 * Only processes content within math delimiters ($...$, $$...$$).
 *
 * @param text - The text potentially containing corrupted LaTeX
 * @returns Text with repaired LaTeX commands
 */
export function repairLatexCommands(text: string): string {
  logger.debug('LATEX_REPAIR', 'Input text:', text.substring(0, 200));

  // Check if there are any corrupted characters
  const hasCorruption = /[\t\n\r\b\f]/.test(text);
  logger.debug('LATEX_REPAIR', 'Has corruption characters:', hasCorruption);

  if (hasCorruption) {
    // Log the specific characters found
    const tabs = (text.match(/\t/g) || []).length;
    const newlines = (text.match(/\n/g) || []).length;
    const returns = (text.match(/\r/g) || []).length;
    logger.debug('LATEX_REPAIR', 'Found:', { tabs, newlines, returns });
  }

  let result = text;

  // First, handle display math ($$...$$)
  result = result.replace(/\$\$([\s\S]*?)\$\$/g, (match, content) => {
    const repaired = repairMathContent(content);
    if (repaired !== content) {
      logger.debug('LATEX_REPAIR', 'Display math repaired:', { before: content, after: repaired });
    }
    return '$$' + repaired + '$$';
  });

  // Then, handle inline math ($...$)
  // Use negative lookbehind/lookahead to avoid matching $$ delimiters
  result = result.replace(/(?<!\$)\$(?!\$)((?:(?!\$\$)[^\$])+?)\$(?!\$)/g, (match, content) => {
    const repaired = repairMathContent(content);
    if (repaired !== content) {
      logger.debug('LATEX_REPAIR', 'Inline math repaired:', { before: content, after: repaired });
    }
    return '$' + repaired + '$';
  });

  if (result !== text) {
    logger.debug('LATEX_REPAIR', 'Output text:', result.substring(0, 200));
  } else {
    logger.debug('LATEX_REPAIR', 'No changes made');
  }

  return result;
}

/**
 * Diagnostic function to check if text contains corrupted LaTeX.
 * Useful for debugging and logging.
 *
 * @param text - The text to check
 * @returns True if corruption is detected
 */
export function hasCorruptedLatex(text: string): boolean {
  // Check for escape characters within math delimiters
  const mathRegex = /\$\$?([\s\S]*?)\$\$/g;
  let match;

  while ((match = mathRegex.exec(text)) !== null) {
    const content = match[1];

    // Check for literal escape characters
    if (/[\t\n\r\b\f]/.test(content)) {
      return true;
    }
  }

  return false;
}
