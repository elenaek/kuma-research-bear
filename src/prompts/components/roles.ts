/**
 * Role definitions for system prompts
 * These define the AI's persona and primary function
 */

import type { RoleType, PromptComponent } from '../types';

/**
 * Map of role types to their definitions
 */
export const ROLES: Record<RoleType, PromptComponent> = {
  /**
   * Kuma - The friendly research bear assistant
   * Used for: Chat interface (paper and image chat)
   */
  kumaAssistant: {
    content: 'You are Kuma, a friendly research bear assistant',
    tokens: 10,
  },

  /**
   * Research Assistant - General purpose helper
   * Used for: Q&A, general research tasks
   */
  researchAssistant: {
    content: 'You are a helpful research assistant',
    tokens: 8,
  },

  /**
   * Expert Research Assistant - Domain specialist
   * Used for: Image explanations, complex analysis
   */
  expertResearchAssistant: {
    content: 'You are an expert research assistant',
    tokens: 8,
  },

  /**
   * Metadata Extraction Expert
   * Used for: Extracting structured metadata from papers
   */
  metadataExpert: {
    content: 'You are a research paper metadata extraction expert',
    tokens: 10,
  },

  /**
   * Simplifier - Text simplification specialist
   * Used for: Simplifying complex academic text, explaining terms
   */
  simplifier: {
    content: 'You are a helpful assistant that rewrites complex academic text in simple, clear language',
    tokens: 18,
  },

  /**
   * Explainer - Explanation specialist
   * Used for: Explaining abstracts, terms, sections
   */
  explainer: {
    content: 'You are a helpful research assistant that explains complex academic papers in simple terms',
    tokens: 18,
  },

  /**
   * Analyzer - Analysis specialist
   * Used for: Methodology, confounders, implications, limitations analysis
   */
  analyzer: {
    content: 'You are a research methodology expert',
    tokens: 8,
  },
};

/**
 * Specialized analyzer roles for different analysis types
 */
export const ANALYZER_ROLES = {
  methodology: {
    content: 'You are a research methodology expert. Analyze research papers for their study design, methods, and rigor.',
    tokens: 20,
  },
  confounders: {
    content: 'You are a research quality expert specializing in identifying biases and confounding variables.',
    tokens: 18,
  },
  implications: {
    content: 'You are a research impact expert who identifies practical applications and significance of research.',
    tokens: 18,
  },
  limitations: {
    content: 'You are a research critique expert who identifies limitations and constraints in studies.',
    tokens: 16,
  },
  glossaryExtraction: {
    content: 'You are a research paper expert who identifies important technical terms and acronyms for glossaries.',
    tokens: 18,
  },
  glossaryDefinition: {
    content: 'You are a research paper terminology expert who provides clear, accurate definitions for technical terms and acronyms.',
    tokens: 22,
  },
  glossaryDeduplication: {
    content: 'You are a research paper glossary expert who deduplicates and selects technical terms.',
    tokens: 18,
  },
};

/**
 * Utility roles for specific tasks
 */
export const UTILITY_ROLES = {
  citationAssistant: {
    content: 'You are a research paper citation assistant.',
    tokens: 10,
  },
  summaryCreator: {
    content: 'You are a research assistant that creates concise summaries of academic papers.',
    tokens: 16,
  },
  termExplainer: {
    content: 'You are a helpful assistant that explains technical and scientific terms in simple language.',
    tokens: 18,
  },
};

/**
 * Get a role definition by type
 */
export function getRole(roleType: RoleType): string {
  return ROLES[roleType].content;
}

/**
 * Get estimated token count for a role
 */
export function getRoleTokens(roleType: RoleType): number {
  return ROLES[roleType].tokens || 10;
}
