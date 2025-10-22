/**
 * Multi-Language JSON Schemas for Chrome Prompt API Structured Output
 *
 * Provides schema descriptions in English, Spanish, and Japanese to ensure
 * the AI model receives language-consistent guidance when generating structured output.
 *
 * @see https://developer.chrome.com/docs/ai/structured-output-for-prompt-api
 */

import { JSONSchema } from '../utils/typeToSchema.ts';

// ============================================================================
// METHODOLOGY ANALYSIS SCHEMAS
// ============================================================================

export const methodologyAnalysisSchema_en: JSONSchema = {
  type: 'object',
  properties: {
    studyType: {
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

export const methodologyAnalysisSchema_es: JSONSchema = {
  type: 'object',
  properties: {
    studyType: {
      type: 'string',
      description: 'Tipo de estudio (ej. ensayo controlado aleatorizado, estudio de cohorte, estudio de casos y controles, etc.)',
    },
    studyDesign: {
      type: 'string',
      description: 'Descripción detallada del diseño del estudio',
    },
    dataCollection: {
      type: 'string',
      description: 'Cómo se recopilaron los datos en el estudio',
    },
    sampleSize: {
      type: 'string',
      description: 'Tamaño de la muestra e información de la población',
    },
    statisticalMethods: {
      type: 'string',
      description: 'Análisis estadísticos y métodos utilizados',
    },
    strengths: {
      type: 'array',
      items: {
        type: 'string',
      },
      description: 'Fortalezas clave de la metodología',
      minItems: 1,
    },
    concerns: {
      type: 'array',
      items: {
        type: 'string',
      },
      description: 'Preocupaciones o debilidades en la metodología',
      minItems: 1,
    },
  },
  required: ['studyDesign', 'dataCollection', 'sampleSize', 'statisticalMethods', 'strengths', 'concerns'],
  additionalProperties: false,
};

export const methodologyAnalysisSchema_ja: JSONSchema = {
  type: 'object',
  properties: {
    studyType: {
      type: 'string',
      description: '研究の種類（例：ランダム化比較試験、コホート研究、症例対照研究など）',
    },
    studyDesign: {
      type: 'string',
      description: '研究デザインの詳細な説明',
    },
    dataCollection: {
      type: 'string',
      description: '研究でデータがどのように収集されたか',
    },
    sampleSize: {
      type: 'string',
      description: 'サンプルサイズと母集団の情報',
    },
    statisticalMethods: {
      type: 'string',
      description: '使用された統計分析と方法',
    },
    strengths: {
      type: 'array',
      items: {
        type: 'string',
      },
      description: '方法論の主な強み',
      minItems: 1,
    },
    concerns: {
      type: 'array',
      items: {
        type: 'string',
      },
      description: '方法論における懸念や弱点',
      minItems: 1,
    },
  },
  required: ['studyDesign', 'dataCollection', 'sampleSize', 'statisticalMethods', 'strengths', 'concerns'],
  additionalProperties: false,
};

// ============================================================================
// CONFOUNDER ANALYSIS SCHEMAS
// ============================================================================

export const confounderAnalysisSchema_en: JSONSchema = {
  type: 'object',
  properties: {
    identified: {
      type: 'array',
      items: {
        type: 'string',
      },
      description: 'List of identified confounding variables',
      minItems: 1,
    },
    biases: {
      type: 'array',
      items: {
        type: 'string',
      },
      description: 'List of potential biases',
      minItems: 1,
    },
    controlMeasures: {
      type: 'array',
      items: {
        type: 'string',
      },
      description: 'Measures taken to control for confounders',
      minItems: 1,
    },
  },
  required: ['identified', 'biases', 'controlMeasures'],
  additionalProperties: false,
};

export const confounderAnalysisSchema_es: JSONSchema = {
  type: 'object',
  properties: {
    identified: {
      type: 'array',
      items: {
        type: 'string',
      },
      description: 'Lista de variables de confusión identificadas',
      minItems: 1,
    },
    biases: {
      type: 'array',
      items: {
        type: 'string',
      },
      description: 'Lista de sesgos potenciales',
      minItems: 1,
    },
    controlMeasures: {
      type: 'array',
      items: {
        type: 'string',
      },
      description: 'Medidas tomadas para controlar los factores de confusión',
      minItems: 1,
    },
  },
  required: ['identified', 'biases', 'controlMeasures'],
  additionalProperties: false,
};

export const confounderAnalysisSchema_ja: JSONSchema = {
  type: 'object',
  properties: {
    identified: {
      type: 'array',
      items: {
        type: 'string',
      },
      description: '特定された交絡変数のリスト',
      minItems: 1,
    },
    biases: {
      type: 'array',
      items: {
        type: 'string',
      },
      description: '潜在的なバイアスのリスト',
      minItems: 1,
    },
    controlMeasures: {
      type: 'array',
      items: {
        type: 'string',
      },
      description: '交絡因子を制御するために取られた措置',
      minItems: 1,
    },
  },
  required: ['identified', 'biases', 'controlMeasures'],
  additionalProperties: false,
};

// ============================================================================
// IMPLICATION ANALYSIS SCHEMAS
// ============================================================================

export const implicationAnalysisSchema_en: JSONSchema = {
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

export const implicationAnalysisSchema_es: JSONSchema = {
  type: 'object',
  properties: {
    realWorldApplications: {
      type: 'array',
      items: {
        type: 'string',
      },
      description: 'Aplicaciones prácticas del mundo real de la investigación',
      minItems: 1,
    },
    significance: {
      type: 'string',
      description: 'Significado e impacto general de los hallazgos',
    },
    futureResearch: {
      type: 'array',
      items: {
        type: 'string',
      },
      description: 'Direcciones sugeridas para investigaciones futuras',
      minItems: 1,
    },
  },
  required: ['realWorldApplications', 'significance', 'futureResearch'],
  additionalProperties: false,
};

export const implicationAnalysisSchema_ja: JSONSchema = {
  type: 'object',
  properties: {
    realWorldApplications: {
      type: 'array',
      items: {
        type: 'string',
      },
      description: '研究の実際的な現実世界での応用',
      minItems: 1,
    },
    significance: {
      type: 'string',
      description: '調査結果の全体的な重要性と影響',
    },
    futureResearch: {
      type: 'array',
      items: {
        type: 'string',
      },
      description: '将来の研究のために提案される方向性',
      minItems: 1,
    },
  },
  required: ['realWorldApplications', 'significance', 'futureResearch'],
  additionalProperties: false,
};

// ============================================================================
// LIMITATION ANALYSIS SCHEMAS
// ============================================================================

export const limitationAnalysisSchema_en: JSONSchema = {
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

export const limitationAnalysisSchema_es: JSONSchema = {
  type: 'object',
  properties: {
    studyLimitations: {
      type: 'array',
      items: {
        type: 'string',
      },
      description: 'Limitaciones clave del estudio',
      minItems: 1,
    },
    generalizability: {
      type: 'string',
      description: 'Evaluación de qué tan generalizables son los hallazgos',
    }
  },
  required: ['studyLimitations', 'generalizability'],
  additionalProperties: false,
};

export const limitationAnalysisSchema_ja: JSONSchema = {
  type: 'object',
  properties: {
    studyLimitations: {
      type: 'array',
      items: {
        type: 'string',
      },
      description: '研究の主な限界',
      minItems: 1,
    },
    generalizability: {
      type: 'string',
      description: '調査結果がどの程度一般化可能かの評価',
    }
  },
  required: ['studyLimitations', 'generalizability'],
  additionalProperties: false,
};

// ============================================================================
// GLOSSARY SCHEMAS
// ============================================================================

export const glossarySchema_en: JSONSchema = {
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

export const glossarySchema_es: JSONSchema = {
  type: 'object',
  properties: {
    terms: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          acronym: {
            type: 'string',
            description: 'El acrónimo, inicialismo, abreviatura técnica o término clave (ej., RCT, CI, FDA)',
            maxLength: 20,
          },
          longForm: {
            type: 'string',
            description: 'La forma completa expandida del acrónimo, inicialismo, abreviatura técnica o término clave',
            maxLength: 100,
          },
          definition: {
            type: 'string',
            description: 'Definición clara y concisa de lo que significa este término',
          },
          studyContext: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                context: {
                  type: 'string',
                  description: 'Describe cómo se usa este término en este artículo',
                },
                sections: {
                  type: 'array',
                  items: {
                    type: 'string',
                    description: 'Nombre o número de sección donde se aplica este contexto'
                  },
                  description: 'Secciones del artículo donde se encuentra este contexto',
                  minItems: 1,
                }
              },
              required: ['context', 'sections'],
              additionalProperties: false
            },
            description: 'Diferentes contextos donde aparece este término con sus secciones',
            minItems: 1
          },
          analogy: {
            type: 'string',
            description: 'Una analogía simple para ayudar a entender el concepto',
            maxLength: 200,
          }
        },
        required: ['acronym', 'longForm', 'definition', 'studyContext', 'analogy'],
        additionalProperties: false,
      },
      description: 'Lista de términos del glosario encontrados en el artículo',
      minItems: 1
    }
  },
  required: ['terms'],
  additionalProperties: false,
};

