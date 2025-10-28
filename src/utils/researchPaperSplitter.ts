/**
 * Research Paper Section Extractor
 * Extracts hierarchical sections from HTML papers by parsing heading tags
 * Preserves exact original heading text for accurate citations
 */

export interface PaperSection {
  heading: string;          // Exact original heading text (e.g., "3.2 Multifrequency Angular Power Spectra")
  level: number;            // Heading level (1=h1, 2=h2, 3=h3)
  parentHeading?: string;   // Parent heading if nested (exact original text)
  content: string;          // Text content for this section
  startIndex: number;       // Character position in full document
  endIndex: number;         // End position in full document
  cssSelector?: string;     // CSS selector to locate the heading element
  elementId?: string;       // Element ID if available
  xPath?: string;           // XPath selector as fallback
}

/**
 * Generate a CSS selector for an element
 * Prioritizes ID, then uses tag name + classes + nth-child
 */
function generateCSSSelector(element: HTMLElement): string {
  // If element has an ID, use that (most reliable)
  if (element.id) {
    return `#${element.id}`;
  }

  // Build selector using tag name, classes, and position
  const tag = element.tagName.toLowerCase();
  const classes = element.className ? `.${element.className.trim().split(/\s+/).join('.')}` : '';

  // Get nth-child position
  let nth = 1;
  let sibling = element.previousElementSibling;
  while (sibling) {
    if (sibling.tagName === element.tagName) {
      nth++;
    }
    sibling = sibling.previousElementSibling;
  }

  // Build selector path up to a stable parent (with ID or main content)
  const parts: string[] = [];
  let current: HTMLElement | null = element;
  let depth = 0;
  const maxDepth = 5; // Limit depth to avoid overly long selectors

  while (current && depth < maxDepth) {
    const currentTag = current.tagName.toLowerCase();
    const currentClasses = current.className ? `.${current.className.trim().split(/\s+/).join('.')}` : '';

    if (current.id) {
      parts.unshift(`#${current.id}`);
      break; // Stop at first element with ID
    }

    // Calculate nth-child for this element
    let currentNth = 1;
    let currentSibling = current.previousElementSibling;
    while (currentSibling) {
      if (currentSibling.tagName === current.tagName) {
        currentNth++;
      }
      currentSibling = currentSibling.previousElementSibling;
    }

    parts.unshift(`${currentTag}${currentClasses}:nth-child(${currentNth})`);

    current = current.parentElement;
    depth++;
  }

  return parts.join(' > ');
}

/**
 * Generate XPath for an element (fallback option)
 */
function generateXPath(element: HTMLElement): string {
  if (element.id) {
    return `//*[@id="${element.id}"]`;
  }

  const parts: string[] = [];
  let current: HTMLElement | null = element;

  while (current && current.nodeType === Node.ELEMENT_NODE) {
    let index = 1;
    let sibling = current.previousElementSibling;

    while (sibling) {
      if (sibling.tagName === current.tagName) {
        index++;
      }
      sibling = sibling.previousElementSibling;
    }

    const tagName = current.tagName.toLowerCase();
    parts.unshift(`${tagName}[${index}]`);

    if (current.id) {
      break;
    }

    current = current.parentElement;
  }

  return `/${parts.join('/')}`;
}

/**
 * Extract sections using semantic <section> tags (preferred for modern HTML papers like arXiv)
 * Returns null if no section tags are found
 */
function extractSectionElements(doc: Document): PaperSection[] | null {
  const mainContent = getMainContentElement(doc);
  if (!mainContent) {
    return null;
  }

  // Find all top-level <section> elements (not nested within other sections in our query)
  // We'll handle nesting manually to preserve hierarchy
  const allSections = Array.from(mainContent.querySelectorAll('section'));

  if (allSections.length === 0) {
    return null;
  }

  console.log(`[ResearchPaperSplitter] Found ${allSections.length} <section> elements, extracting with hierarchy...`);

  // Filter to only top-level sections (sections not contained within other sections)
  const topLevelSections = allSections.filter(section => {
    // Check if this section's parent is another section within our main content
    let parent = section.parentElement;
    while (parent && parent !== mainContent) {
      if (parent.tagName === 'SECTION' && allSections.includes(parent as HTMLElement)) {
        return false; // This is nested, skip it
      }
      parent = parent.parentElement;
    }
    return true; // Top-level section
  });

  console.log(`[ResearchPaperSplitter] Found ${topLevelSections.length} top-level sections`);

  const sections: PaperSection[] = [];
  let currentCharIndex = 0;

  // Process each top-level section recursively
  for (const sectionElement of topLevelSections) {
    const extractedSections = extractSectionRecursive(sectionElement, null, currentCharIndex);
    sections.push(...extractedSections);

    // Update character index based on total content extracted
    const lastSection = extractedSections[extractedSections.length - 1];
    if (lastSection) {
      currentCharIndex = lastSection.endIndex;
    }
  }

  return sections.length > 0 ? sections : null;
}

