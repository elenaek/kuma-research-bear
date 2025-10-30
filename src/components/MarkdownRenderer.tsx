import { useState, useEffect, useRef } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { repairLatexCommands } from '../utils/latexRepair.ts';

/**
 * MarkdownRenderer Component
 * Safely renders markdown content with Tailwind styling and LaTeX support
 *
 * Features:
 * - Parses markdown to HTML using marked
 * - Renders LaTeX equations using MathJax 3 with SVG output (supports $...$, $$...$$, \(...\), \[...\])
 * - Sanitizes HTML with DOMPurify to prevent XSS
 * - Applies Tailwind classes for proper styling
 * - No external CSS needed - SVG output is self-contained
 */

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
    const placeholder = `{{MATHJAX_DISPLAY_${counter}}}`;
    expressions.push({ placeholder, latex: latex.trim(), displayMode: true });
    counter++;
    return placeholder;
  });

  // Match \[...\] (display mode)
  processed = processed.replace(/\\\[([\s\S]+?)\\\]/g, (match, latex) => {
    const placeholder = `{{MATHJAX_DISPLAY_${counter}}}`;
    expressions.push({ placeholder, latex: latex.trim(), displayMode: true });
    counter++;
    return placeholder;
  });

  // Extract inline math ($...$ and \(...\))
  // Match $...$ (inline mode) - simpler pattern since $$ was already removed
  processed = processed.replace(/\$([^\$]+?)\$/g, (match, latex) => {
    const placeholder = `{{MATHJAX_INLINE_${counter}}}`;
    expressions.push({ placeholder, latex: latex.trim(), displayMode: false });
    counter++;
    return placeholder;
  });

  // Match \(...\) (inline mode) - support multiline with [\s\S]
  processed = processed.replace(/\\\(([\s\S]+?)\\\)/g, (match, latex) => {
    const placeholder = `{{MATHJAX_INLINE_${counter}}}`;
    expressions.push({ placeholder, latex: latex.trim(), displayMode: false });
    counter++;
    return placeholder;
  });

  return { content: processed, expressions };
}

/**
 * Escape HTML characters for safe use in attributes
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Calculate optimal popover position based on trigger element and viewport
 */
function calculatePopoverPosition(
  triggerRect: DOMRect,
  popoverWidth: number,
  popoverHeight: number
): { top: number; left: number; placement: 'top' | 'bottom' | 'left' | 'right' } {
  const spacing = 12; // Gap between trigger and popover
  const viewport = {
    width: window.innerWidth,
    height: window.innerHeight,
    scrollX: window.scrollX,
    scrollY: window.scrollY
  };

  // Try positions in order of preference: top, bottom, right, left
  // Choose first one that fits comfortably in viewport

  // Try top
  if (triggerRect.top - popoverHeight - spacing > 20) {
    return {
      placement: 'top',
      top: triggerRect.top + viewport.scrollY - popoverHeight - spacing,
      left: Math.max(
        20,
        Math.min(
          triggerRect.left + viewport.scrollX + (triggerRect.width - popoverWidth) / 2,
          viewport.width - popoverWidth - 20
        )
      )
    };
  }

  // Try bottom
  if (triggerRect.bottom + popoverHeight + spacing < viewport.height - 20) {
    return {
      placement: 'bottom',
      top: triggerRect.bottom + viewport.scrollY + spacing,
      left: Math.max(
        20,
        Math.min(
          triggerRect.left + viewport.scrollX + (triggerRect.width - popoverWidth) / 2,
          viewport.width - popoverWidth - 20
        )
      )
    };
  }

  // Try right
  if (triggerRect.right + popoverWidth + spacing < viewport.width - 20) {
    return {
      placement: 'right',
      top: Math.max(
        20,
        Math.min(
          triggerRect.top + viewport.scrollY + (triggerRect.height - popoverHeight) / 2,
          viewport.height - popoverHeight - 20
        )
      ),
      left: triggerRect.right + viewport.scrollX + spacing
    };
  }

  // Fallback to left
  return {
    placement: 'left',
    top: Math.max(
      20,
      Math.min(
        triggerRect.top + viewport.scrollY + (triggerRect.height - popoverHeight) / 2,
        viewport.height - popoverHeight - 20
      )
    ),
    left: triggerRect.left + viewport.scrollX - popoverWidth - spacing
  };
}

/**
 * Render LaTeX expressions using MathJax 3 and replace placeholders with rendered SVG
 * Uses dynamic import to load MathJax only when needed
 */
