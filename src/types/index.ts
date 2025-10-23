import { JSONSchema } from "../utils/typeToSchema";

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
  RESET_AI = 'RESET_AI',

  // IndexedDB operations (handled by background worker)
  STORE_PAPER_IN_DB = 'STORE_PAPER_IN_DB',
  GET_PAPER_FROM_DB_BY_URL = 'GET_PAPER_FROM_DB_BY_URL',
  IS_PAPER_STORED_IN_DB = 'IS_PAPER_STORED_IN_DB',
  GET_ALL_PAPERS_FROM_DB = 'GET_ALL_PAPERS_FROM_DB',
  DELETE_PAPER_FROM_DB = 'DELETE_PAPER_FROM_DB',

  // Legacy message types (deprecated - use _IN_DB versions)
  STORE_PAPER = 'STORE_PAPER',
  GET_STORED_PAPER = 'GET_STORED_PAPER',
  GET_ALL_PAPERS = 'GET_ALL_PAPERS',
  DELETE_PAPER = 'DELETE_PAPER',
  CHECK_PAPER_STORED = 'CHECK_PAPER_STORED',

  ANALYZE_PAPER = 'ANALYZE_PAPER',
  ASK_QUESTION = 'ASK_QUESTION',
  UPDATE_PAPER_QA_HISTORY = 'UPDATE_PAPER_QA_HISTORY',
  GENERATE_GLOSSARY = 'GENERATE_GLOSSARY',
  GLOSSARY_PROGRESS = 'GLOSSARY_PROGRESS',
  GENERATE_EMBEDDINGS = 'GENERATE_EMBEDDINGS',
  SEMANTIC_SEARCH = 'SEMANTIC_SEARCH',

  // Chatbox operations
  TOGGLE_CHATBOX = 'TOGGLE_CHATBOX',
  SEND_CHAT_MESSAGE = 'SEND_CHAT_MESSAGE',
  CHAT_STREAM_CHUNK = 'CHAT_STREAM_CHUNK',
  CHAT_STREAM_END = 'CHAT_STREAM_END',
  GET_CHAT_HISTORY = 'GET_CHAT_HISTORY',
  CLEAR_CHAT_HISTORY = 'CLEAR_CHAT_HISTORY',
  UPDATE_CHAT_HISTORY = 'UPDATE_CHAT_HISTORY',

  // Background operation state management
  GET_OPERATION_STATE = 'GET_OPERATION_STATE',
  GET_OPERATION_STATE_BY_PAPER = 'GET_OPERATION_STATE_BY_PAPER',
  START_DETECT_AND_EXPLAIN = 'START_DETECT_AND_EXPLAIN',
  OPERATION_STATE_CHANGED = 'OPERATION_STATE_CHANGED',
  PAPER_DELETED = 'PAPER_DELETED', // Broadcast when paper(s) deleted
  CHECK_SIDEPANEL_OPEN = 'CHECK_SIDEPANEL_OPEN',
  NAVIGATE_TO_PAPER = 'NAVIGATE_TO_PAPER',
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

  // Language metadata
  originalLanguage?: string; // Detected language of the paper (ISO 639-1 code)
  outputLanguage?: string; // User's chosen output language for generated content

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

export interface SummarizerCapabilities {
  available: boolean;
  availability: AIAvailability;
  model: string;
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
  generatedBy?: 'summarizer-api' | 'prompt-api'; // Track which API was used
}

// Chrome Prompt API types (Stable - Chrome 138+)
export interface AISessionOptions {
  temperature?: number;
  topK?: number;
  systemPrompt?: string;
  signal?: AbortSignal;
  expectedInputs?: Array<{ type: string; languages: string[] }>;
  expectedOutputs?: Array<{ type: string; languages: string[] }>;
}

export interface AILanguageModelSession {
  prompt: (input: string, options?: { responseConstraint?: JSONSchema }) => Promise<string>;
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

  // Chrome Summarizer API types (Chrome 138+)
  interface SummarizerOptions {
    type?: 'key-points' | 'tldr' | 'teaser' | 'headline';
    format?: 'markdown' | 'plain-text';
    length?: 'short' | 'medium' | 'long';
    sharedContext?: string;
    expectedInputLanguages?: string[];
    outputLanguage?: string;
    expectedContextLanguages?: string[];
    monitor?(m: EventTarget): void;
  }

  interface AISummarizer {
    summarize(text: string, options?: { context?: string }): Promise<string>;
    summarizeStreaming(text: string, options?: { context?: string }): AsyncIterable<string>;
    destroy(): void;
  }

  class Summarizer {
    static availability(): Promise<AIAvailability>;
    static create(options?: SummarizerOptions): Promise<AISummarizer>;
  }

  // Chrome Language Detector API types (Chrome 138+)
  interface LanguageDetectorResult {
    detectedLanguage: string; // ISO 639-1 language code
    confidence: number; // 0-1 confidence score
  }

  interface AILanguageDetector {
    detect(text: string): Promise<LanguageDetectorResult[]>;
    destroy(): void;
  }

  class LanguageDetector {
    static availability(): Promise<AIAvailability>;
    static create(): Promise<AILanguageDetector>;
  }
}

