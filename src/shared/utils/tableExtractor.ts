/**
 * Table Extraction and Conversion Utilities
 *
 * Converts HTML tables to Markdown format while preserving structure,
 * extracts metadata, and intelligently handles large tables.
 */

import { logger } from './logger.ts';

export interface TableMetadata {
  caption?: string;
  headers: string[];
  columnTypes: ('text' | 'numeric' | 'mixed')[];
  rowCount: number;
  colCount: number;
  estimatedSize: number;
  hasCaption: boolean;
  hasHeaders: boolean;
}

export interface TableContext {
  precedingText: string;
  followingText: string;
  sectionHeading?: string;
}

export interface TableExtraction {
  markdown: string;
  metadata: TableMetadata;
  context: TableContext;
  startPosition: number;
  endPosition: number;
}

/**
 * Convert HTML table to Markdown format
 */
export function convertHTMLTableToMarkdown(tableElement: HTMLElement): string {
  const rows: string[][] = [];

  // Extract thead rows (if present)
  const thead = tableElement.querySelector('thead');
  if (thead) {
    const headerRows = Array.from(thead.querySelectorAll('tr'));
    for (const row of headerRows) {
      rows.push(extractRowCells(row));
    }
  }

  // Extract tbody rows (or all tr if no thead/tbody)
  const tbody = tableElement.querySelector('tbody') || tableElement;
  const bodyRows = Array.from(tbody.querySelectorAll('tr'));

  // If no thead was found, check if first row contains th elements
  if (!thead && bodyRows.length > 0) {
    const firstRow = bodyRows[0];
    const hasThElements = firstRow.querySelectorAll('th').length > 0;

    if (hasThElements) {
      // First row is headers
      rows.push(extractRowCells(firstRow));
      // Add remaining rows
      for (let i = 1; i < bodyRows.length; i++) {
        rows.push(extractRowCells(bodyRows[i]));
      }
    } else {
      // No explicit headers, check if first row looks like headers (heuristic)
      const firstRowCells = extractRowCells(firstRow);
      const looksLikeHeaders = firstRowCells.every(cell => {
        const trimmed = cell.trim();
        // Headers are usually short, capitalized, and not numeric
        return trimmed.length < 50 &&
               trimmed.length > 0 &&
               !/^\d+(\.\d+)?$/.test(trimmed); // Not just a number
      });

      if (looksLikeHeaders) {
        // Treat first row as headers
        rows.push(firstRowCells);
        for (let i = 1; i < bodyRows.length; i++) {
          rows.push(extractRowCells(bodyRows[i]));
        }
      } else {
        // No clear headers, add all rows as data
        for (const row of bodyRows) {
          rows.push(extractRowCells(row));
        }
      }
    }
  } else if (thead) {
    // Headers already extracted, just add body rows
    for (const row of bodyRows) {
      rows.push(extractRowCells(row));
    }
  } else {
    // No rows at all
    for (const row of bodyRows) {
      rows.push(extractRowCells(row));
    }
  }

  // Handle tfoot (append at end)
  const tfoot = tableElement.querySelector('tfoot');
  if (tfoot) {
    const footerRows = Array.from(tfoot.querySelectorAll('tr'));
    for (const row of footerRows) {
      rows.push(extractRowCells(row));
    }
  }

  if (rows.length === 0) {
    logger.warn('UTILS', '[TableExtractor] Empty table found');
    return '';
  }

  // Determine column count (max columns in any row)
  const colCount = Math.max(...rows.map(row => row.length));

  // Normalize all rows to have same column count (pad with empty strings)
  const normalizedRows = rows.map(row => {
    const padded = [...row];
    while (padded.length < colCount) {
      padded.push('');
    }
    return padded;
  });

  // Convert to Markdown format
  const markdownLines: string[] = [];

  // First row (headers or first data row)
  markdownLines.push('| ' + normalizedRows[0].join(' | ') + ' |');

  // Separator row
  const separator = '|' + ' --- |'.repeat(colCount);
  markdownLines.push(separator);

  // Remaining rows
  for (let i = 1; i < normalizedRows.length; i++) {
    markdownLines.push('| ' + normalizedRows[i].join(' | ') + ' |');
  }

  return markdownLines.join('\n');
}

/**
 * Extract cell contents from a table row, handling colspan/rowspan
 */
function extractRowCells(row: HTMLTableRowElement): string[] {
  const cells: string[] = [];
  const cellElements = Array.from(row.querySelectorAll('th, td'));

  for (const cell of cellElements) {
    let cellText = cell.textContent?.trim() || '';

    // Handle colspan/rowspan by adding a note
    const colspan = parseInt(cell.getAttribute('colspan') || '1');
    const rowspan = parseInt(cell.getAttribute('rowspan') || '1');

    if (colspan > 1 || rowspan > 1) {
      const spanNote: string[] = [];
      if (colspan > 1) spanNote.push(`spans ${colspan} cols`);
      if (rowspan > 1) spanNote.push(`spans ${rowspan} rows`);
      cellText = `${cellText} _(${spanNote.join(', ')})_`;
    }

    // Clean up whitespace
    cellText = cellText.replace(/\s+/g, ' ').trim();

    cells.push(cellText);

    // If colspan > 1, add empty cells to maintain column count
    // (Markdown doesn't support colspan, so we note it and continue)
  }

  return cells;
}

