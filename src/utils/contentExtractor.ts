/**
 * Content extraction utilities for research papers
 * Extracts clean text from web pages and PDFs
 */

export interface ExtractedContent {
  text: string;
  headings: string[];
  metadata: {
    wordCount: number;
    charCount: number;
    hasStructure: boolean;
  };
}

export interface ContentChunk {
  id: string;
  content: string;
  startIndex: number;
  endIndex: number;
  heading?: string;
}

/**
 * Check if the current page is a PDF
 */
export function isPDFPage(): boolean {
  // Check if URL ends with .pdf
  if (window.location.href.toLowerCase().endsWith('.pdf')) {
    return true;
  }

  // Check if the page has a PDF embed/object
  const pdfEmbed = document.querySelector('embed[type="application/pdf"]');
  const pdfObject = document.querySelector('object[type="application/pdf"]');

  // Check if the body only contains an embed (common in Chrome PDF viewer)
  const body = document.body;
  if (body && body.children.length === 1 && body.children[0].tagName === 'EMBED') {
    return true;
  }

  return !!(pdfEmbed || pdfObject);
}

/**
 * Extract clean text from the current page
 * Removes navigation, ads, scripts, and focuses on main content
 */
export function extractPageText(): ExtractedContent {
  // Clone the document to avoid modifying the actual page
  const clone = document.cloneNode(true) as Document;

  // Remove unwanted elements
  const selectorsToRemove = [
    'script',
    'style',
    'noscript',
    'iframe',
    'nav',
    'header:not(.article-header):not(.paper-header)',
    'footer',
    '.navigation',
    '.nav',
    '.menu',
    '.sidebar',
    '.advertisement',
    '.ad',
    '.comments',
    '.social-share',
    '.cookie-banner',
    '[role="navigation"]',
    '[role="banner"]',
    '[role="complementary"]',
  ];

  selectorsToRemove.forEach(selector => {
    const elements = clone.querySelectorAll(selector);
    elements.forEach(el => el.remove());
  });

  // Try to find main content area
  const mainContent =
    clone.querySelector('main') ||
    clone.querySelector('article') ||
    clone.querySelector('[role="main"]') ||
    clone.querySelector('.main-content') ||
    clone.querySelector('#main-content') ||
    clone.querySelector('.content') ||
    clone.querySelector('#content') ||
    clone.body;

  if (!mainContent) {
    return {
      text: '',
      headings: [],
      metadata: {
        wordCount: 0,
        charCount: 0,
        hasStructure: false,
      },
    };
  }

  // Extract headings for structure
  const headings: string[] = [];
  const headingElements = mainContent.querySelectorAll('h1, h2, h3, h4, h5, h6');
  headingElements.forEach(h => {
    const text = h.textContent?.trim();
    if (text) {
      headings.push(text);
    }
  });

  // Extract clean text
  let text = mainContent.textContent || '';

  // Clean up the text
  text = text
    .replace(/\s+/g, ' ') // Normalize whitespace
    .replace(/\n\s*\n/g, '\n\n') // Normalize line breaks
    .trim();

  // Calculate metadata
  const wordCount = text.split(/\s+/).length;
  const charCount = text.length;
  const hasStructure = headings.length > 0;

  return {
    text,
    headings,
    metadata: {
      wordCount,
      charCount,
      hasStructure,
    },
  };
}

/**
 * Extract text from specific sections
 * Useful for targeted extraction (e.g., just the abstract or methods)
 */
export function extractSection(sectionName: string): string | null {
  const sectionNames = [sectionName.toLowerCase()];

  // Add variations
  if (sectionName.toLowerCase() === 'abstract') {
    sectionNames.push('summary');
  } else if (sectionName.toLowerCase() === 'methods') {
    sectionNames.push('methodology', 'materials and methods', 'methods and materials');
  } else if (sectionName.toLowerCase() === 'results') {
    sectionNames.push('findings');
  } else if (sectionName.toLowerCase() === 'discussion') {
    sectionNames.push('conclusion', 'conclusions');
  }

  // Try to find the section by heading
  const headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6');

  for (const heading of headings) {
    const headingText = heading.textContent?.toLowerCase().trim() || '';

    // Check if heading matches any section name
    const matches = sectionNames.some(name =>
      headingText.includes(name) || name.includes(headingText)
    );

    if (matches) {
      // Get content until next heading of same or higher level
      const level = parseInt(heading.tagName[1]);
      let content = '';
      let currentElement = heading.nextElementSibling;

      while (currentElement) {
        // Stop if we hit another heading of same or higher level
        if (currentElement.matches('h1, h2, h3, h4, h5, h6')) {
          const currentLevel = parseInt(currentElement.tagName[1]);
          if (currentLevel <= level) {
            break;
          }
        }

        content += (currentElement.textContent || '') + '\n';
        currentElement = currentElement.nextElementSibling;
      }

      return content.trim();
    }
  }

  return null;
}