/**
 * Recursively extract a section and its nested subsections
 */
function extractSectionRecursive(
  sectionElement: HTMLElement,
  parentHeading: string | undefined,
  startCharIndex: number
): PaperSection[] {
  const sections: PaperSection[] = [];

  // Find the heading within this section (first h1, h2, h3, h4, h5, h6)
  const headingElement = sectionElement.querySelector('h1, h2, h3, h4, h5, h6');

  if (!headingElement) {
    console.warn('[ResearchPaperSplitter] Section element has no heading, skipping');
    return [];
  }

  const heading = headingElement.textContent?.trim() || '';
  if (!heading) {
    return [];
  }

  const level = parseInt(headingElement.tagName.substring(1)); // h1 -> 1, h2 -> 2, etc.

  // Find nested <section> elements within this section
  const nestedSections = Array.from(sectionElement.querySelectorAll(':scope > section'));

  // Extract content excluding nested sections
  // We want the content of THIS section only, not its subsections
  let content = '';

  if (nestedSections.length > 0) {
    // Clone the section to avoid modifying the original
    const clone = sectionElement.cloneNode(true) as HTMLElement;

    // Remove all nested sections from the clone
    const nestedInClone = clone.querySelectorAll(':scope > section');
    nestedInClone.forEach(nested => nested.remove());

    // Get text content from the clone
    content = getTextContent(clone);
  } else {
    // No nested sections, just get all content
    content = getTextContent(sectionElement);
  }

  // Add this section
  const startIndex = startCharIndex;
  const endIndex = startCharIndex + content.length;

  // Generate selectors for scroll-to-source functionality
  const cssSelector = generateCSSSelector(headingElement as HTMLElement);
  const elementId = headingElement.id || undefined;
  const xPath = generateXPath(headingElement as HTMLElement);

  sections.push({
    heading,
    level,
    parentHeading,
    content: content.trim(),
    startIndex,
    endIndex,
    cssSelector,
    elementId,
    xPath,
  });

  let currentCharIndex = endIndex;

  // Process nested sections recursively
  for (const nestedSection of nestedSections) {
    const nestedSectionResults = extractSectionRecursive(
      nestedSection as HTMLElement,
      heading, // Parent heading is this section's heading
      currentCharIndex
    );

    sections.push(...nestedSectionResults);

    // Update character index
    const lastNested = nestedSectionResults[nestedSectionResults.length - 1];
    if (lastNested) {
      currentCharIndex = lastNested.endIndex;
    }
  }

  return sections;
}

/**
 * Extract hierarchical sections from HTML content
 * Tries section-based extraction first, falls back to heading-based extraction
 * @param doc Optional Document object (defaults to global document in browser context)
 */
