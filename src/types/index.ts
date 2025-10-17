// Message types for communication between extension components
export enum MessageType {
  DETECT_PAPER = 'DETECT_PAPER',
  EXPLAIN_PAPER = 'EXPLAIN_PAPER',
  EXPLAIN_SECTION = 'EXPLAIN_SECTION',
  EXPLAIN_TERM = 'EXPLAIN_TERM',
  GENERATE_SUMMARY = 'GENERATE_SUMMARY',
  OPEN_SIDEPANEL = 'OPEN_SIDEPANEL',
  AI_STATUS = 'AI_STATUS',
  INITIALIZE_AI = 'INITIALIZE_AI',
  STORE_PAPER = 'STORE_PAPER',
  GET_STORED_PAPER = 'GET_STORED_PAPER',
  GET_ALL_PAPERS = 'GET_ALL_PAPERS',
  DELETE_PAPER = 'DELETE_PAPER',
  CHECK_PAPER_STORED = 'CHECK_PAPER_STORED',
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
  source: 'arxiv' | 'pubmed' | 'biorxiv' | 'scholar' | 'ssrn' | 'ai-extracted' | 'other';
  sections?: PaperSection[];
  metadata?: PaperMetadata;
}

// Enhanced metadata for papers
export interface PaperMetadata {
  // Publication info
  publishDate?: string;
  journal?: string;
  venue?: string; // Conference or journal name

  // Identifiers
  doi?: string;
  arxivId?: string;
  pmid?: string; // PubMed ID
  pmcid?: string; // PubMed Central ID

  // Links
  pdfUrl?: string;
  htmlUrl?: string;

  // Additional metadata
  keywords?: string[];
  citations?: number;

  // AI extraction metadata
  extractionMethod?: 'manual' | 'schema.org' | 'site-specific' | 'ai';
  extractionTimestamp?: number;
  confidence?: number; // 0-1 confidence score for AI extractions
}

export interface PaperSection {
  title: string;
  content: string;
  level: number;
}

// AI-related types
// Official Chrome Prompt API availability states: https://developer.chrome.com/docs/ai/get-started#model_download
export type AIAvailability = 'available' | 'downloadable' | 'downloading' | 'unavailable' | 'no';

export interface AICapabilities {
  available: boolean;
  availability: AIAvailability;
  model: string;
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

// Chrome Prompt API types (Stable - Chrome 138+)
export interface AISessionOptions {
  temperature?: number;
  topK?: number;
  systemPrompt?: string;
  signal?: AbortSignal;
}

export interface AILanguageModelSession {
  prompt: (input: string) => Promise<string>;
  promptStreaming: (input: string) => ReadableStream;
  destroy: () => void;
}

export interface AILanguageModelParams {
  temperature: { default: number; min: number; max: number };
  topK: { default: number; min: number; max: number };
}

// Global type declarations for Chrome Prompt API
declare global {
  class LanguageModel {
    static availability(): Promise<AIAvailability>;
    static params(): Promise<AILanguageModelParams>;
    static create(options?: AISessionOptions): Promise<AILanguageModelSession>;
  }
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

// IndexedDB Storage types
export interface StoredPaper extends ResearchPaper {
  id: string; // URL hash or unique ID
  fullText: string; // Complete extracted text
  chunkCount: number;
  storedAt: number;
  lastAccessedAt: number;
}

export interface ContentChunk {
  id: string; // chunk_paperID_index
  paperId: string;
  content: string;
  index: number; // Position in paper
  section?: string; // Section heading if available
  startChar: number;
  endChar: number;
  tokenCount: number;
  embedding?: number[]; // Future: for semantic search
}