/**
 * Chunk content into manageable pieces with overlap
 * Uses sliding window approach for better context preservation
 * Enhanced to preserve section context from headings
 */
export function chunkContent(
  content: string,
  chunkSize: number = 1000,
  overlap: number = 200
): ContentChunk[] {
  const chunks: ContentChunk[] = [];

  // If content is smaller than chunk size, return as single chunk
  if (content.length <= chunkSize) {
    return [
      {
        id: '0',
        content: content,
        startIndex: 0,
        endIndex: content.length,
      },
    ];
  }

  // Extract headings from the document for section context
  const headingMap = new Map<number, string>();
  const headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6');

  headings.forEach(heading => {
    const text = heading.textContent?.trim();
    if (text) {
      // Find approximate position in content
      const position = content.indexOf(text);
      if (position !== -1) {
        headingMap.set(position, text);
      }
    }
  });

  // Split by sentences to avoid breaking mid-sentence
  const sentences = content.match(/[^.!?]+[.!?]+/g) || [content];

  let currentChunk = '';
  let currentStartIndex = 0;
  let chunkIndex = 0;
  let currentHeading: string | undefined;

  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i];

    // Check if we're at a new section
    const sentenceStart = currentStartIndex + currentChunk.length;
    for (const [pos, heading] of headingMap.entries()) {
      if (Math.abs(pos - sentenceStart) < 50) {
        currentHeading = heading;
        break;
      }
    }

    // If adding this sentence would exceed chunk size, save current chunk
    if (currentChunk.length + sentence.length > chunkSize && currentChunk.length > 0) {
      chunks.push({
        id: chunkIndex.toString(),
        content: currentChunk.trim(),
        startIndex: currentStartIndex,
        endIndex: currentStartIndex + currentChunk.length,
        heading: currentHeading,
      });

      chunkIndex++;

      // Start new chunk with overlap
      // Find sentences to include in overlap
      const overlapSentences: string[] = [];
      let overlapLength = 0;

      for (let j = i - 1; j >= 0; j--) {
        if (overlapLength + sentences[j].length <= overlap) {
          overlapSentences.unshift(sentences[j]);
          overlapLength += sentences[j].length;
        } else {
          break;
        }
      }

      currentChunk = overlapSentences.join('') + sentence;
      currentStartIndex += currentChunk.length - overlapLength;
    } else {
      currentChunk += sentence;
    }
  }

  // Add final chunk if there's content left
  if (currentChunk.trim().length > 0) {
    chunks.push({
      id: chunkIndex.toString(),
      content: currentChunk.trim(),
      startIndex: currentStartIndex,
      endIndex: currentStartIndex + currentChunk.length,
      heading: currentHeading,
    });
  }

  return chunks;
}

/**
 * Estimate token count for text
 * Rough estimation: 1 token ≈ 4 characters
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Truncate text to fit within token budget
 */
export function truncateToTokens(text: string, maxTokens: number): string {
  const maxChars = maxTokens * 4;

  if (text.length <= maxChars) {
    return text;
  }

  // Try to truncate at sentence boundary
  const truncated = text.slice(0, maxChars);
  const lastPeriod = truncated.lastIndexOf('.');
  const lastQuestion = truncated.lastIndexOf('?');
  const lastExclamation = truncated.lastIndexOf('!');

  const lastSentenceEnd = Math.max(lastPeriod, lastQuestion, lastExclamation);

  if (lastSentenceEnd > maxChars * 0.8) {
    return truncated.slice(0, lastSentenceEnd + 1);
  }

  return truncated + '...';
}
