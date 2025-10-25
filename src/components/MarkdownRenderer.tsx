import { useState, useEffect } from 'preact/hooks';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

/**
 * MarkdownRenderer Component
 * Safely renders markdown content with Tailwind styling and LaTeX support
 *
 * Features:
 * - Parses markdown to HTML using marked
 * - Renders LaTeX equations using KaTeX (supports $...$, $$...$$, \(...\), \[...\])
 * - Sanitizes HTML with DOMPurify to prevent XSS
 * - Applies Tailwind classes for proper styling
 * - Injects KaTeX CSS for content scripts, uses bundled CSS for sidepanel
 */

// Inject KaTeX CSS immediately when module loads (for content scripts)
// Sidepanel uses CSS link in HTML instead
if (typeof document !== 'undefined' && !document.querySelector('link[href*="katex"]')) {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  // Use bundled CSS from extension to bypass host page CSP
  link.href = chrome.runtime.getURL('katex/katex.min.css');
  document.head.appendChild(link);
}

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

/**
 * Extract LaTeX expressions and replace with placeholders to protect from markdown escaping
 * Returns the modified content and an array of extracted LaTeX expressions
 */
function extractLatexWithPlaceholders(content: string): { content: string; expressions: Array<{ placeholder: string; latex: string; displayMode: boolean }> } {
  const expressions: Array<{ placeholder: string; latex: string; displayMode: boolean }> = [];
  let processed = content;
  let counter = 0;

  // Extract display math first ($$...$$ and \[...\])
  // Match $$...$$ (display mode)
  processed = processed.replace(/\$\$([\s\S]+?)\$\$/g, (match, latex) => {
    const placeholder = `{{KATEX_DISPLAY_${counter}}}`;
    expressions.push({ placeholder, latex: latex.trim(), displayMode: true });
    counter++;
    return placeholder;
  });

  // Match \[...\] (display mode)
  processed = processed.replace(/\\\[([\s\S]+?)\\\]/g, (match, latex) => {
    const placeholder = `{{KATEX_DISPLAY_${counter}}}`;
    expressions.push({ placeholder, latex: latex.trim(), displayMode: true });
    counter++;
    return placeholder;
  });

  // Extract inline math ($...$ and \(...\))
  // Match $...$ (inline mode) - simpler pattern since $$ was already removed
  processed = processed.replace(/\$([^\$]+?)\$/g, (match, latex) => {
    const placeholder = `{{KATEX_INLINE_${counter}}}`;
    expressions.push({ placeholder, latex: latex.trim(), displayMode: false });
    counter++;
    return placeholder;
  });

  // Match \(...\) (inline mode) - support multiline with [\s\S]
  processed = processed.replace(/\\\(([\s\S]+?)\\\)/g, (match, latex) => {
    const placeholder = `{{KATEX_INLINE_${counter}}}`;
    expressions.push({ placeholder, latex: latex.trim(), displayMode: false });
    counter++;
    return placeholder;
  });

  return { content: processed, expressions };
}

/**
 * Render LaTeX expressions using KaTeX and replace placeholders with rendered HTML
 * Uses dynamic import to load KaTeX only when needed
 */
async function renderLatexExpressions(
  content: string,
  expressions: Array<{ placeholder: string; latex: string; displayMode: boolean }>
): Promise<string> {
  if (expressions.length === 0) {
    return content; // No LaTeX to render
  }

  try {
    // Dynamically import KaTeX only when LaTeX content is detected
    const katexModule = await import('katex');
    const katex = katexModule.default;

    let processed = content;

    // Replace each placeholder with rendered KaTeX HTML
    for (const { placeholder, latex, displayMode } of expressions) {
      try {
        const rendered = katex.renderToString(latex, { displayMode, throwOnError: false });
        processed = processed.replaceAll(placeholder, rendered);
      } catch (error) {
        console.error('[LaTeX Render] KaTeX rendering error for:', latex, error);
        // Keep placeholder if rendering fails
      }
    }

    return processed;
  } catch (error) {
    console.error('Failed to load KaTeX:', error);
    return content; // Return original content if KaTeX fails to load
  }
}

