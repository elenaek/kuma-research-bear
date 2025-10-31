/**
 * Paper Detection Module
 * Detects if a page contains a research paper using heuristic scoring + AI fallback
 * Domain-agnostic approach using universal signals (Abstract, References, DOI, citations, etc.)
 */

import { buildPaperDetectionPrompt } from '../prompts/templates/detection.ts';
import { getOutputLanguage } from './settingsService.ts';

export interface PaperDetectionResult {
  isResearchPaper: boolean;
  confidence: number; // 0-100
  reason: string;
  details?: {
    hasAbstract: boolean;
    hasReferences: boolean;
    hasDOI: boolean;
    hasCitations: boolean;
    isAcademicURL: boolean;
    hasAffiliations: boolean;
  };
}

/**
 * Detect if the current page contains a research paper
 * Uses heuristic scoring first, falls back to AI for medium confidence cases
 */
export async function detectResearchPaper(): Promise<PaperDetectionResult> {
  // Guard against non-document contexts
  if (typeof document === 'undefined') {
    return {
      isResearchPaper: false,
      confidence: 0,
      reason: 'Not a document context',
    };
  }

  // Step 1: Heuristic scoring
  const heuristicResult = scorePageAsResearchPaper();

  // Step 2: Determine if AI fallback is needed (medium confidence: 35-59)
  if (heuristicResult.confidence >= 35 && heuristicResult.confidence < 60) {
    console.log('[PaperDetection] Medium confidence, using AI fallback...');
    try {
      const aiResult = await aiDetectionFallback();
      return {
        ...heuristicResult,
        isResearchPaper: aiResult.isResearchPaper,
        reason: `Heuristics uncertain (${heuristicResult.confidence}%), AI confirmed: ${aiResult.reason}`,
      };
    } catch (error) {
      console.error('[PaperDetection] AI fallback failed:', error);
      // Fall through to heuristic result
    }
  }

  return heuristicResult;
}

/**
 * Score page using heuristic signals
 * Universal signals that work across all research disciplines
 */
function scorePageAsResearchPaper(): PaperDetectionResult {
  let score = 0;
  const details = {
    hasAbstract: false,
    hasReferences: false,
    hasDOI: false,
    hasCitations: false,
    isAcademicURL: false,
    hasAffiliations: false,
  };

  // Get page content for analysis
  const bodyText = document.body.textContent || '';
  const htmlContent = document.documentElement.outerHTML;
  const url = window.location.href.toLowerCase();

  // Signal 1: Has "Abstract" or "Summary" heading (25 points)
  const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6'));
  const headingTexts = headings.map(h => h.textContent?.toLowerCase().trim() || '');

  if (headingTexts.some(text =>
    text === 'abstract' ||
    text === 'summary' ||
    text.includes('abstract') ||
    text.includes('summary')
  )) {
    score += 25;
    details.hasAbstract = true;
  }

  // Signal 2: Has "References" or "Bibliography" section (25 points)
  if (headingTexts.some(text =>
    text === 'references' ||
    text === 'bibliography' ||
    text === 'works cited' ||
    text.includes('references') ||
    text.includes('bibliography')
  )) {
    score += 25;
    details.hasReferences = true;
  }

  // Signal 3: Contains DOI pattern (20 points)
  const doiPattern = /10\.\d{4,}\/[^\s]+/;
  if (doiPattern.test(bodyText) || doiPattern.test(htmlContent)) {
    score += 20;
    details.hasDOI = true;
  }

  // Signal 4: Has citation patterns (15 points)
  // Check for: [1], [2], (Author, 2024), (Author et al., 2024)
  const bracketCitations = /\[\d+\]/g.test(bodyText);
  const parentheticalCitations = /\([A-Z][a-z]+ (et al\.)?,?\s*\d{4}\)/g.test(bodyText);

  if (bracketCitations || parentheticalCitations) {
    score += 15;
    details.hasCitations = true;
  }

  // Signal 5: Academic URL patterns (10 points)
  const academicDomains = [
    'arxiv.org',
    'pubmed',
    'ncbi.nlm.nih.gov',
    'ieee',
    'acm.org',
    'springer',
    'sciencedirect',
    'nature.com',
    'science.org',
    'pnas.org',
    'biorxiv',
    'medrxiv',
    'ssrn.com',
    'researchgate',
    'semanticscholar',
    'scholar.google',
  ];

  if (academicDomains.some(domain => url.includes(domain))) {
    score += 10;
    details.isAcademicURL = true;
  }

  // Signal 6: Has author affiliations/institutions (5 points)
  const affiliationKeywords = [
    'university',
    'institute',
    'department',
    'laboratory',
    'college',
    'school of',
    'faculty of',
  ];

  const firstThousandChars = bodyText.substring(0, 1000).toLowerCase();
  if (affiliationKeywords.some(keyword => firstThousandChars.includes(keyword))) {
    score += 5;
    details.hasAffiliations = true;
  }

  // Determine confidence level
  const isResearchPaper = score >= 60; // High confidence threshold
  const confidenceLevel =
    score >= 60 ? 'High' :
    score >= 35 ? 'Medium' :
    'Low';

  // Build reason string
  const signals = [];
  if (details.hasAbstract) signals.push('Abstract');
  if (details.hasReferences) signals.push('References');
  if (details.hasDOI) signals.push('DOI');
  if (details.hasCitations) signals.push('Citations');
  if (details.isAcademicURL) signals.push('Academic URL');
  if (details.hasAffiliations) signals.push('Affiliations');

  const reason = signals.length > 0
    ? `${confidenceLevel} confidence (${score}%). Found: ${signals.join(', ')}`
    : `${confidenceLevel} confidence (${score}%). No strong signals detected`;

  return {
    isResearchPaper,
    confidence: score,
    reason,
    details,
  };
}

