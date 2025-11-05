/**
 * AI Core Module Exports
 *
 * This file provides centralized exports for the refactored AI service components.
 * The original aiService.ts now acts as a facade that delegates to these modular classes.
 */

// Core classes
export { AISessionManager } from './core/AISessionManager.ts';
export { PromptExecutor } from './core/PromptExecutor.ts';

// Services
export { JSONRepairService } from './services/JSONRepairService.ts';
export { ConversationManager } from './services/ConversationManager.ts';
export { LanguageService } from './services/LanguageService.ts';

// Orchestrators
export { HierarchicalSummarizationOrchestrator } from './orchestrators/HierarchicalSummarizationOrchestrator.ts';
export { AnalysisOrchestrator } from './orchestrators/AnalysisOrchestrator.ts';
export { GlossaryOrchestrator } from './orchestrators/GlossaryOrchestrator.ts';

// Strategies
export {
  BaseAIStrategy,
  ExplanationStrategy,
  SummaryStrategy,
  MetadataExtractionStrategy,
  QAStrategy,
  ImageExplanationStrategy
} from './strategies/index.ts';

// Types
export type { PromptTimeoutConfig, PromptExecutionOptions } from './core/PromptExecutor.ts';
export type { HierarchicalSummaryResult } from './orchestrators/HierarchicalSummarizationOrchestrator.ts';
export type { AnalysisType } from './orchestrators/AnalysisOrchestrator.ts';