// Language types
export interface LanguageOption {
  code: string; // ISO 639-1 language code
  name: string; // English name
  nativeName: string; // Native language name
}

/**
 * Supported languages for AI-generated content
 *
 * NOTE: This list is limited by Chrome's Prompt API support.
 * As of Chrome 138+, only English, Spanish, and Japanese are supported.
 * More languages will be added as Chrome extends Prompt API language support.
 *
 * See: https://developer.chrome.com/docs/ai/built-in-apis
 */
export const SUPPORTED_LANGUAGES: LanguageOption[] = [
  { code: 'en', name: 'English', nativeName: 'English' },
  { code: 'es', name: 'Spanish', nativeName: 'Español' },
  { code: 'ja', name: 'Japanese', nativeName: '日本語' },
];

// Storage types
export interface ExtensionSettings {
  enableAutoDetect: boolean;
  defaultExplanationLevel: 'simple' | 'intermediate' | 'detailed';
  theme: 'light' | 'dark' | 'auto';
  outputLanguage?: string; // User's preferred output language (ISO 639-1 code)
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
  hierarchicalSummary?: string; // Compressed summary of entire paper (~2000 chars) for full document coverage
  qaHistory?: QuestionAnswer[]; // Q&A history for this paper
  chatHistory?: ChatMessage[]; // Chat conversation history for this paper
  explanation?: ExplanationResult; // Stored explanation for this paper
  summary?: SummaryResult; // Stored summary for this paper
  analysis?: PaperAnalysisResult; // Stored analysis for this paper
  glossary?: GlossaryResult; // Stored glossary for this paper
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
  embedding?: Float32Array; // Semantic embedding vector for RAG (256-768 dimensions)
  terms?: string[]; // Technical terms/acronyms extracted from this chunk by LLM (5-10 per chunk)
}

// Paper Analysis types
export interface MethodologyAnalysis {
  studyType: string;
  studyDesign: string;
  dataCollection: string;
  sampleSize: string;
  statisticalMethods: string;
  strengths: string[];
  concerns: string[];
}

export interface ConfounderAnalysis {
  identified: Array<{ name: string; explanation: string }>;
  biases: Array<{ name: string; explanation: string }>;
  controlMeasures: Array<{ name: string; explanation: string }>;
}

export interface ImplicationAnalysis {
  realWorldApplications: string[];
  significance: string;
  futureResearch: string[];
}

export interface LimitationAnalysis {
  studyLimitations: string[];
  generalizability: string;
}

export interface PaperAnalysisResult {
  methodology: MethodologyAnalysis;
  confounders: ConfounderAnalysis;
  implications: ImplicationAnalysis;
  limitations: LimitationAnalysis;
  timestamp: number;
}

// Glossary types
export interface StudyContext {
  context: string;        // The actual context description
  sections: string[];     // Array of section names/numbers where this applies
}

export interface GlossaryTerm {
  acronym: string;
  longForm: string;
  definition: string;
  studyContext: StudyContext[];  // Changed from string to StudyContext[]
  analogy: string;
}

export interface GlossaryResult {
  terms: GlossaryTerm[];
  timestamp: number;
}

// Q&A types
export interface QuestionAnswer {
  question: string;
  answer: string;
  sources: string[]; // Section names or chunk references
  timestamp: number;
}

export interface QAHistoryItem extends QuestionAnswer {
  paperId: string;
  paperTitle: string;
}

// Chat types
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  sources?: string[]; // Sources for assistant messages
}

export interface ChatboxPosition {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ChatboxSettings {
  position: ChatboxPosition;
  visible: boolean;
  minimized: boolean;
  transparencyEnabled: boolean;
}

// Background operation state (per-tab tracking)
export interface OperationState {
  tabId: number;
  isDetecting: boolean;
  isExplaining: boolean;
  isAnalyzing: boolean;
  isGeneratingGlossary: boolean;
  isChunking: boolean;  // Track if chunking is in progress
  currentPaper: ResearchPaper | null;
  isPaperStored: boolean;  // Track if the current paper is stored in DB
  error: string | null;
  detectionProgress: string;
  explanationProgress: string;
  analysisProgress: string;
  glossaryProgress: string;
  glossaryProgressStage: string | null;  // Current stage: 'extracting' | 'filtering-terms' | 'generating-definitions'
  currentGlossaryTerm: number;  // Current glossary term being processed
  totalGlossaryTerms: number;  // Total glossary terms to process
  chunkingProgress: string;  // Status message for chunking
  currentChunk: number;  // Current chunk being processed
  totalChunks: number;  // Total number of chunks to process
  lastUpdated: number;
  // Track active AI requests for this tab
  activeAIRequests: string[];
  // Track if operations are being deduplicated
  isUsingCachedRequest: boolean;
  // Track completion status of stored paper features
  hasExplanation: boolean;
  hasSummary: boolean;
  hasAnalysis: boolean;
  hasGlossary: boolean;
  hasDetected: boolean;  // Track if paper was successfully detected
  hasChunked: boolean;  // Track if chunking completed successfully
  completionPercentage: number; // 0-100, based on completed features
}