async function renderLatexExpressions(
  content: string,
  expressions: Array<{ placeholder: string; latex: string; displayMode: boolean }>
): Promise<string> {
  if (expressions.length === 0) {
    return content; // No LaTeX to render
  }

  try {
    // Dynamically import MathJax modules only when LaTeX content is detected
    const [{ mathjax }, { TeX }, { SVG }, { liteAdaptor }, { RegisterHTMLHandler }, { AllPackages }] = await Promise.all([
      import('mathjax-full/js/mathjax.js'),
      import('mathjax-full/js/input/tex.js'),
      import('mathjax-full/js/output/svg.js'),
      import('mathjax-full/js/adaptors/liteAdaptor.js'),
      import('mathjax-full/js/handlers/html.js'),
      import('mathjax-full/js/input/tex/AllPackages.js'),
    ]);

    // Initialize MathJax with SVG output
    const adaptor = liteAdaptor();
    RegisterHTMLHandler(adaptor);

    const tex = new TeX({ packages: AllPackages });
    const svg = new SVG({ fontCache: 'none' });
    const html = mathjax.document('', { InputJax: tex, OutputJax: svg });

    let processed = content;

    // Replace each placeholder with rendered MathJax SVG
    for (const { placeholder, latex, displayMode } of expressions) {
      try {
        // Convert LaTeX to SVG with proper metrics
        const node = html.convert(latex, {
          display: displayMode,
          em: 16,
          ex: 8,
          containerWidth: 80 * 8,
          lineWidth: 1000000,
          scale: 1
        });

        const svgString = adaptor.outerHTML(node);

        // Wrap SVG in a span/div with appropriate class and store LaTeX for zoom feature
        const escapedLatex = escapeHtml(latex);
        const wrappedSvg = displayMode
          ? `<div class="mathjax-display" data-latex="${escapedLatex}">${svgString}</div>`
          : `<span class="mathjax-inline" data-latex="${escapedLatex}">${svgString}</span>`;

        processed = processed.replaceAll(placeholder, wrappedSvg);
      } catch (error) {
        console.error('[LaTeX Render] MathJax rendering error for:', latex, error);
        // Keep placeholder if rendering fails
      }
    }

    return processed;
  } catch (error) {
    console.error('Failed to load MathJax:', error);
    return content; // Return original content if MathJax fails to load
  }
}

