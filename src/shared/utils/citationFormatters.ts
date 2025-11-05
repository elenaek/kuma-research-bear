import { Citation, CitationFormat } from '../types/index.ts';

/**
 * Citation Formatters for APA, MLA, Chicago, and IEEE styles
 */

// ============================================================================
// INLINE CITATIONS (for quoting in text)
// ============================================================================

/**
 * Generate inline citation (parenthetical) in the specified format
 */
export function generateInlineCitation(citation: Citation, format: CitationFormat): string {
  switch (format) {
    case 'apa':
      return generateAPAInline(citation);
    case 'mla':
      return generateMLAInline(citation);
    case 'chicago':
      return generateChicagoInline(citation);
    case 'ieee':
      return '[REF]'; // IEEE uses numbered references, requires reference list context
    default:
      return generateAPAInline(citation);
  }
}

function generateAPAInline(citation: Citation): string {
  const author = getFirstAuthorLastName(citation.authors);
  const year = extractYear(citation.publishDate);
  const page = citation.pageNumber;

  if (!year) {
    return page ? `(${author}, n.d., p. ${page})` : `(${author}, n.d.)`;
  }

  return page ? `(${author}, ${year}, p. ${page})` : `(${author}, ${year})`;
}

function generateMLAInline(citation: Citation): string {
  const author = getFirstAuthorLastName(citation.authors);
  const page = citation.pageNumber;

  return page ? `(${author} ${page})` : `(${author})`;
}

function generateChicagoInline(citation: Citation): string {
  const author = getFirstAuthorLastName(citation.authors);
  const year = extractYear(citation.publishDate);
  const page = citation.pageNumber;

  if (!year) {
    return page ? `(${author}, n.d., ${page})` : `(${author}, n.d.)`;
  }

  return page ? `(${author} ${year}, ${page})` : `(${author} ${year})`;
}

/**
 * Generate quote + citation (direct quote with inline citation)
 * Format: "quoted text" (Author, Year, p. X)
 */
export function generateQuoteCitation(citation: Citation, format: CitationFormat): string {
  const quote = citation.selectedText;
  const inlineCitation = generateInlineCitation(citation, format);

  // Wrap quote in quotation marks and append inline citation
  return `"${quote}" ${inlineCitation}`;
}

// ============================================================================
// REFERENCE LIST ENTRIES (full bibliographic citations)
// ============================================================================

/**
 * Generate full reference citation for bibliography/works cited
 */
export function generateReferenceCitation(citation: Citation, format: CitationFormat, numberInList?: number): string {
  switch (format) {
    case 'apa':
      return generateAPAReference(citation);
    case 'mla':
      return generateMLAReference(citation);
    case 'chicago':
      return generateChicagoReference(citation);
    case 'ieee':
      return generateIEEEReference(citation, numberInList || 1);
    default:
      return generateAPAReference(citation);
  }
}

/**
 * APA 7th Edition Reference Format
 * Author, A. A., & Author, B. B. (Year). Title of article. Journal Name, volume(issue), pages. https://doi.org/xxx
 */
function generateAPAReference(citation: Citation): string {
  const authors = formatAuthorsAPA(citation.authors);
  const year = extractYear(citation.publishDate) || 'n.d.';
  const title = citation.paperTitle;
  const journal = citation.journal || citation.venue;
  const doi = citation.doi;

  let reference = `${authors} (${year}). ${title}.`;

  if (journal) {
    reference += ` ${journal}.`;
  }

  if (doi) {
    reference += ` https://doi.org/${doi}`;
  } else {
    reference += ` ${citation.url}`;
  }

  return reference;
}

/**
 * MLA 9th Edition Reference Format
 * Author, First. "Title of Article." Journal Name, vol. X, no. X, Year, pp. XX-XX. DOI or URL.
 */
function generateMLAReference(citation: Citation): string {
  const authors = formatAuthorsMLA(citation.authors);
  const title = citation.paperTitle;
  const journal = citation.journal || citation.venue;
  const year = extractYear(citation.publishDate) || 'n.d.';
  const doi = citation.doi;

  let reference = `${authors} "${title}."`;

  if (journal) {
    reference += ` ${journal},`;
  }

  reference += ` ${year}.`;

  if (doi) {
    reference += ` https://doi.org/${doi}`;
  } else {
    reference += ` ${citation.url}`;
  }

  return reference;
}

/**
 * Chicago 17th Edition Reference Format
 * Author, First Last. "Title of Article." Journal Name volume, no. issue (Year): pages. https://doi.org/xxx
 */