export async function extractHTMLSections(doc?: Document): Promise<PaperSection[]> {
  try {
    // Use provided document or fall back to global document
    const document = doc || (typeof window !== 'undefined' ? window.document : undefined);

    // Guard against non-document contexts
    if (!document) {
      console.warn('[ResearchPaperSplitter] No document available');
      return [];
    }

    // STRATEGY 1: Try semantic <section> tag extraction first (preferred for modern papers)
    console.log('[ResearchPaperSplitter] Attempting section-based extraction...');
    const sectionBasedResults = extractSectionElements(document);

    if (sectionBasedResults && sectionBasedResults.length > 0) {
      console.log(`[ResearchPaperSplitter] ✓ Extracted ${sectionBasedResults.length} sections using <section> tags`);

      // Log section structure for debugging
      console.log('[ResearchPaperSplitter] Section structure:');
      sectionBasedResults.forEach((section, index) => {
        const indent = '  '.repeat(section.level - 1);
        const parentInfo = section.parentHeading ? ` (parent: ${section.parentHeading})` : '';
        console.log(`${indent}${index + 1}. [h${section.level}] ${section.heading}${parentInfo} (${section.content.length} chars)`);
      });

      return sectionBasedResults;
    }

    // STRATEGY 2: Fallback to heading-based extraction (for papers without <section> tags)
    console.log('[ResearchPaperSplitter] No <section> tags found, falling back to heading-based extraction...');

    // Get main content area (filters out navigation, footers, etc.)
    const mainContent = getMainContentElement(document);
    if (!mainContent) {
      console.warn('[ResearchPaperSplitter] No main content found');
      return [];
    }

    // Find all heading elements (h1, h2, h3) in document order
    const headingElements = Array.from(mainContent.querySelectorAll('h1, h2, h3'));

    if (headingElements.length === 0) {
      console.warn('[ResearchPaperSplitter] No headings found in document');
      return [];
    }

    console.log(`[ResearchPaperSplitter] Found ${headingElements.length} headings`);

    const sections: PaperSection[] = [];
    const headingStack: Array<{ level: number; heading: string }> = [];
    let currentCharIndex = 0;

    // Process each heading and extract content until next heading
    for (let i = 0; i < headingElements.length; i++) {
      const headingElement = headingElements[i] as HTMLHeadingElement;
      const nextHeadingElement = headingElements[i + 1] as HTMLHeadingElement | undefined;

      // Get heading text (exact original)
      const heading = headingElement.textContent?.trim() || '';
      if (!heading) continue; // Skip empty headings

      // Get heading level (1, 2, or 3)
      const level = parseInt(headingElement.tagName.substring(1)); // h1 -> 1, h2 -> 2, etc.

      // Update heading stack for hierarchy tracking
      // Pop headings of equal or lower level (e.g., new h2 pops previous h2 and h3)
      while (headingStack.length > 0 && headingStack[headingStack.length - 1].level >= level) {
        headingStack.pop();
      }

      // Determine parent heading (most recent heading of higher level)
      const parentHeading = headingStack.length > 0
        ? headingStack[headingStack.length - 1].heading
        : undefined;

      // Add current heading to stack
      headingStack.push({ level, heading });

      // Extract content between this heading and next heading
      const content = extractContentBetweenHeadings(headingElement, nextHeadingElement);

      // Calculate character indices
      const startIndex = currentCharIndex;
      const endIndex = currentCharIndex + content.length;
      currentCharIndex = endIndex;

      // Generate selectors for scroll-to-source functionality
      const cssSelector = generateCSSSelector(headingElement);
      const elementId = headingElement.id || undefined;
      const xPath = generateXPath(headingElement);

      sections.push({
        heading,
        level,
        parentHeading,
        content: content.trim(),
        startIndex,
        endIndex,
        cssSelector,
        elementId,
        xPath,
      });
    }

    console.log(`[ResearchPaperSplitter] ✓ Extracted ${sections.length} sections with hierarchy (heading-based)`);

    // Log section structure for debugging
    if (sections.length > 0) {
      console.log('[ResearchPaperSplitter] Section structure:');
      sections.forEach((section, index) => {
        const indent = '  '.repeat(section.level - 1);
        console.log(`${indent}${index + 1}. [h${section.level}] ${section.heading} (${section.content.length} chars)`);
      });
    }

    return sections;
  } catch (error) {
    console.error('[ResearchPaperSplitter] Error extracting sections:', error);
    return [];
  }
}

/**
 * Extract text content between two heading elements
 * Captures all text nodes and element content between headings
 */
function extractContentBetweenHeadings(
  currentHeading: HTMLElement,
  nextHeading: HTMLElement | undefined
): string {
  const contentParts: string[] = [];
  let currentNode = currentHeading.nextSibling;

  // Traverse DOM until we hit the next heading or end of content
  while (currentNode && currentNode !== nextHeading) {
    // Get text content from this node and its children
    if (currentNode.nodeType === Node.ELEMENT_NODE) {
      const element = currentNode as HTMLElement;

      // Skip if this is a heading element (shouldn't happen, but safety check)
      if (/^H[1-6]$/i.test(element.tagName)) {
        break;
      }

      // Get text content, filtering out script/style tags
      const text = getTextContent(element);
      if (text) {
        contentParts.push(text);
      }
    } else if (currentNode.nodeType === Node.TEXT_NODE) {
      const text = currentNode.textContent?.trim() || '';
      if (text) {
        contentParts.push(text);
      }
    }

    currentNode = currentNode.nextSibling;
  }

  return contentParts.join('\n\n');
}

