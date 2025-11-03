/**
 * JSON Schemas for Chrome Prompt API Structured Output
 *
 * These schemas correspond to TypeScript interfaces defined in src/types/index.ts
 * and are used with Chrome's responseConstraint parameter to ensure valid JSON responses.
 *
 * @see https://developer.chrome.com/docs/ai/structured-output-for-prompt-api
 */

import { JSONSchema } from '../utils/typeToSchema.ts';

/**
 * Schema for PaperMetadata extraction
 * Corresponds to: src/types/index.ts - PaperMetadata interface
 */
export const paperMetadataSchema: JSONSchema = {
  type: 'object',
  properties: {
    title: {
      type: 'string',
      description: 'The title of the research paper',
    },
    authors: {
      type: 'array',
      items: {
        type: 'string',
      },
      description: 'List of paper authors',
    },
    abstract: {
      type: 'string',
      description: 'The abstract or summary of the paper',
    },
    publishDate: {
      type: ['string', 'null'],
      description: 'Publication date in YYYY-MM-DD format, or null if unavailable',
    },
    journal: {
      type: ['string', 'null'],
      description: 'Journal name where the paper was published, or null if unavailable',
    },
    venue: {
      type: ['string', 'null'],
      description: 'Conference or journal venue name, or null if unavailable',
    },
    doi: {
      type: ['string', 'null'],
      description: 'Digital Object Identifier (DOI), or null if unavailable',
    },
    arxivId: {
      type: ['string', 'null'],
      description: 'arXiv identifier if applicable, or null',
    },
    pmid: {
      type: ['string', 'null'],
      description: 'PubMed ID if applicable, or null',
    },
    keywords: {
      type: ['array', 'null'],
      items: {
        type: 'string',
      },
      description: 'List of keywords or null if unavailable',
    },
  },
  required: ['title', 'authors', 'abstract'],
  additionalProperties: false,
};

/**
 * Schema for MethodologyAnalysis
 * Corresponds to: src/types/index.ts - MethodologyAnalysis interface
 */
export const methodologyAnalysisSchema: JSONSchema = {
  type: 'object',
  properties: {
    studyType:{
      type: 'string',
      description: 'Type of study (e.g. randomized controlled trial, cohort study, case-control study, etc.)',
    },
    studyDesign: {
      type: 'string',
      description: 'Detailed description of study design',
    },
    dataCollection: {
      type: 'string',
      description: 'How data was collected in the study',
    },
    sampleSize: {
      type: 'string',
      description: 'Sample size and population information',
    },
    statisticalMethods: {
      type: 'string',
      description: 'Statistical analyses and methods used',
    },
    strengths: {
      type: 'array',
      items: {
        type: 'string',
      },
      description: 'Key strengths of the methodology',
      minItems: 1,
    },
    concerns: {
      type: 'array',
      items: {
        type: 'string',
      },
      description: 'Concerns or weaknesses in the methodology',
      minItems: 1,
    },
  },
  required: ['studyDesign', 'dataCollection', 'sampleSize', 'statisticalMethods', 'strengths', 'concerns'],
  additionalProperties: false,
};

/**
 * Schema for ConfounderAnalysis
 * Corresponds to: src/types/index.ts - ConfounderAnalysis interface
 */
export const confounderAnalysisSchema: JSONSchema = {
  type: 'object',
  properties: {
    identified: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Name of the confounding variable',
          },
          explanation: {
            type: 'string',
            description: 'How this confounder affects the study results',
          },
        },
        required: ['name', 'explanation'],
        additionalProperties: false,
      },
      description: 'List of identified confounding variables with explanations',
      minItems: 1,
    },
    biases: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Name of the bias',
          },
          explanation: {
            type: 'string',
            description: 'How this bias affects the study results',
          },
        },
        required: ['name', 'explanation'],
        additionalProperties: false,
      },
      description: 'List of potential biases with explanations',
      minItems: 1,
    },
    controlMeasures: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Name of the control measure',
          },
          explanation: {
            type: 'string',
            description: 'How the study uses this control measure to address confounders/biases',
          },
        },
        required: ['name', 'explanation'],
        additionalProperties: false,
      },
      description: 'List of measures taken to control for confounders with explanations',
      minItems: 1,
    },
  },
  required: ['identified', 'biases', 'controlMeasures'],
  additionalProperties: false,
};