export const glossarySchema_ja: JSONSchema = {
  type: 'object',
  properties: {
    terms: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          acronym: {
            type: 'string',
            description: '頭字語、イニシャリズム、技術的略語、または重要用語（例：RCT、CI、FDA）',
            maxLength: 20,
          },
          longForm: {
            type: 'string',
            description: '頭字語、イニシャリズム、技術的略語、または重要用語の完全な展開形',
            maxLength: 100,
          },
          definition: {
            type: 'string',
            description: 'この用語の意味を明確かつ簡潔に定義',
          },
          studyContext: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                context: {
                  type: 'string',
                  description: 'この論文でこの用語がどのように使用されているかを説明',
                },
                sections: {
                  type: 'array',
                  items: {
                    type: 'string',
                    description: 'このコンテキストが適用されるセクション名または番号'
                  },
                  description: 'このコンテキストが見つかる論文のセクション',
                  minItems: 1,
                }
              },
              required: ['context', 'sections'],
              additionalProperties: false
            },
            description: 'この用語が登場する異なるコンテキストとそのセクション',
            minItems: 1
          },
          analogy: {
            type: 'string',
            description: '概念を理解するのに役立つ簡単な比喩',
            maxLength: 200,
          }
        },
        required: ['acronym', 'longForm', 'definition', 'studyContext', 'analogy'],
        additionalProperties: false,
      },
      description: '論文で見つかった用語集の用語リスト',
      minItems: 1
    }
  },
  required: ['terms'],
  additionalProperties: false,
};

