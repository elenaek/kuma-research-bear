/**
 * TabPaperTracker Service
 *
 * Tracks which tabs currently have which papers open.
 * This prevents cross-tab message leakage by ensuring updates
 * are sent to ALL tabs showing a paper, not just the active tab.
 */

import { StoredPaper } from '../../types/paper';
import { normalizeUrl } from '../../utils/urlUtils.ts';

class TabPaperTracker {
  // Map: tabId -> paper URL
  private tabToPaper: Map<number, string> = new Map();

  // Map: paper URL -> Set of tabIds
  private paperToTabs: Map<string, Set<number>> = new Map();

  // Map: paper ID -> paper URL (for lookup by ID)
  private paperIdToUrl: Map<string, string> = new Map();

  /**
   * Register that a tab is viewing a specific paper
   */
  registerPaper(tabId: number, paper: StoredPaper): void {
    // Remove old paper association for this tab if it exists
    this.unregisterTab(tabId);

    // Normalize URL for consistent tracking
    const normalizedUrl = normalizeUrl(paper.url);

    // Register new associations
    this.tabToPaper.set(tabId, normalizedUrl);
    this.paperIdToUrl.set(paper.id, normalizedUrl);

    if (!this.paperToTabs.has(normalizedUrl)) {
      this.paperToTabs.set(normalizedUrl, new Set());
    }
    this.paperToTabs.get(normalizedUrl)!.add(tabId);

    console.log(`[TabPaperTracker] Registered tab ${tabId} -> paper ${normalizedUrl}`);
    console.log(`[TabPaperTracker] Paper ${normalizedUrl} now in tabs:`, Array.from(this.paperToTabs.get(normalizedUrl)!));
  }

  /**
   * Unregister a tab (when it closes or navigates away)
   */
  unregisterTab(tabId: number): void {
    const paperUrl = this.tabToPaper.get(tabId);
    if (!paperUrl) return;

    // Remove from paper -> tabs mapping
    const tabSet = this.paperToTabs.get(paperUrl);
    if (tabSet) {
      tabSet.delete(tabId);
      if (tabSet.size === 0) {
        this.paperToTabs.delete(paperUrl);
        console.log(`[TabPaperTracker] No more tabs viewing paper ${paperUrl}`);
      }
    }

    // Remove from tab -> paper mapping
    this.tabToPaper.delete(tabId);

    console.log(`[TabPaperTracker] Unregistered tab ${tabId}`);
  }

  /**
   * Get all tabs currently viewing a specific paper URL
   */
  getTabsForPaperUrl(paperUrl: string): number[] {
    const normalizedUrl = normalizeUrl(paperUrl);
    const tabSet = this.paperToTabs.get(normalizedUrl);
    return tabSet ? Array.from(tabSet) : [];
  }

  /**
   * Get all tabs currently viewing a specific paper ID
   */
  getTabsForPaperId(paperId: string): number[] {
    const paperUrl = this.paperIdToUrl.get(paperId);
    return paperUrl ? this.getTabsForPaperUrl(paperUrl) : [];
  }

  /**
   * Get the paper URL for a specific tab
   */
  getPaperForTab(tabId: number): string | undefined {
    return this.tabToPaper.get(tabId);
  }

  /**
   * Check if a tab is currently viewing a specific paper
   */
  isTabViewingPaper(tabId: number, paperUrl: string): boolean {
    const normalizedUrl = normalizeUrl(paperUrl);
    return this.tabToPaper.get(tabId) === normalizedUrl;
  }

  /**
   * Get count of tabs viewing a specific paper
   */
  getTabCountForPaper(paperUrl: string): number {
    const normalizedUrl = normalizeUrl(paperUrl);
    return this.paperToTabs.get(normalizedUrl)?.size || 0;
  }

  /**
   * Check if any tabs are viewing a specific paper
   */
  hasPaper(paperUrl: string): boolean {
    const normalizedUrl = normalizeUrl(paperUrl);
    return this.getTabCountForPaper(normalizedUrl) > 0;
  }

  /**
   * Get all tracked tabs (for debugging)
   */
  getAllTrackedTabs(): number[] {
    return Array.from(this.tabToPaper.keys());
  }

  /**
   * Clear all tracking data (for testing/cleanup)
   */
  clear(): void {
    this.tabToPaper.clear();
    this.paperToTabs.clear();
    this.paperIdToUrl.clear();
  }

  /**
   * Clear a paper from all tabs (used when deleting a paper)
   * Removes all tab associations for a specific paper URL
   */
  clearPaperFromAllTabs(paperUrl: string): number {
    const normalizedUrl = normalizeUrl(paperUrl);
    const tabSet = this.paperToTabs.get(normalizedUrl);

    if (!tabSet) {
      console.log(`[TabPaperTracker] No tabs viewing paper ${normalizedUrl}`);
      return 0;
    }

    const tabIds = Array.from(tabSet);

    // Remove all tab -> paper mappings
    for (const tabId of tabIds) {
      this.tabToPaper.delete(tabId);
    }

    // Remove paper -> tabs mapping
    this.paperToTabs.delete(normalizedUrl);

    console.log(`[TabPaperTracker] Cleared paper ${normalizedUrl} from ${tabIds.length} tab(s):`, tabIds);
    return tabIds.length;
  }

  /**
   * Remove paper ID mapping (used when deleting a paper)
   */
  removePaperIdMapping(paperId: string): boolean {
    const existed = this.paperIdToUrl.has(paperId);
    if (existed) {
      const paperUrl = this.paperIdToUrl.get(paperId);
      this.paperIdToUrl.delete(paperId);
      console.log(`[TabPaperTracker] Removed paper ID mapping: ${paperId} -> ${paperUrl}`);
    }
    return existed;
  }
}

// Export singleton instance
export const tabPaperTracker = new TabPaperTracker();
