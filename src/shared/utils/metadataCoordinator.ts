/**
 * Hybrid Metadata Extraction Coordinator
 *
 * Orchestrates metadata extraction from multiple sources and intelligently merges results.
 * Implements a field-level fallback strategy:
 * 1. Domain-specific extraction (highest priority)
 * 2. Schema.org structured data
 * 3. AI extraction for missing fields
 *
 * Tracks extraction source and confidence for each field.
 */

import { ResearchPaper, PaperMetadata, ExtractionSource, FieldMetadata } from '../types';
import { validateMetadata, ValidationResult } from './validators';

/**
 * Partial extraction result from a single source
 */
export interface PartialExtractionResult {
  title?: string;
  authors?: string[];
  abstract?: string;
  metadata?: Partial<PaperMetadata>;
  source: ExtractionSource;
  confidence: number; // Overall confidence for this extraction method (0-1)
}

/**
 * Priority order for extraction sources (higher = better)
 */
const SOURCE_PRIORITY: Record<ExtractionSource, number> = {
  'dom-selector': 5,     // Highest - direct from structured HTML
  'schema.org': 4,       // High - structured data
  'pdf-properties': 3,   // Medium-high - PDF metadata
  'ai': 2,               // Medium - AI extraction
  'heuristic': 1,        // Low - pattern matching
  'manual': 6,           // Highest - user provided
};

/**
 * Base confidence scores for each extraction source
 */
const SOURCE_CONFIDENCE: Record<ExtractionSource, number> = {
  'dom-selector': 0.95,
  'schema.org': 0.90,
  'pdf-properties': 0.85,
  'ai': 0.75,
  'heuristic': 0.60,
  'manual': 1.0,
};

/**
 * Merge multiple partial extraction results into a single comprehensive result
 *
 * Strategy:
 * - For each field, prefer the result from the highest-priority source
 * - Track the source of each field for transparency
 * - Apply validation to all fields
 * - Calculate per-field confidence scores
 */
export function mergeExtractionResults(
  results: PartialExtractionResult[]
): ResearchPaper | null {
  if (results.length === 0) {
    return null;
  }

  // Initialize merged result
  const merged: Partial<ResearchPaper> & {
    metadata?: PaperMetadata & { fieldSources?: Record<string, FieldMetadata> }
  } = {
    title: '',
    authors: [],
    abstract: '',
    url: '',
    source: 'other',
    metadata: {
      fieldSources: {},
    },
  };

  const fieldSources: Record<string, FieldMetadata> = {};
  const attemptedSources = new Set<string>();
  const failedSources = new Set<string>();

  // Track which sources were attempted
  results.forEach(result => {
    attemptedSources.add(result.source);
  });

  // Core fields: title, authors, abstract
  const coreFields = ['title', 'authors', 'abstract'] as const;

  for (const field of coreFields) {
    const candidates = results
      .filter(r => r[field] && (Array.isArray(r[field]) ? r[field]!.length > 0 : r[field]))
      .sort((a, b) => {
        // Sort by priority (higher first), then by confidence
        const priorityDiff = SOURCE_PRIORITY[b.source] - SOURCE_PRIORITY[a.source];
        if (priorityDiff !== 0) return priorityDiff;
        return b.confidence - a.confidence;
      });

    if (candidates.length > 0) {
      const best = candidates[0];
      merged[field] = best[field]!;

      fieldSources[field] = {
        value: best[field],
        source: best.source,
        confidence: best.confidence * SOURCE_CONFIDENCE[best.source],
        extractedAt: Date.now(),
        validationPassed: true, // Will be updated after validation
      };
    } else {
      // Track failed extraction for this field
      failedSources.add(field);
    }
  }

  // Metadata fields
  const metadataFields = [
    'publishDate', 'journal', 'venue', 'doi', 'arxivId', 'pmid', 'pmcid',
    'pdfUrl', 'htmlUrl', 'keywords', 'citations', 'license', 'version',
    'publicationType',
  ] as const;

  for (const field of metadataFields) {
    const candidates = results
      .filter(r => r.metadata?.[field])
      .sort((a, b) => {
        const priorityDiff = SOURCE_PRIORITY[b.source] - SOURCE_PRIORITY[a.source];
        if (priorityDiff !== 0) return priorityDiff;
        return b.confidence - a.confidence;
      });

    if (candidates.length > 0) {
      const best = candidates[0];
      const value = best.metadata![field];
      merged.metadata![field] = value as any;

      fieldSources[`metadata.${field}`] = {
        value,
        source: best.source,
        confidence: best.confidence * SOURCE_CONFIDENCE[best.source],
        extractedAt: Date.now(),
        validationPassed: true,
      };
    }
  }

  // Validate all metadata fields
  const metadataToValidate: Record<string, any> = {};
  for (const field of metadataFields) {
    if (merged.metadata![field] !== undefined) {
      metadataToValidate[field as string] = merged.metadata![field];
    }
  }

  const validationResults = validateMetadata(metadataToValidate);

  // Apply validation results to field sources
  for (const [field, result] of Object.entries(validationResults)) {
    const fieldKey = `metadata.${field}`;
    if (fieldSources[fieldKey]) {
      fieldSources[fieldKey].validationPassed = result.valid;
      if (!result.valid) {
        fieldSources[fieldKey].validationError = result.error;
      }
      // Use normalized value if validation passed
      if (result.valid && result.normalized !== undefined) {
        merged.metadata![field as keyof PaperMetadata] = result.normalized as any;
        fieldSources[fieldKey].value = result.normalized;
      }
    }
  }

  // Determine primary source based on highest number of fields extracted
  const sourceCounts = new Map<string, number>();
  Object.values(fieldSources).forEach(field => {
    const count = sourceCounts.get(field.source) || 0;
    sourceCounts.set(field.source, count + 1);
  });

  let primarySource: ResearchPaper['source'] = 'other';
  let maxCount = 0;
  for (const [source, count] of sourceCounts.entries()) {
    if (count > maxCount) {
      maxCount = count;
      // Map extraction source to paper source
      if (source === 'dom-selector' || source === 'schema.org') {
        // Will be set based on URL domain
        primarySource = 'other';
      } else if (source === 'ai') {
        primarySource = 'ai-extracted';
      } else {
        primarySource = 'other';
      }
    }
  }

  merged.source = primarySource;

  // Add metadata tracking
  merged.metadata!.extractionMethod = results.length > 1 ? 'hybrid' :
    (results[0].source === 'dom-selector' || results[0].source === 'schema.org') ? 'site-specific' :
    results[0].source === 'ai' ? 'ai' :
    'manual';

  merged.metadata!.extractionTimestamp = Date.now();
  merged.metadata!.extractionAttempts = results.length;
  merged.metadata!.failedMethods = Array.from(failedSources);
  merged.metadata!.partialExtraction = failedSources.size > 0;
  merged.metadata!.fieldSources = fieldSources;

  // Calculate overall confidence (average of all field confidences)
  const confidences = Object.values(fieldSources).map(f => f.confidence);
  merged.metadata!.confidence = confidences.length > 0
    ? confidences.reduce((a, b) => a + b, 0) / confidences.length
    : 0;

  // Validate minimum required fields
  if (!merged.title || merged.title.length < 10) {
    console.warn('Merged result missing valid title');
    return null;
  }

  if (!merged.authors || merged.authors.length === 0) {
    console.warn('Merged result missing authors');
    // Continue anyway - some PDFs may not have author metadata
  }

  if (!merged.abstract || merged.abstract.length < 50) {
    console.warn('Merged result has short/missing abstract');
    // Continue anyway - some papers may have short abstracts
  }

  return merged as ResearchPaper;
}