export function MarkdownRenderer({ content, className = '' }: MarkdownRendererProps) {
  const [processedHTML, setProcessedHTML] = useState<string>('');
  const [zoomedFormula, setZoomedFormula] = useState<{
    svg: string;
    latex: string;
    isDisplay: boolean;
    triggerRect: DOMRect;
  } | null>(null);
  const [latexCopied, setLatexCopied] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Configure marked options
  marked.setOptions({
    breaks: true, // Convert \n to <br>
    gfm: true, // GitHub Flavored Markdown
  });

  // Defensive check: ensure content is always a string
  let safeContent = typeof content === 'string' ? content : String(content || '');

  // Repair any corrupted LaTeX commands (e.g., \triangle → [TAB]riangle)
  // This happens when JSON.parse interprets \t, \n, \r, \b, \f as escape sequences
  safeContent = repairLatexCommands(safeContent);

  useEffect(() => {
    let isStale = false; // Flag to prevent updating with stale renders

    // Process content asynchronously
    const processContent = async () => {
      // OPTIMIZATION: First pass - show markdown WITHOUT LaTeX processing
      // This provides immediate feedback during streaming
      const quickHTML = marked.parse(safeContent) as string;
      const quickSanitized = DOMPurify.sanitize(quickHTML, {
        ALLOWED_TAGS: [
          // Standard HTML tags
          'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
          'p', 'br', 'hr',
          'strong', 'em', 'code', 'pre',
          'ul', 'ol', 'li',
          'a', 'blockquote',
          'table', 'thead', 'tbody', 'tr', 'th', 'td',
          'del', 'ins', 'sub', 'sup',
          'span', 'div',
        ],
        ALLOWED_ATTR: ['href', 'target', 'rel', 'class', 'style'],
      });

      // Show interim content immediately (LaTeX appears in original syntax like $x^2$)
      if (!isStale) {
        setProcessedHTML(quickSanitized);
      }

      // Step 1: Extract LaTeX and replace with placeholders (protects from markdown escaping)
      const { content: contentWithPlaceholders, expressions } = extractLatexWithPlaceholders(safeContent);

      // Step 2: Parse markdown to HTML (placeholders are safe from escaping)
      const rawHTML = marked.parse(contentWithPlaceholders) as string;

      // Step 3: Render LaTeX expressions and replace placeholders with MathJax SVG (async)
      const htmlWithLatex = await renderLatexExpressions(rawHTML, expressions);

      // Step 4: Sanitize HTML with full tag set (including SVG) and update
      // Only update if this render is still current
      if (!isStale) {
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
            // MathJax container tags
            'span', 'div',
            // SVG tags (for MathJax SVG output)
            'svg', 'g', 'path', 'rect', 'line', 'circle', 'ellipse',
            'polygon', 'polyline', 'text', 'tspan', 'defs', 'use',
            'clipPath', 'foreignObject', 'marker', 'symbol', 'title',
            'desc', 'metadata', 'image', 'linearGradient', 'radialGradient',
            'stop', 'pattern', 'mask', 'filter', 'feGaussianBlur',
          ],
          ALLOWED_ATTR: [
            'href', 'target', 'rel', 'class', 'style', 'aria-hidden',
            // SVG attributes used by MathJax
            'xmlns', 'xmlns:xlink', 'viewBox', 'width', 'height',
            'd', 'transform', 'fill', 'stroke', 'stroke-width',
            'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry',
            'dx', 'dy', 'points', 'id', 'xlink:href',
            'font-family', 'font-size', 'font-weight', 'font-style',
            'text-anchor', 'dominant-baseline', 'alignment-baseline',
            'data-c', 'data-mml-node', 'data-mjx-texclass', 'data-latex',
          ],
        });

        setProcessedHTML(sanitizedHTML);
      }
    };

    processContent();

    // Cleanup: mark this render as stale when content changes
    return () => {
      isStale = true;
    };
  }, [safeContent]);

  // Click handler for zooming formulas
  useEffect(() => {
    if (!containerRef.current || !processedHTML) return;

    const container = containerRef.current;

    const handleSvgClick = (e: MouseEvent) => {
      try {
        const target = e.target as HTMLElement;

        // Find closest SVG (could be the SVG itself or a child element)
        const svg = target.closest('svg');
        if (!svg) return;

        // Check if it's a MathJax SVG
        const wrapper = svg.closest('.mathjax-inline, .mathjax-display') as HTMLElement;
        if (!wrapper) return;

        // Stop propagation to prevent document listeners from interfering
        e.stopPropagation();

        // Extract metadata
        const isDisplay = wrapper.classList.contains('mathjax-display');
        const svgString = svg.outerHTML;
        const latex = wrapper.getAttribute('data-latex') || '';
        const triggerRect = svg.getBoundingClientRect();

        setZoomedFormula({ svg: svgString, latex, isDisplay, triggerRect });
      } catch (error) {
        console.error('[LaTeX Zoom Error]', error);
      }
    };

    container.addEventListener('click', handleSvgClick);

    return () => {
      container.removeEventListener('click', handleSvgClick);
    };
  }, [processedHTML]);

  // Close zoom function
  const closeZoom = () => {
    setZoomedFormula(null);
    setLatexCopied(false);
  };

  // Copy to clipboard helper with fallback
  const copyToClipboard = async (text: string): Promise<boolean> => {
    try {
      // Try modern Clipboard API first
      await navigator.clipboard.writeText(text);
      return true;
    } catch (error) {
      console.error('[Clipboard] Modern API failed:', error);

      // Fallback to execCommand
      try {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        const success = document.execCommand('copy');
        document.body.removeChild(textarea);
        return success;
      } catch (fallbackError) {
        console.error('[Clipboard] Fallback failed:', fallbackError);
        return false;
      }
    }
  };

  // Handle copying LaTeX source
  const handleCopyLatex = async () => {
    if (!zoomedFormula?.latex) return;

    const success = await copyToClipboard(zoomedFormula.latex);
    if (success) {
      setLatexCopied(true);
      setTimeout(() => setLatexCopied(false), 2000);
    }
  };

  // Handle ESC key to close
  useEffect(() => {
    if (!zoomedFormula) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeZoom();
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [zoomedFormula]);

  // Handle outside click to close
  useEffect(() => {
    if (!zoomedFormula) return;

    const handleClickOutside = (e: MouseEvent) => {
      const popover = popoverRef.current;
      if (popover && !popover.contains(e.target as Node)) {
        closeZoom();
      }
    };

    // Small delay to prevent immediate close from trigger click
    const timer = setTimeout(() => {
      document.addEventListener('click', handleClickOutside);
    }, 0);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('click', handleClickOutside);
    };
  }, [zoomedFormula]);

  // Calculate popover position if formula is zoomed
  const popoverPosition = zoomedFormula
    ? calculatePopoverPosition(zoomedFormula.triggerRect, 500, 300)
    : null;

  return (
    <>
      <div
        ref={containerRef}
        className={`markdown-content ${className}`}
        dangerouslySetInnerHTML={{ __html: processedHTML }}
        style={{
          // Custom styles for markdown elements
          // We use inline styles scoped to this component
        }}
      />

      {/* Zoom Popover - Use portal to escape Shadow DOM */}
      {zoomedFormula && popoverPosition && createPortal(
        <div
          ref={popoverRef}
          className={`math-popover math-popover-${popoverPosition.placement}`}
          style={{
            position: 'fixed',
            top: `${popoverPosition.top}px`,
            left: `${popoverPosition.left}px`
          }}
          role="tooltip"
          aria-label="Zoomed formula"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="math-popover-arrow" />
          <button
            className="math-popover-close"
            onClick={closeZoom}
            aria-label="Close"
            title="Close (ESC)"
          >
            ✕
          </button>
          <button
            className={`math-popover-copy ${latexCopied ? 'copied' : ''}`}
            onClick={handleCopyLatex}
            aria-label="Copy LaTeX source"
            title="Copy LaTeX source"
          >
            {latexCopied ? (
              <>
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span>Copied!</span>
              </>
            ) : (
              <>
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                <span>Copy</span>
              </>
            )}
          </button>
          <div
            className="math-popover-formula"
            dangerouslySetInnerHTML={{ __html: zoomedFormula.svg }}
          />
          {zoomedFormula.latex && (
            <div className="math-popover-latex" title="Original LaTeX">
              {zoomedFormula.latex}
            </div>
          )}
        </div>,
        document.body
      )}
    </>
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