function generateChicagoReference(citation: Citation): string {
  const authors = formatAuthorsChicago(citation.authors);
  const year = extractYear(citation.publishDate) || 'n.d.';
  const title = citation.paperTitle;
  const journal = citation.journal || citation.venue;
  const doi = citation.doi;

  let reference = `${authors} "${title}."`;

  if (journal) {
    reference += ` ${journal} (${year}).`;
  } else {
    reference += ` ${year}.`;
  }

  if (doi) {
    reference += ` https://doi.org/${doi}`;
  } else {
    reference += ` ${citation.url}`;
  }

  return reference;
}

/**
 * IEEE Reference Format
 * [1] A. Author, B. Author, and C. Author, "Title of article," Journal Name, vol. X, no. X, pp. XX-XX, Month Year. [Online]. Available: https://doi.org/xxx
 */
function generateIEEEReference(citation: Citation, number: number): string {
  const authors = formatAuthorsIEEE(citation.authors);
  const title = citation.paperTitle;
  const journal = citation.journal || citation.venue || 'Online';
  const year = extractYear(citation.publishDate) || 'n.d.';
  const doi = citation.doi;

  let reference = `[${number}] ${authors}, "${title},"`;

  if (journal) {
    reference += ` ${journal},`;
  }

  reference += ` ${year}.`;

  if (doi) {
    reference += ` [Online]. Available: https://doi.org/${doi}`;
  } else {
    reference += ` [Online]. Available: ${citation.url}`;
  }

  return reference;
}

// ============================================================================
// AUTHOR FORMATTING HELPERS
// ============================================================================

/**
 * Format authors for APA style
 * - 1 author: Smith, J.
 * - 2 authors: Smith, J., & Jones, M.
 * - 3-20 authors: Smith, J., Jones, M., & Williams, K.
 * - 21+ authors: Smith, J., Jones, M., ... Last, L.
 */
function formatAuthorsAPA(authors: string[]): string {
  if (!authors || authors.length === 0) return '[Unknown Author]';

  const formatted = authors.slice(0, 20).map(formatAuthorLastNameFirst);

  if (authors.length === 1) {
    return formatted[0];
  } else if (authors.length === 2) {
    return `${formatted[0]}, & ${formatted[1]}`;
  } else if (authors.length <= 20) {
    const allButLast = formatted.slice(0, -1).join(', ');
    const last = formatted[formatted.length - 1];
    return `${allButLast}, & ${last}`;
  } else {
    // 21+ authors: use ellipsis
    const lastAuthor = formatAuthorLastNameFirst(authors[authors.length - 1]);
    return `${formatted[0]}, ${formatted[1]}, ... ${lastAuthor}`;
  }
}

/**
 * Format authors for MLA style
 * - 1 author: Smith, John
 * - 2 authors: Smith, John, and Mary Jones
 * - 3+ authors: Smith, John, et al.
 */
function formatAuthorsMLA(authors: string[]): string {
  if (!authors || authors.length === 0) return '[Unknown Author]';

  if (authors.length === 1) {
    return formatAuthorLastNameFirstFull(authors[0]);
  } else if (authors.length === 2) {
    return `${formatAuthorLastNameFirstFull(authors[0])}, and ${formatAuthorFirstNameFirst(authors[1])}`;
  } else {
    return `${formatAuthorLastNameFirstFull(authors[0])}, et al.`;
  }
}

/**
 * Format authors for Chicago style
 * - 1 author: Smith, John
 * - 2-3 authors: Smith, John, and Mary Jones
 * - 4+ authors: Smith, John, et al.
 */
function formatAuthorsChicago(authors: string[]): string {
  if (!authors || authors.length === 0) return '[Unknown Author]';

  if (authors.length === 1) {
    return formatAuthorLastNameFirstFull(authors[0]);
  } else if (authors.length <= 3) {
    const allButLast = authors.slice(0, -1).map(formatAuthorLastNameFirstFull).join(', ');
    const last = formatAuthorFirstNameFirst(authors[authors.length - 1]);
    return `${allButLast}, and ${last}`;
  } else {
    return `${formatAuthorLastNameFirstFull(authors[0])}, et al.`;
  }
}

/**
 * Format authors for IEEE style
 * - 1-3 authors: A. Smith, B. Jones, and C. Williams
 * - 4-6 authors: A. Smith, B. Jones, C. Williams, D. Brown, E. Davis, and F. Miller
 * - 7+ authors: A. Smith et al.
 */