export function MarkdownRenderer({ content, className = '' }: MarkdownRendererProps) {
  const [processedHTML, setProcessedHTML] = useState<string>('');

  // Configure marked options
  marked.setOptions({
    breaks: true, // Convert \n to <br>
    gfm: true, // GitHub Flavored Markdown
  });

  // Defensive check: ensure content is always a string
  const safeContent = typeof content === 'string' ? content : String(content || '');

  useEffect(() => {
    // Process content asynchronously
    const processContent = async () => {
      // Step 1: Extract LaTeX and replace with placeholders (protects from markdown escaping)
      const { content: contentWithPlaceholders, expressions } = extractLatexWithPlaceholders(safeContent);

      // Step 2: Parse markdown to HTML (placeholders are safe from escaping)
      const rawHTML = marked.parse(contentWithPlaceholders) as string;

      // Step 3: Render LaTeX expressions and replace placeholders with KaTeX HTML
      const htmlWithLatex = await renderLatexExpressions(rawHTML, expressions);

      // Step 4: Sanitize HTML to prevent XSS attacks
      const sanitizedHTML = DOMPurify.sanitize(htmlWithLatex, {
        ALLOWED_TAGS: [
          // Standard HTML tags
          'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
          'p', 'br', 'hr',
          'strong', 'em', 'code', 'pre',
          'ul', 'ol', 'li',
          'a', 'blockquote',
          'table', 'thead', 'tbody', 'tr', 'th', 'td',
          'del', 'ins', 'sub', 'sup',
          // KaTeX container tags
          'span', 'div',
          // MathML tags (complete set for KaTeX)
          'math', 'annotation', 'semantics',
          'mrow', 'mi', 'mn', 'mo', 'mtext', 'mspace',
          'msup', 'msub', 'msubsup',  // ← Added msubsup!
          'mfrac', 'msqrt', 'mroot',
          'mover', 'munder', 'munderover',
          'mtable', 'mtr', 'mtd', 'mlabeledtr',
          'mmultiscripts', 'mprescripts', 'none',
          'menclose', 'mpadded', 'mphantom', 'mglyph',
        ],
        ALLOWED_ATTR: [
          'href', 'target', 'rel', 'class', 'style', 'aria-hidden', 'xmlns',
          // MathML attributes used by KaTeX
          'mathvariant', 'display', 'stretchy', 'fence', 'separator',
          'lspace', 'rspace', 'notation', 'encoding',
        ],
      });

      setProcessedHTML(sanitizedHTML);
    };

    processContent();
  }, [safeContent]);

  return (
    <div
      className={`markdown-content ${className}`}
      dangerouslySetInnerHTML={{ __html: processedHTML }}
      style={{
        // Custom styles for markdown elements
        // We use inline styles scoped to this component
      }}
    />
  );
}

// Add global CSS styles for markdown content (include in your main CSS or Tailwind config)
// These styles will be applied via the .markdown-content class

/**
 * Add these styles to your global CSS or include as a style tag:
 *
 * .markdown-content {
 *   @apply text-gray-700 leading-relaxed;
 * }
 *
 * .markdown-content > * + * {
 *   @apply mt-4;
 * }
 *
 * .markdown-content h1 {
 *   @apply text-2xl font-bold text-gray-900 mt-6 mb-4;
 * }
 *
 * .markdown-content h2 {
 *   @apply text-xl font-bold text-gray-900 mt-5 mb-3;
 * }
 *
 * .markdown-content h3 {
 *   @apply text-lg font-semibold text-gray-900 mt-4 mb-2;
 * }
 *
 * .markdown-content h4 {
 *   @apply text-base font-semibold text-gray-900 mt-3 mb-2;
 * }
 *
 * .markdown-content p {
 *   @apply text-gray-700 leading-relaxed;
 * }
 *
 * .markdown-content strong {
 *   @apply font-semibold text-gray-900;
 * }
 *
 * .markdown-content em {
 *   @apply italic;
 * }
 *
 * .markdown-content code {
 *   @apply px-1.5 py-0.5 bg-gray-100 text-blue-700 rounded text-sm font-mono;
 * }
 *
 * .markdown-content pre {
 *   @apply bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto my-4;
 * }
 *
 * .markdown-content pre code {
 *   @apply bg-transparent text-gray-100 p-0;
 * }
 *
 * .markdown-content ul {
 *   @apply list-disc list-inside space-y-1 ml-4;
 * }
 *
 * .markdown-content ol {
 *   @apply list-decimal list-inside space-y-1 ml-4;
 * }
 *
 * .markdown-content li {
 *   @apply text-gray-700;
 * }
 *
 * .markdown-content a {
 *   @apply text-blue-600 hover:text-blue-700 underline;
 * }
 *
 * .markdown-content blockquote {
 *   @apply border-l-4 border-gray-300 pl-4 italic text-gray-600 my-4;
 * }
 *
 * .markdown-content hr {
 *   @apply border-t border-gray-300 my-6;
 * }
 *
 * .markdown-content table {
 *   @apply w-full border-collapse my-4;
 * }
 *
 * .markdown-content th {
 *   @apply border border-gray-300 bg-gray-100 px-4 py-2 text-left font-semibold;
 * }
 *
 * .markdown-content td {
 *   @apply border border-gray-300 px-4 py-2;
 * }
 */