/**
 * Extract metadata from HTML table
 */
export function extractTableMetadata(tableElement: HTMLElement): TableMetadata {
  // Extract caption
  const captionElement = tableElement.querySelector('caption');
  const caption = captionElement?.textContent?.trim();

  // Check if table has explicit headers
  const hasTheadOrTh =
    tableElement.querySelector('thead') !== null ||
    tableElement.querySelector('th') !== null;

  // Extract rows to analyze structure
  const allRows = Array.from(tableElement.querySelectorAll('tr'));
  const rowCount = allRows.length;

  // Determine column count (from first row)
  const firstRow = allRows[0];
  const colCount = firstRow ? firstRow.querySelectorAll('th, td').length : 0;

  // Extract header row
  let headers: string[] = [];
  const thead = tableElement.querySelector('thead');
  if (thead) {
    const headerRow = thead.querySelector('tr');
    if (headerRow) {
      headers = extractRowCells(headerRow);
    }
  } else {
    // Check first row for th elements
    const firstRow = allRows[0];
    if (firstRow && firstRow.querySelectorAll('th').length > 0) {
      headers = extractRowCells(firstRow);
    } else if (firstRow) {
      // Use first row content as headers (heuristic)
      headers = extractRowCells(firstRow);
    }
  }

  // Detect column types by analyzing data
  const columnTypes = detectColumnTypes(tableElement, headers.length);

  // Estimate size
  const tableHTML = tableElement.outerHTML;
  const estimatedSize = tableHTML.length;

  return {
    caption,
    headers,
    columnTypes,
    rowCount,
    colCount,
    estimatedSize,
    hasCaption: !!caption,
    hasHeaders: hasTheadOrTh || headers.length > 0,
  };
}

/**
 * Detect column data types (text, numeric, mixed)
 */
function detectColumnTypes(tableElement: HTMLElement, colCount: number): ('text' | 'numeric' | 'mixed')[] {
  const columnTypes: ('text' | 'numeric' | 'mixed')[] = [];

  // Get data rows (skip header row if thead exists)
  const tbody = tableElement.querySelector('tbody');
  const dataRows = tbody
    ? Array.from(tbody.querySelectorAll('tr'))
    : Array.from(tableElement.querySelectorAll('tr')).slice(1); // Skip first row as header

  if (dataRows.length === 0) {
    // No data rows, assume all text
    return new Array(colCount).fill('text') as ('text' | 'numeric' | 'mixed')[];
  }

  // Analyze each column
  for (let col = 0; col < colCount; col++) {
    let numericCount = 0;
    let textCount = 0;
    let totalCells = 0;

    for (const row of dataRows) {
      const cells = Array.from(row.querySelectorAll('th, td'));
      if (col < cells.length) {
        const cellText = cells[col].textContent?.trim() || '';
        if (cellText.length === 0) continue;

        totalCells++;

        // Check if cell contains a number (with optional units, %, etc.)
        // Pattern: optional +/-, digits, optional decimal, optional % or units
        if (/^[+-]?\d+(\.\d+)?(%|[a-zA-Z]{0,3})?$/.test(cellText)) {
          numericCount++;
        } else {
          textCount++;
        }
      }
    }

    // Determine column type
    if (totalCells === 0) {
      columnTypes.push('text');
    } else {
      const numericRatio = numericCount / totalCells;
      if (numericRatio > 0.8) {
        columnTypes.push('numeric');
      } else if (numericRatio < 0.2) {
        columnTypes.push('text');
      } else {
        columnTypes.push('mixed');
      }
    }
  }

  return columnTypes;
}

/**
 * Extract context surrounding a table
 */
export function extractTableContext(tableElement: HTMLElement): TableContext {
  let precedingText = '';
  let followingText = '';
  let sectionHeading: string | undefined;

  // Get preceding paragraph (walk backwards until we find text content)
  let prevSibling = tableElement.previousElementSibling;
  let attempts = 0;
  while (prevSibling && attempts < 5) {
    if (prevSibling.tagName === 'P') {
      const text = prevSibling.textContent?.trim() || '';
      if (text.length > 20) { // Meaningful paragraph
        precedingText = text;
        break;
      }
    }
    prevSibling = prevSibling.previousElementSibling;
    attempts++;
  }

  // Get following paragraph
  let nextSibling = tableElement.nextElementSibling;
  attempts = 0;
  while (nextSibling && attempts < 5) {
    if (nextSibling.tagName === 'P') {
      const text = nextSibling.textContent?.trim() || '';
      if (text.length > 20) {
        followingText = text;
        break;
      }
    }
    nextSibling = nextSibling.nextElementSibling;
    attempts++;
  }

  // Find section heading (walk up DOM tree)
  let parent = tableElement.parentElement;
  while (parent && parent !== document.body) {
    // Look for heading before this element
    const headings = parent.querySelectorAll('h1, h2, h3, h4, h5, h6');
    if (headings.length > 0) {
      // Get the last heading (closest to table)
      const heading = headings[headings.length - 1];
      sectionHeading = heading.textContent?.trim();
      break;
    }
    parent = parent.parentElement;
  }

  return {
    precedingText,
    followingText,
    sectionHeading,
  };
}

