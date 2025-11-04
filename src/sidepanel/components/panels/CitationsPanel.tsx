import { CitationsSection } from '../CitationsSection.tsx';

/**
 * CitationsPanel - Top-level panel for citations view
 *
 * Displays all citations across all papers in the database
 */
export function CitationsPanel() {
  return (
    <div class="tab-content space-y-4">
      <CitationsSection />
    </div>
  );
}
