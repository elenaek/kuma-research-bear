/**
 * TabPaperTracker Service
 *
 * Tracks which tabs currently have which papers open.
 * This prevents cross-tab message leakage by ensuring updates
 * are sent to ALL tabs showing a paper, not just the active tab.
 */

import { StoredPaper } from '../../types/paper';

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

    // Register new associations
    this.tabToPaper.set(tabId, paper.url);
    this.paperIdToUrl.set(paper.id, paper.url);

    if (!this.paperToTabs.has(paper.url)) {
      this.paperToTabs.set(paper.url, new Set());
    }
    this.paperToTabs.get(paper.url)!.add(tabId);

    console.log(`[TabPaperTracker] Registered tab ${tabId} -> paper ${paper.url}`);
    console.log(`[TabPaperTracker] Paper ${paper.url} now in tabs:`, Array.from(this.paperToTabs.get(paper.url)!));
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
    const tabSet = this.paperToTabs.get(paperUrl);
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
    return this.tabToPaper.get(tabId) === paperUrl;
  }

  /**
   * Get count of tabs viewing a specific paper
   */
  getTabCountForPaper(paperUrl: string): number {
    return this.paperToTabs.get(paperUrl)?.size || 0;
  }

  /**
   * Check if any tabs are viewing a specific paper
   */
  hasPaper(paperUrl: string): boolean {
    return this.getTabCountForPaper(paperUrl) > 0;
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
}

// Export singleton instance
export const tabPaperTracker = new TabPaperTracker();
