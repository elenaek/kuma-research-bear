import { useState } from 'preact/hooks';

interface UseOperationStateReturn {
  // State
  explainingPapers: Set<string>;
  summaryGeneratingPapers: Set<string>;
  analyzingPapers: Set<string>;
  glossaryGeneratingPapers: Set<string>;
  askingPapers: Set<string>;

  // Explaining operations
  addExplainingPaper: (paperUrl: string) => void;
  removeExplainingPaper: (paperUrl: string) => void;
  clearExplainingPaper: (paperUrl: string) => void;

  // Summary generating operations
  addSummaryGeneratingPaper: (paperUrl: string) => void;
  removeSummaryGeneratingPaper: (paperUrl: string) => void;
  clearSummaryGeneratingPaper: (paperUrl: string) => void;

  // Analyzing operations
  addAnalyzingPaper: (paperUrl: string) => void;
  removeAnalyzingPaper: (paperUrl: string) => void;
  clearAnalyzingPaper: (paperUrl: string) => void;

  // Glossary operations
  addGlossaryGeneratingPaper: (paperUrl: string) => void;
  removeGlossaryGeneratingPaper: (paperUrl: string) => void;
  clearGlossaryGeneratingPaper: (paperUrl: string) => void;

  // Q&A operations
  addAskingPaper: (paperUrl: string) => void;
  removeAskingPaper: (paperUrl: string) => void;
  clearAskingPaper: (paperUrl: string) => void;

  // Utility
  isExplaining: (paperUrl: string) => boolean;
  isGeneratingSummary: (paperUrl: string) => boolean;
  isAnalyzing: (paperUrl: string) => boolean;
  isGeneratingGlossary: (paperUrl: string) => boolean;
  isAsking: (paperUrl: string) => boolean;
}

/**
 * Custom hook to track operation states for multiple papers
 * Uses Sets to efficiently track which papers are currently being explained, summarized, analyzed, having glossaries generated, or having Q&A questions asked
 */
export function useOperationState(): UseOperationStateReturn {
  const [explainingPapers, setExplainingPapers] = useState<Set<string>>(new Set());
  const [summaryGeneratingPapers, setSummaryGeneratingPapers] = useState<Set<string>>(new Set());
  const [analyzingPapers, setAnalyzingPapers] = useState<Set<string>>(new Set());
  const [glossaryGeneratingPapers, setGlossaryGeneratingPapers] = useState<Set<string>>(new Set());
  const [askingPapers, setAskingPapers] = useState<Set<string>>(new Set());

  // Explaining operations
  function addExplainingPaper(paperUrl: string) {
    setExplainingPapers(prev => {
      const next = new Set(prev);
      next.add(paperUrl);
      return next;
    });
  }

  function removeExplainingPaper(paperUrl: string) {
    setExplainingPapers(prev => {
      const next = new Set(prev);
      next.delete(paperUrl);
      return next;
    });
  }

  function clearExplainingPaper(paperUrl: string) {
    removeExplainingPaper(paperUrl);
  }

  // Summary generating operations
  function addSummaryGeneratingPaper(paperUrl: string) {
    setSummaryGeneratingPapers(prev => {
      const next = new Set(prev);
      next.add(paperUrl);
      return next;
    });
  }

  function removeSummaryGeneratingPaper(paperUrl: string) {
    setSummaryGeneratingPapers(prev => {
      const next = new Set(prev);
      next.delete(paperUrl);
      return next;
    });
  }

  function clearSummaryGeneratingPaper(paperUrl: string) {
    removeSummaryGeneratingPaper(paperUrl);
  }

  // Analyzing operations
  function addAnalyzingPaper(paperUrl: string) {
    setAnalyzingPapers(prev => {
      const next = new Set(prev);
      next.add(paperUrl);
      return next;
    });
  }

  function removeAnalyzingPaper(paperUrl: string) {
    setAnalyzingPapers(prev => {
      const next = new Set(prev);
      next.delete(paperUrl);
      return next;
    });
  }

  function clearAnalyzingPaper(paperUrl: string) {
    removeAnalyzingPaper(paperUrl);
  }

  // Glossary operations
  function addGlossaryGeneratingPaper(paperUrl: string) {
    setGlossaryGeneratingPapers(prev => {
      const next = new Set(prev);
      next.add(paperUrl);
      return next;
    });
  }

  function removeGlossaryGeneratingPaper(paperUrl: string) {
    setGlossaryGeneratingPapers(prev => {
      const next = new Set(prev);
      next.delete(paperUrl);
      return next;
    });
  }

  function clearGlossaryGeneratingPaper(paperUrl: string) {
    removeGlossaryGeneratingPaper(paperUrl);
  }

  // Q&A operations
  function addAskingPaper(paperUrl: string) {
    setAskingPapers(prev => {
      const next = new Set(prev);
      next.add(paperUrl);
      return next;
    });
  }

  function removeAskingPaper(paperUrl: string) {
    setAskingPapers(prev => {
      const next = new Set(prev);
      next.delete(paperUrl);
      return next;
    });
  }

  function clearAskingPaper(paperUrl: string) {
    removeAskingPaper(paperUrl);
  }

  // Utility functions
  function isExplaining(paperUrl: string): boolean {
    return explainingPapers.has(paperUrl);
  }

  function isGeneratingSummary(paperUrl: string): boolean {
    return summaryGeneratingPapers.has(paperUrl);
  }

  function isAnalyzing(paperUrl: string): boolean {
    return analyzingPapers.has(paperUrl);
  }

  function isGeneratingGlossary(paperUrl: string): boolean {
    return glossaryGeneratingPapers.has(paperUrl);
  }

  function isAsking(paperUrl: string): boolean {
    return askingPapers.has(paperUrl);
  }

  return {
    explainingPapers,
    summaryGeneratingPapers,
    analyzingPapers,
    glossaryGeneratingPapers,
    askingPapers,
    addExplainingPaper,
    removeExplainingPaper,
    clearExplainingPaper,
    addSummaryGeneratingPaper,
    removeSummaryGeneratingPaper,
    clearSummaryGeneratingPaper,
    addAnalyzingPaper,
    removeAnalyzingPaper,
    clearAnalyzingPaper,
    addGlossaryGeneratingPaper,
    removeGlossaryGeneratingPaper,
    clearGlossaryGeneratingPaper,
    addAskingPaper,
    removeAskingPaper,
    clearAskingPaper,
    isExplaining,
    isGeneratingSummary,
    isAnalyzing,
    isGeneratingGlossary,
    isAsking,
  };
}
