import { marked } from 'marked';
import DOMPurify from 'dompurify';

/**
 * MarkdownRenderer Component
 * Safely renders markdown content with Tailwind styling
 *
 * Features:
 * - Parses markdown to HTML using marked
 * - Sanitizes HTML with DOMPurify to prevent XSS
 * - Applies Tailwind classes for proper styling
 */

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

export function MarkdownRenderer({ content, className = '' }: MarkdownRendererProps) {
  // Configure marked options
  marked.setOptions({
    breaks: true, // Convert \n to <br>
    gfm: true, // GitHub Flavored Markdown
  });

  // Parse markdown to HTML
  const rawHTML = marked.parse(content) as string;

  // Sanitize HTML to prevent XSS attacks
  const sanitizedHTML = DOMPurify.sanitize(rawHTML, {
    ALLOWED_TAGS: [
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'p', 'br', 'hr',
      'strong', 'em', 'code', 'pre',
      'ul', 'ol', 'li',
      'a', 'blockquote',
      'table', 'thead', 'tbody', 'tr', 'th', 'td',
      'del', 'ins', 'sub', 'sup',
    ],
    ALLOWED_ATTR: ['href', 'target', 'rel', 'class'],
  });

  return (
    <div
      className={`markdown-content ${className}`}
      dangerouslySetInnerHTML={{ __html: sanitizedHTML }}
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
 *   @apply px-1.5 py-0.5 bg-gray-100 text-bear-700 rounded text-sm font-mono;
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
 *   @apply text-bear-600 hover:text-bear-700 underline;
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
