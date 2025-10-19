import { BookOpen, Loader } from 'lucide-preact';
import { GlossaryResult } from '../../types/index.ts';
import { GlossaryList } from '../../components/GlossaryCard.tsx';

interface GlossarySectionProps {
  glossary: GlossaryResult | null;
  isGenerating: boolean;
}

/**
 * Glossary Section Component
 * Displays glossary of terms for the paper
 */
export function GlossarySection(props: GlossarySectionProps) {
  const { glossary, isGenerating } = props;

  // Show glossary if available
  if (glossary) {
    return (
      <div class="card">
        <GlossaryList terms={glossary.terms} />
      </div>
    );
  }

  // Loading state
  if (isGenerating) {
    return (
      <div class="card">
        <div class="text-center py-8">
          <Loader size={32} class="text-blue-600 mx-auto mb-3 animate-spin" />
          <p class="text-gray-600">Generating glossary of terms...</p>
        </div>
      </div>
    );
  }

  // No glossary yet
  return (
    <div class="card">
      <div class="text-center py-8">
        <BookOpen size={48} class="text-gray-300 mx-auto mb-4" />
        <p class="text-gray-500 mb-2">No glossary available yet</p>
        <p class="text-sm text-gray-400">
          The glossary will be generated when the paper is stored
        </p>
      </div>
    </div>
  );
}
