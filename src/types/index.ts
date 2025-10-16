// Message types for communication between extension components
export enum MessageType {
  DETECT_PAPER = 'DETECT_PAPER',
  EXPLAIN_PAPER = 'EXPLAIN_PAPER',
  EXPLAIN_SECTION = 'EXPLAIN_SECTION',
  EXPLAIN_TERM = 'EXPLAIN_TERM',
  GENERATE_SUMMARY = 'GENERATE_SUMMARY',
  OPEN_SIDEPANEL = 'OPEN_SIDEPANEL',
  AI_STATUS = 'AI_STATUS',
}

export interface Message {
  type: MessageType;
  payload?: any;
}

// Paper structure
export interface ResearchPaper {
  title: string;
  authors: string[];
  abstract: string;
  url: string;
  source: 'arxiv' | 'pubmed' | 'biorxiv' | 'scholar' | 'ssrn' | 'other';
  sections?: PaperSection[];
  metadata?: {
    publishDate?: string;
    doi?: string;
    arxivId?: string;
    pdfUrl?: string;
  };
}

export interface PaperSection {
  title: string;
  content: string;
  level: number;
}

// AI-related types
export interface AICapabilities {
  available: boolean;
  model?: string;
  canCreateSession: boolean;
  defaultTemperature?: number;
  defaultTopK?: number;
  maxTopK?: number;
}

export interface ExplanationResult {
  originalText: string;
  explanation: string;
  timestamp: number;
}

export interface SummaryResult {
  summary: string;
  keyPoints: string[];
  timestamp: number;
}

// Chrome AI API types (experimental)
declare global {
  interface Window {
    ai?: {
      languageModel?: {
        capabilities: () => Promise<AICapabilities>;
        create: (options?: AISessionOptions) => Promise<AILanguageModel>;
      };
    };
  }
}

export interface AISessionOptions {
  temperature?: number;
  topK?: number;
  systemPrompt?: string;
}

export interface AILanguageModel {
  prompt: (input: string) => Promise<string>;
  promptStreaming: (input: string) => ReadableStream;
  destroy: () => void;
}

// Storage types
export interface ExtensionSettings {
  enableAutoDetect: boolean;
  defaultExplanationLevel: 'simple' | 'intermediate' | 'detailed';
  theme: 'light' | 'dark' | 'auto';
}

export interface SavedExplanation {
  paperId: string;
  paperTitle: string;
  explanation: ExplanationResult;
}
