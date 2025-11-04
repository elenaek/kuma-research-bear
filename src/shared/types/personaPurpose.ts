// Persona and Purpose types for adaptive AI behavior
export type Persona = 'professional' | 'student';
export type Purpose = 'writing' | 'learning';

export interface PersonaPurposeConfig {
  temperature: number;
  topK: number;
  promptModifiers: {
    tone: string; // Tone instruction for the AI
    approach: string; // Overall approach instruction
    focus: string; // Primary focus area
  };
}

/**
 * Configuration map for persona + purpose combinations
 *
 * Professional + Writing: Formal, precise, citation-ready (temp: 0.3, topK: 3)
 * Professional + Learning: Clear, efficient, assumes knowledge (temp: 0.5, topK: 5)
 * Student + Writing: Accessible, structured, guided (temp: 0.4, topK: 5)
 * Student + Learning: Beginner-friendly, exploratory, encouraging (temp: 0.7, topK: 8)
 */
export const PERSONA_PURPOSE_CONFIGS: Record<Persona, Record<Purpose, PersonaPurposeConfig>> = {
  professional: {
    writing: {
      temperature: 0.3,
      topK: 3,
      promptModifiers: {
        tone: 'formal and precise',
        approach: 'direct and technical',
        focus: 'accuracy and citation-readiness',
      },
    },
    learning: {
      temperature: 0.5,
      topK: 5,
      promptModifiers: {
        tone: 'clear and efficient',
        approach: 'comprehensive with assumed prior knowledge',
        focus: 'depth and connections',
      },
    },
  },
  student: {
    writing: {
      temperature: 0.4,
      topK: 5,
      promptModifiers: {
        tone: 'accessible and supportive',
        approach: 'structured with guidance',
        focus: 'clarity and examples',
      },
    },
    learning: {
      temperature: 0.7,
      topK: 8,
      promptModifiers: {
        tone: 'friendly and encouraging',
        approach: 'exploratory with analogies',
        focus: 'understanding and engagement',
      },
    },
  },
};