// ============================================================================
// HELPER FUNCTION
// ============================================================================

/**
 * Get the appropriate schema for the specified analysis type and language
 * @param schemaType - Type of analysis schema needed
 * @param language - Output language (en, es, ja)
 * @returns JSONSchema with descriptions in the specified language
 */
export function getSchemaForLanguage(
  schemaType: 'methodology' | 'confounder' | 'implication' | 'limitation' | 'glossary',
  language: 'en' | 'es' | 'ja'
): JSONSchema {
  const schemaMap = {
    methodology: {
      en: methodologyAnalysisSchema_en,
      es: methodologyAnalysisSchema_es,
      ja: methodologyAnalysisSchema_ja,
    },
    confounder: {
      en: confounderAnalysisSchema_en,
      es: confounderAnalysisSchema_es,
      ja: confounderAnalysisSchema_ja,
    },
    implication: {
      en: implicationAnalysisSchema_en,
      es: implicationAnalysisSchema_es,
      ja: implicationAnalysisSchema_ja,
    },
    limitation: {
      en: limitationAnalysisSchema_en,
      es: limitationAnalysisSchema_es,
      ja: limitationAnalysisSchema_ja,
    },
    glossary: {
      en: glossarySchema_en,
      es: glossarySchema_es,
      ja: glossarySchema_ja,
    },
  };

  return schemaMap[schemaType][language];
}