function formatAuthorsIEEE(authors: string[]): string {
  if (!authors || authors.length === 0) return '[Unknown Author]';

  if (authors.length <= 6) {
    const formatted = authors.map(formatAuthorIEEE);
    if (formatted.length === 1) {
      return formatted[0];
    } else {
      const allButLast = formatted.slice(0, -1).join(', ');
      const last = formatted[formatted.length - 1];
      return `${allButLast}, and ${last}`;
    }
  } else {
    return `${formatAuthorIEEE(authors[0])} et al.`;
  }
}

// ============================================================================
// NAME FORMATTING HELPERS
// ============================================================================

/**
 * Format: Smith, J. A. (last name, first initial, middle initial)
 */
function formatAuthorLastNameFirst(name: string): string {
  if (!name) return '[Unknown]';

  const parts = parseAuthorName(name);

  if (parts.lastName && parts.firstName) {
    const firstInitial = parts.firstName.charAt(0).toUpperCase();
    const middleInitial = parts.middleName ? ` ${parts.middleName.charAt(0).toUpperCase()}.` : '';
    return `${parts.lastName}, ${firstInitial}.${middleInitial}`;
  }

  return name; // Fallback if parsing fails
}

/**
 * Format: Smith, John A. (last name, full first name, middle initial)
 */
function formatAuthorLastNameFirstFull(name: string): string {
  if (!name) return '[Unknown]';

  const parts = parseAuthorName(name);

  if (parts.lastName && parts.firstName) {
    const middle = parts.middleName ? ` ${parts.middleName.charAt(0).toUpperCase()}.` : '';
    return `${parts.lastName}, ${parts.firstName}${middle}`;
  }

  return name;
}

/**
 * Format: John Smith (full first name, last name)
 */
function formatAuthorFirstNameFirst(name: string): string {
  if (!name) return '[Unknown]';

  const parts = parseAuthorName(name);

  if (parts.firstName && parts.lastName) {
    const middle = parts.middleName ? ` ${parts.middleName} ` : ' ';
    return `${parts.firstName}${middle}${parts.lastName}`;
  }

  return name;
}

/**
 * Format: A. Smith (IEEE style - first initial, last name)
 */
function formatAuthorIEEE(name: string): string {
  if (!name) return '[Unknown]';

  const parts = parseAuthorName(name);

  if (parts.firstName && parts.lastName) {
    const firstInitial = parts.firstName.charAt(0).toUpperCase();
    const middleInitial = parts.middleName ? ` ${parts.middleName.charAt(0).toUpperCase()}.` : '';
    return `${firstInitial}.${middleInitial} ${parts.lastName}`;
  }

  return name;
}

/**
 * Parse author name into components
 * Handles: "John Smith", "Smith, John", "John A. Smith", "Smith, John A."
 */
function parseAuthorName(name: string): { firstName: string; middleName?: string; lastName: string } {
  name = name.trim();

  // If contains comma, assume "LastName, FirstName MiddleName" format
  if (name.includes(',')) {
    const [last, rest] = name.split(',').map(s => s.trim());
    const names = rest.split(' ').filter(Boolean);

    return {
      lastName: last,
      firstName: names[0] || '',
      middleName: names.slice(1).join(' ') || undefined,
    };
  }

  // Otherwise, assume "FirstName MiddleName LastName" format
  const parts = name.split(' ').filter(Boolean);

  if (parts.length === 1) {
    return { firstName: '', lastName: parts[0] };
  } else if (parts.length === 2) {
    return { firstName: parts[0], lastName: parts[1] };
  } else {
    return {
      firstName: parts[0],
      middleName: parts.slice(1, -1).join(' '),
      lastName: parts[parts.length - 1],
    };
  }
}

/**
 * Get first author's last name (for inline citations)
 */
export function getFirstAuthorLastName(authors: string[]): string {
  if (!authors || authors.length === 0) return '[Unknown]';

  const parts = parseAuthorName(authors[0]);
  return parts.lastName || authors[0];
}

/**
 * Extract year from date string (YYYY-MM-DD or YYYY)
 */
export function extractYear(dateString: string | undefined): string | null {
  if (!dateString) return null;

  const match = dateString.match(/\d{4}/);
  return match ? match[0] : null;
}

/**
 * Format page number or section reference
 */
export function formatPageReference(pageNumber: string | number | undefined, format: CitationFormat): string {
  if (!pageNumber) return '';

  const page = pageNumber.toString();

  // If it's a number, format as page
  if (/^\d+$/.test(page)) {
    switch (format) {
      case 'apa':
        return `p. ${page}`;
      case 'mla':
        return page; // MLA just uses the number
      case 'chicago':
        return page;
      case 'ieee':
        return `p. ${page}`;
      default:
        return `p. ${page}`;
    }
  }

  // Otherwise, it's likely a section name
  return page;
}
