/**
 * Metadata field validation utilities
 *
 * Provides validation and normalization for various academic paper metadata fields
 */

export interface ValidationResult {
  valid: boolean;
  normalized?: any; // Normalized value if validation passed
  error?: string; // Error message if validation failed
}

/**
 * Validate and normalize DOI (Digital Object Identifier)
 * Format: 10.XXXX/suffix
 * Example: 10.1038/nature12373
 */
export function validateDOI(doi: string | undefined): ValidationResult {
  if (!doi) {
    return { valid: false, error: 'DOI is empty' };
  }

  // Remove common prefixes
  let normalized = doi.trim()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//, '')
    .replace(/^doi:\s*/i, '');

  // DOI regex: must start with 10. followed by 4+ digits, then /, then any characters
  const doiRegex = /^10\.\d{4,}\/[^\s]+$/;

  if (!doiRegex.test(normalized)) {
    return { valid: false, error: 'Invalid DOI format' };
  }

  return { valid: true, normalized };
}

/**
 * Validate and normalize arXiv ID
 * Formats:
 * - New: YYMM.NNNNN or YYMM.NNNNNVN (e.g., 2301.12345, 2301.12345v2)
 * - Old: archive/YYMMNNN (e.g., cs/0703110)
 */
export function validateArxivId(arxivId: string | undefined): ValidationResult {
  if (!arxivId) {
    return { valid: false, error: 'arXiv ID is empty' };
  }

  let normalized = arxivId.trim();

  // New format: YYMM.NNNNN with optional version
  const newFormatRegex = /^(\d{4}\.\d{4,5})(v\d+)?$/;
  // Old format: archive/YYMMNNN
  const oldFormatRegex = /^[a-z-]+\/\d{7}$/;

  if (newFormatRegex.test(normalized) || oldFormatRegex.test(normalized)) {
    return { valid: true, normalized };
  }

  return { valid: false, error: 'Invalid arXiv ID format' };
}

/**
 * Validate PubMed ID (PMID)
 * Format: Numeric string (1-8 digits typically)
 */
export function validatePMID(pmid: string | undefined): ValidationResult {
  if (!pmid) {
    return { valid: false, error: 'PMID is empty' };
  }

  const normalized = pmid.trim();
  const pmidRegex = /^\d{1,8}$/;

  if (!pmidRegex.test(normalized)) {
    return { valid: false, error: 'Invalid PMID format (must be numeric)' };
  }

  return { valid: true, normalized };
}

/**
 * Validate PubMed Central ID (PMCID)
 * Format: PMC followed by numbers (e.g., PMC3531190)
 */
export function validatePMCID(pmcid: string | undefined): ValidationResult {
  if (!pmcid) {
    return { valid: false, error: 'PMCID is empty' };
  }

  let normalized = pmcid.trim();

  // Add PMC prefix if missing
  if (!/^PMC/i.test(normalized)) {
    normalized = 'PMC' + normalized;
  }

  const pmcidRegex = /^PMC\d+$/i;

  if (!pmcidRegex.test(normalized)) {
    return { valid: false, error: 'Invalid PMCID format' };
  }

  // Normalize to uppercase
  normalized = normalized.toUpperCase();

  return { valid: true, normalized };
}

/**
 * Validate and normalize publication date
 * Accepts various formats and normalizes to ISO 8601 (YYYY-MM-DD)
 * Supports: YYYY, YYYY-MM, YYYY-MM-DD
 */
export function validateDate(date: string | undefined): ValidationResult {
  if (!date) {
    return { valid: false, error: 'Date is empty' };
  }

  const normalized = date.trim();

  // Full date: YYYY-MM-DD
  const fullDateRegex = /^(\d{4})-(\d{2})-(\d{2})$/;
  // Year-Month: YYYY-MM
  const yearMonthRegex = /^(\d{4})-(\d{2})$/;
  // Year only: YYYY
  const yearRegex = /^(\d{4})$/;

  if (fullDateRegex.test(normalized)) {
    const match = normalized.match(fullDateRegex)!;
    const year = parseInt(match[1]);
    const month = parseInt(match[2]);
    const day = parseInt(match[3]);

    // Validate ranges
    if (year < 1000 || year > 9999) {
      return { valid: false, error: 'Invalid year' };
    }
    if (month < 1 || month > 12) {
      return { valid: false, error: 'Invalid month' };
    }
    if (day < 1 || day > 31) {
      return { valid: false, error: 'Invalid day' };
    }

    // Basic month-day validation
    const daysInMonth = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (day > daysInMonth[month - 1]) {
      return { valid: false, error: 'Invalid day for month' };
    }

    return { valid: true, normalized };
  }

  if (yearMonthRegex.test(normalized)) {
    const match = normalized.match(yearMonthRegex)!;
    const year = parseInt(match[1]);
    const month = parseInt(match[2]);

    if (year < 1000 || year > 9999) {
      return { valid: false, error: 'Invalid year' };
    }
    if (month < 1 || month > 12) {
      return { valid: false, error: 'Invalid month' };
    }

    return { valid: true, normalized };
  }

  if (yearRegex.test(normalized)) {
    const year = parseInt(normalized);

    if (year < 1000 || year > 9999) {
      return { valid: false, error: 'Invalid year' };
    }

    return { valid: true, normalized };
  }

  return { valid: false, error: 'Invalid date format (use YYYY, YYYY-MM, or YYYY-MM-DD)' };
}

/**
 * Validate URL
 */