/**
 * Get text content from an element, filtering out unwanted tags
 */
function getTextContent(element: HTMLElement): string {
  // Clone to avoid modifying original
  const clone = element.cloneNode(true) as HTMLElement;

  // Remove unwanted elements
  const unwantedSelectors = ['script', 'style', 'noscript', 'iframe'];
  unwantedSelectors.forEach(selector => {
    const elements = clone.querySelectorAll(selector);
    elements.forEach(el => el.remove());
  });

  return clone.textContent?.trim() || '';
}

/**
 * Get the main content element, filtering out navigation and other noise
 * Uses semantic HTML, pattern matching, and heuristics
 */
function getMainContentElement(doc: Document): HTMLElement | null {
  // STEP 1: Try semantic HTML elements first (most reliable)
  const semanticElements = [
    doc.querySelector('main'),
    doc.querySelector('article'),
    doc.querySelector('[role="main"]'),
  ];

  for (const element of semanticElements) {
    if (element) return element as HTMLElement;
  }

  // STEP 2: Pattern matching on class/id names
  // Look for elements with classes/ids containing common content indicators
  const contentPatterns = [
    /\b(main|content|article|paper|page|body)\b/i,  // Common patterns
    /ltx_page/i,  // arXiv LaTeXML
    /abstract-full/i,  // PubMed
    /article-content/i,  // Various journals
  ];

  // Get all elements with class or id attributes
  const allElements = Array.from(doc.querySelectorAll('[class], [id]'));

  for (const pattern of contentPatterns) {
    for (const element of allElements) {
      const className = (element as HTMLElement).className || '';
      const id = (element as HTMLElement).id || '';

      // Match pattern in class or id
      if (pattern.test(className) || pattern.test(id)) {
        // Verify this element has headings (to avoid false positives)
        const headingCount = element.querySelectorAll('h1, h2, h3').length;
        if (headingCount > 0) {
          console.log(`[ResearchPaperSplitter] Found main content via pattern: ${className || id}`);
          return element as HTMLElement;
        }
      }
    }
  }

  // STEP 3: Heuristic fallback - find element with most headings
  const candidateElements = Array.from(doc.querySelectorAll('div, section, article'));
  let bestCandidate: HTMLElement | null = null;
  let maxHeadings = 0;

  for (const element of candidateElements) {
    const headingCount = (element as HTMLElement).querySelectorAll('h1, h2, h3').length;
    if (headingCount > maxHeadings) {
      maxHeadings = headingCount;
      bestCandidate = element as HTMLElement;
    }
  }

  if (bestCandidate && maxHeadings >= 2) {
    console.log(`[ResearchPaperSplitter] Found main content via heuristics: ${maxHeadings} headings`);
    return bestCandidate;
  }

  // STEP 4: Ultimate fallback - use body
  console.log('[ResearchPaperSplitter] Using document.body as fallback');
  return doc.body;
}

/**
 * Get a flat list of all headings (for detection/debugging)
 * @param doc Optional Document object (defaults to global document in browser context)
 */
export function getAllHeadings(doc?: Document): string[] {
  const document = doc || (typeof window !== 'undefined' ? window.document : undefined);

  if (!document) {
    return [];
  }

  const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6'));
  return headings
    .map(h => h.textContent?.trim() || '')
    .filter(text => text.length > 0);
}

/**
 * Check if page has sufficient heading structure for semantic splitting
 * Returns true if there are at least 2 meaningful headings
 * @param doc Optional Document object (defaults to global document in browser context)
 */
export function hasHeadingStructure(doc?: Document): boolean {
  const headings = getAllHeadings(doc);

  // Filter out very short headings (likely not section headings)
  const meaningfulHeadings = headings.filter(h => h.length >= 3);

  return meaningfulHeadings.length >= 2;
}