/**
 * Build complete table block with caption and context
 */
export function buildTableBlock(
  markdownTable: string,
  metadata: TableMetadata,
  context: TableContext,
  includeContext: boolean = true
): string {
  const parts: string[] = [];

  // Add section heading if available (for additional context)
  if (context.sectionHeading && includeContext) {
    // Don't add heading as it's already in the section structure
  }

  // Add preceding context
  if (includeContext && context.precedingText) {
    // Only include if it's a short reference (< 200 chars)
    if (context.precedingText.length < 200) {
      parts.push(context.precedingText);
      parts.push(''); // blank line
    }
  }

  // Add caption if present
  if (metadata.caption) {
    parts.push(`**${metadata.caption}**`);
    parts.push(''); // blank line
  }

  // Add the table itself
  parts.push(markdownTable);

  // Add following context
  if (includeContext && context.followingText) {
    // Only include if it's a short reference (< 200 chars)
    if (context.followingText.length < 200) {
      parts.push(''); // blank line
      parts.push(context.followingText);
    }
  }

  return parts.join('\n');
}

/**
 * Split a large Markdown table into smaller chunks
 * Preserves headers in each chunk
 */
export function splitLargeTable(
  markdownTable: string,
  metadata: TableMetadata,
  maxChunkSize: number
): string[] {
  const lines = markdownTable.split('\n');

  if (lines.length < 3) {
    // Table too small to split meaningfully
    return [markdownTable];
  }

  // Parse structure
  const headerRow = lines[0];
  const separatorRow = lines[1];
  const dataRows = lines.slice(2);

  // Calculate how many rows fit per chunk
  const headerSize = headerRow.length + separatorRow.length + 50; // +50 for continuation note
  const avgRowSize = dataRows.reduce((sum, row) => sum + row.length + 1, 0) / dataRows.length;
  const rowsPerChunk = Math.max(1, Math.floor((maxChunkSize - headerSize) / avgRowSize));

  logger.debug('UTILS', `[TableExtractor] Splitting table: ${dataRows.length} rows into chunks of ${rowsPerChunk} rows`);

  const chunks: string[] = [];
  const totalChunks = Math.ceil(dataRows.length / rowsPerChunk);

  for (let i = 0; i < dataRows.length; i += rowsPerChunk) {
    const chunkIndex = Math.floor(i / rowsPerChunk);
    const chunkRows = dataRows.slice(i, i + rowsPerChunk);

    const chunkLines: string[] = [headerRow, separatorRow];

    // Add continuation note if not first chunk
    if (chunkIndex > 0) {
      const continuationRow = '| ' + `_...continued from previous chunk (${chunkIndex + 1}/${totalChunks})..._`.padEnd(headerRow.length - 4) + ' |';
      chunkLines.push(continuationRow);
    }

    // Add data rows
    chunkLines.push(...chunkRows);

    // Add continuation note if not last chunk
    if (i + rowsPerChunk < dataRows.length) {
      const continuationRow = '| ' + `_...continued in next chunk..._`.padEnd(headerRow.length - 4) + ' |';
      chunkLines.push(continuationRow);
    }

    chunks.push(chunkLines.join('\n'));
  }

  return chunks;
}

/**
 * Determine if a table should be kept whole or split
 */
export function shouldSplitTable(
  tableSize: number,
  maxChunkSize: number,
  thresholds: { small: number; medium: number } = { small: 800, medium: 2000 }
): boolean {
  // Always keep small tables whole
  if (tableSize < thresholds.small) {
    return false;
  }

  // For medium tables, keep whole if less than 70% of max chunk size
  if (tableSize < thresholds.medium && tableSize < maxChunkSize * 0.7) {
    return false;
  }

  // Large tables or tables that don't fit: split
  return true;
}

/**
 * Find all tables in a content string (Markdown format)
 * Returns positions and content for each table
 */
export function findMarkdownTables(content: string): Array<{
  start: number;
  end: number;
  markdown: string;
}> {
  const tables: Array<{ start: number; end: number; markdown: string }> = [];

  // Regex to find Markdown tables (line starting with |, followed by separator, then data rows)
  const tablePattern = /(\|.+\|\n\|[\s:-]+\|\n(?:\|.+\|\n?)+)/gm;

  let match;
  while ((match = tablePattern.exec(content)) !== null) {
    tables.push({
      start: match.index,
      end: match.index + match[0].length,
      markdown: match[1],
    });
  }

  return tables;
}