/**
 * Schema for ImplicationAnalysis
 * Corresponds to: src/types/index.ts - ImplicationAnalysis interface
 */
export const implicationAnalysisSchema: JSONSchema = {
  type: 'object',
  properties: {
    realWorldApplications: {
      type: 'array',
      items: {
        type: 'string',
      },
      description: 'Practical real-world applications of the research',
      minItems: 1,
    },
    significance: {
      type: 'string',
      description: 'Overall significance and impact of the findings',
    },
    futureResearch: {
      type: 'array',
      items: {
        type: 'string',
      },
      description: 'Suggested directions for future research',
      minItems: 1,
    },
  },
  required: ['realWorldApplications', 'significance', 'futureResearch'],
  additionalProperties: false,
};

/**
 * Schema for LimitationAnalysis
 * Corresponds to: src/types/index.ts - LimitationAnalysis interface
 */
export const limitationAnalysisSchema: JSONSchema = {
  type: 'object',
  properties: {
    studyLimitations: {
      type: 'array',
      items: {
        type: 'string',
      },
      description: 'Key limitations of the study',
      minItems: 1,
    },
    generalizability: {
      type: 'string',
      description: 'Assessment of how generalizable the findings are',
    }
  },
  required: ['studyLimitations', 'generalizability'],
  additionalProperties: false,
};

/**
 * Schema for GlossaryResult
 * Corresponds to: src/types/index.ts - GlossaryResult interface
 */
export const glossarySchema: JSONSchema = {
  type: 'object',
  properties: {
    terms: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          acronym: {
            type: 'string',
            description: 'The acronym, initialism, technical abbreviation, or key term (e.g., RCT, CI, FDA)',
            maxLength: 20,
          },
          longForm: {
            type: 'string',
            description: 'The full expanded form of the acronym, initialism, technical abbreviation, or key term',
            maxLength: 100,
          },
          definition: {
            type: 'string',
            description: 'Clear, concise definition of what this term means',
          },
          studyContext: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                context: {
                  type: 'string',
                  description: 'Describe how this term is used in this paper',
                },
                sections: {
                  type: 'array',
                  items: {
                    type: 'string',
                    description: 'Section name or number where this context applies'
                  },
                  description: 'Paper sections where this context is found',
                  minItems: 1,
                }
              },
              required: ['context', 'sections'],
              additionalProperties: false
            },
            description: 'Different contexts where this term appears with their sections',
            minItems: 1
          },
          analogy: {
            type: 'string',
            description: 'A simple analogy to help understand the concept',
            maxLength: 200,
          }
        },
        required: ['acronym', 'longForm', 'definition', 'studyContext', 'analogy'],
        additionalProperties: false,
      },
      description: 'List of glossary terms found in the paper',
      minItems: 1
    }
  },
  required: ['terms'],
  additionalProperties: false,
};

/**
 * Schema for ImageExplanationResult
 * Corresponds to: src/types/index.ts - ImageExplanationResult interface
 */
export const imageExplanationSchema: JSONSchema = {
  type: 'object',
  properties: {
    title: {
      type: 'string',
      description: 'Concise 3-7 word title describing what the image shows (e.g., "Neural Network Architecture Diagram", "Comparison of Treatment Outcomes")',
      maxLength: 100,
    },
    explanation: {
      type: 'string',
      description: `Detailed explanation of what the image shows in the context of the research paper.

Math formatting with LaTeX:
- Use $expr$ for inline math, $$expr$$ for display equations

Use markdown formatting (bold, italic, lists, headers) for structure. Include: what the image depicts, key findings, trends, patterns, and relevance to the paper.`,
    },
  },
  required: ['title', 'explanation'],
  additionalProperties: false,
};