export function validateURL(url: string | undefined): ValidationResult {
  if (!url) {
    return { valid: false, error: 'URL is empty' };
  }

  try {
    const parsed = new URL(url);
    // Must be http or https
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { valid: false, error: 'URL must use HTTP or HTTPS protocol' };
    }
    return { valid: true, normalized: url.trim() };
  } catch (e) {
    return { valid: false, error: 'Invalid URL format' };
  }
}

/**
 * Validate author name
 * Basic validation - ensures name is not empty and has reasonable length
 */
export function validateAuthorName(name: string | undefined): ValidationResult {
  if (!name) {
    return { valid: false, error: 'Author name is empty' };
  }

  const normalized = name.trim();

  if (normalized.length < 2) {
    return { valid: false, error: 'Author name too short' };
  }

  if (normalized.length > 200) {
    return { valid: false, error: 'Author name too long' };
  }

  // Basic sanity check - should contain at least one letter
  if (!/[a-zA-Z]/.test(normalized)) {
    return { valid: false, error: 'Author name must contain letters' };
  }

  return { valid: true, normalized };
}

/**
 * Validate title
 * Ensures title is not empty and has reasonable length
 */
export function validateTitle(title: string | undefined): ValidationResult {
  if (!title) {
    return { valid: false, error: 'Title is empty' };
  }

  const normalized = title.trim();

  if (normalized.length < 10) {
    return { valid: false, error: 'Title too short (min 10 characters)' };
  }

  if (normalized.length > 500) {
    return { valid: false, error: 'Title too long (max 500 characters)' };
  }

  return { valid: true, normalized };
}

/**
 * Validate abstract
 * Ensures abstract is not empty and has reasonable length
 */
export function validateAbstract(abstract: string | undefined): ValidationResult {
  if (!abstract) {
    return { valid: false, error: 'Abstract is empty' };
  }

  const normalized = abstract.trim();

  if (normalized.length < 50) {
    return { valid: false, error: 'Abstract too short (min 50 characters)' };
  }

  if (normalized.length > 10000) {
    return { valid: false, error: 'Abstract too long (max 10000 characters)' };
  }

  return { valid: true, normalized };
}

/**
 * Validate license string
 * Accepts common license identifiers
 */
export function validateLicense(license: string | undefined): ValidationResult {
  if (!license) {
    return { valid: false, error: 'License is empty' };
  }

  const normalized = license.trim();

  // Common license patterns
  const commonLicenses = [
    /^CC[-\s]?(BY|NC|ND|SA|ZERO)[-\s]?(\d\.\d)?$/i, // Creative Commons
    /^MIT$/i,
    /^Apache[-\s]?\d\.\d$/i,
    /^GPL[-\s]?v?\d$/i,
    /^BSD[-\s]?\d?[-\s]?Clause$/i,
    /^All Rights Reserved$/i,
    /^Public Domain$/i,
  ];

  const isCommonLicense = commonLicenses.some(pattern => pattern.test(normalized));

  if (!isCommonLicense && normalized.length > 100) {
    return { valid: false, error: 'License string too long or unrecognized' };
  }

  return { valid: true, normalized };
}

/**
 * Validate version string for preprints
 * Format: v1, v2, v3, etc.
 */
export function validateVersion(version: string | undefined): ValidationResult {
  if (!version) {
    return { valid: false, error: 'Version is empty' };
  }

  let normalized = version.trim().toLowerCase();

  // Add 'v' prefix if missing
  if (!/^v/.test(normalized)) {
    normalized = 'v' + normalized;
  }

  const versionRegex = /^v\d+$/;

  if (!versionRegex.test(normalized)) {
    return { valid: false, error: 'Invalid version format (use v1, v2, etc.)' };
  }

  return { valid: true, normalized };
}

/**
 * Comprehensive metadata validation
 * Returns validation results for all fields
 */
export function validateMetadata(metadata: Record<string, any>): Record<string, ValidationResult> {
  const results: Record<string, ValidationResult> = {};

  if (metadata.doi !== undefined) {
    results.doi = validateDOI(metadata.doi);
  }

  if (metadata.arxivId !== undefined) {
    results.arxivId = validateArxivId(metadata.arxivId);
  }

  if (metadata.pmid !== undefined) {
    results.pmid = validatePMID(metadata.pmid);
  }

  if (metadata.pmcid !== undefined) {
    results.pmcid = validatePMCID(metadata.pmcid);
  }

  if (metadata.publishDate !== undefined) {
    results.publishDate = validateDate(metadata.publishDate);
  }

  if (metadata.pdfUrl !== undefined) {
    results.pdfUrl = validateURL(metadata.pdfUrl);
  }

  if (metadata.htmlUrl !== undefined) {
    results.htmlUrl = validateURL(metadata.htmlUrl);
  }

  if (metadata.license !== undefined) {
    results.license = validateLicense(metadata.license);
  }

  if (metadata.version !== undefined) {
    results.version = validateVersion(metadata.version);
  }

  return results;
}

/**
 * Apply validation results to metadata, replacing values with normalized versions
 * and adding validation flags
 */
export function applyValidation(
  metadata: Record<string, any>,
  validationResults: Record<string, ValidationResult>
): Record<string, any> {
  const validated = { ...metadata };

  for (const [field, result] of Object.entries(validationResults)) {
    if (result.valid && result.normalized !== undefined) {
      validated[field] = result.normalized;
    } else if (!result.valid) {
      // Optionally keep invalid values but mark them
      console.warn(`Validation failed for ${field}: ${result.error}`);
    }
  }

  return validated;
}
