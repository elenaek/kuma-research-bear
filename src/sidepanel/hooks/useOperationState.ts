import { useState } from 'preact/hooks';

interface UseOperationStateReturn {
  // State
  analyzingPapers: Set<string>;
  glossaryGeneratingPapers: Set<string>;

  // Analyzing operations
  addAnalyzingPaper: (paperUrl: string) => void;
  removeAnalyzingPaper: (paperUrl: string) => void;
  clearAnalyzingPaper: (paperUrl: string) => void;

  // Glossary operations
  addGlossaryGeneratingPaper: (paperUrl: string) => void;
  removeGlossaryGeneratingPaper: (paperUrl: string) => void;
  clearGlossaryGeneratingPaper: (paperUrl: string) => void;

  // Utility
  isAnalyzing: (paperUrl: string) => boolean;
  isGeneratingGlossary: (paperUrl: string) => boolean;
}

/**
 * Custom hook to track operation states for multiple papers
 * Uses Sets to efficiently track which papers are currently being analyzed or having glossaries generated
 */
export function useOperationState(): UseOperationStateReturn {
  const [analyzingPapers, setAnalyzingPapers] = useState<Set<string>>(new Set());
  const [glossaryGeneratingPapers, setGlossaryGeneratingPapers] = useState<Set<string>>(new Set());

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

  // Utility functions
  function isAnalyzing(paperUrl: string): boolean {
    return analyzingPapers.has(paperUrl);
  }

  function isGeneratingGlossary(paperUrl: string): boolean {
    return glossaryGeneratingPapers.has(paperUrl);
  }

  return {
    analyzingPapers,
    glossaryGeneratingPapers,
    addAnalyzingPaper,
    removeAnalyzingPaper,
    clearAnalyzingPaper,
    addGlossaryGeneratingPaper,
    removeGlossaryGeneratingPaper,
    clearGlossaryGeneratingPaper,
    isAnalyzing,
    isGeneratingGlossary,
  };
}
