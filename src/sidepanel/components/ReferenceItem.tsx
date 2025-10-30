import { h } from 'preact';
import { useState } from 'preact/hooks';
import { Citation, CitationFormat } from '../../types/index.ts';
import { generateReferenceCitation } from '../../utils/citationFormatters.ts';
import { logger } from '../../utils/logger.ts';

interface ReferenceItemProps {
  citation: Citation;
  format: CitationFormat;
  index: number; // For IEEE numbering
}

export function ReferenceItem({ citation, format, index }: ReferenceItemProps) {
  const [copied, setCopied] = useState(false);

  const referenceCitation = generateReferenceCitation(citation, format, index);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(referenceCitation);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      logger.error('UI', '[Reference Item] Error copying:', error);
    }
  };

  return (
    <div class="reference-item group relative border-l-2 border-gray-300 pl-3 pr-8 py-2 hover:border-blue-500 hover:bg-blue-50 transition-colors cursor-pointer"
         onClick={handleCopy}
         title="Click to copy">
      {/* Reference text */}
      <div class="text-sm text-gray-800 leading-relaxed">
        {referenceCitation}
      </div>

      {/* Copy button */}
      <div class="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
        {copied ? (
          <svg class="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        ) : (
          <svg class="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
        )}
      </div>
    </div>
  );
}