/**
 * Identify missing fields from an extraction result
 */
export function identifyMissingFields(result: PartialExtractionResult): string[] {
  const missing: string[] = [];

  // Check core fields
  if (!result.title || result.title.length < 10) missing.push('title');
  if (!result.authors || result.authors.length === 0) missing.push('authors');
  if (!result.abstract || result.abstract.length < 50) missing.push('abstract');

  // Check important metadata fields
  const importantMetadata = ['publishDate', 'doi', 'journal', 'venue'];
  for (const field of importantMetadata) {
    if (!result.metadata?.[field as keyof PaperMetadata]) {
      missing.push(field);
    }
  }

  return missing;
}

/**
 * Create a partial extraction result from a ResearchPaper object
 * (for backwards compatibility with existing extractors)
 */
export function paperToPartialResult(
  paper: Partial<ResearchPaper>,
  source: ExtractionSource,
  confidence: number = 0.8
): PartialExtractionResult {
  return {
    title: paper.title,
    authors: paper.authors,
    abstract: paper.abstract,
    metadata: paper.metadata,
    source,
    confidence,
  };
}

/**
 * Determine paper source based on URL
 */
export function determinePaperSource(url: string): ResearchPaper['source'] {
  const urlLower = url.toLowerCase();

  if (urlLower.includes('arxiv.org')) return 'arxiv';
  if (urlLower.includes('pubmed') || urlLower.includes('ncbi.nlm.nih.gov')) return 'pubmed';
  if (urlLower.includes('biorxiv') || urlLower.includes('medrxiv')) return 'biorxiv';
  if (urlLower.includes('ieee')) return 'ieee';
  if (urlLower.includes('acm.org') || urlLower.includes('dl.acm.org')) return 'acm';
  if (urlLower.includes('sciencedirect')) return 'sciencedirect';
  if (urlLower.includes('nature.com')) return 'nature';
  if (urlLower.includes('science.org') || urlLower.includes('sciencemag.org')) return 'science';
  if (urlLower.includes('pnas.org')) return 'pnas';
  if (urlLower.includes('ssrn.com')) return 'ssrn';
  if (urlLower.includes('semanticscholar')) return 'semanticscholar';
  if (urlLower.includes('springer')) return 'springer';
  if (urlLower.includes('scholar.google')) return 'scholar';
  if (urlLower.endsWith('.pdf')) return 'pdf';

  return 'other';
}

/**
 * Calculate extraction quality score (0-100)
 * Based on:
 * - Number of fields extracted
 * - Validation pass rate
 * - Average confidence
 */
export function calculateExtractionQuality(paper: ResearchPaper): number {
  const metadata = paper.metadata;
  if (!metadata || !metadata.fieldSources) {
    return 0;
  }

  const fieldSources = Object.values(metadata.fieldSources);
  if (fieldSources.length === 0) {
    return 0;
  }

  // Count validated fields
  const validatedFields = fieldSources.filter(f => f.validationPassed).length;
  const validationRate = validatedFields / fieldSources.length;

  // Average confidence
  const avgConfidence = fieldSources.reduce((sum, f) => sum + f.confidence, 0) / fieldSources.length;

  // Completeness (out of 13 total possible fields: title, authors, abstract, + 10 metadata fields)
  const completeness = Math.min(fieldSources.length / 13, 1.0);

  // Weighted score
  const score = (validationRate * 0.3 + avgConfidence * 0.4 + completeness * 0.3) * 100;

  return Math.round(score);
}