/**
 * AI-based detection fallback for medium confidence cases
 * Uses Chrome Built-in AI to analyze first ~2000 chars
 */
async function aiDetectionFallback(): Promise<{ isResearchPaper: boolean; reason: string }> {
  try {
    // Check if LanguageModel is available
    if (typeof LanguageModel === 'undefined') {
      throw new Error('LanguageModel API not available');
    }

    // Get first ~2000 chars of page content
    const bodyText = document.body.textContent || '';
    const sampleText = bodyText.substring(0, 2000);

    // Create session for detection
    const outputLanguage = await getOutputLanguage();
    const session = await LanguageModel.create({
      temperature: 0.0, // Deterministic
      systemPrompt: buildPaperDetectionPrompt(),
      expectedInputs: [{ type: 'text', languages: ["en", "es", "ja"] }],
      expectedOutputs: [{ type: 'text', languages: [outputLanguage || "en"] }], // Paper detection should be consistent
    });

    // Ask AI
    const prompt = `Is the following text from an academic/research paper? Answer "yes" or "no" followed by a brief reason (max 20 words).

Text:
${sampleText}`;

    const response = await session.prompt(prompt);
    session.destroy();

    // Parse response
    const lowerResponse = response.toLowerCase();
    const isResearchPaper = lowerResponse.startsWith('yes');
    const reason = response.substring(0, 100); // Truncate if needed

    return { isResearchPaper, reason };
  } catch (error) {
    console.error('[PaperDetection] AI fallback error:', error);
    throw error;
  }
}

/**
 * Quick check if URL looks like a research paper (for pre-filtering)
 * Lightweight, synchronous check before full detection
 */
export function quickURLCheck(): boolean {
  const url = window.location.href.toLowerCase();

  // PDF papers
  if (url.endsWith('.pdf')) return true;

  // Academic domains
  const academicDomains = [
    'arxiv.org',
    'pubmed',
    'ncbi.nlm.nih.gov',
    'ieee',
    'acm.org',
    'springer',
    'sciencedirect',
    'nature.com',
    'science.org',
    'biorxiv',
    'medrxiv',
  ];

  return academicDomains.some(domain => url.includes(domain));
}
