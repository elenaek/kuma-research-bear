import { h } from 'preact';
import { ChatTab } from '../../../shared/types/index.ts';

interface TabBarProps {
  tabs: ChatTab[];
  activeTabId: string;
  isDragging: boolean;
  onSwitchTab: (tabId: string) => void;
  handleDragStart: (e: MouseEvent) => void;
  handleTabMouseDown: (e: MouseEvent) => void;
  handleTabMouseUp: () => void;
  handleTabCloseClick: (tabId: string, e: Event) => void;
}

/**
 * Tab bar component for multi-tab chatbox navigation
 * Supports tab switching, dragging, and closing image tabs
 */
export const TabBar = ({
  tabs,
  activeTabId,
  isDragging,
  onSwitchTab,
  handleDragStart,
  handleTabMouseDown,
  handleTabMouseUp,
  handleTabCloseClick,
}: TabBarProps) => {
  // Only show tab bar if multiple tabs exist
  if (tabs.length <= 1) {
    return null;
  }

  return (
    <div
      class="chatbox-tab-bar"
      onMouseDown={handleDragStart}
      style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
    >
      <div class="chatbox-tabs">
        {tabs.map(tab => (
          <div
            key={tab.id}
            class={`chatbox-tab ${tab.id === activeTabId ? 'chatbox-tab-active' : ''}`}
            onClick={() => onSwitchTab(tab.id)}
            onMouseDown={(e) => handleTabMouseDown(e as any)}
            onMouseUp={handleTabMouseUp}
            onMouseLeave={handleTabMouseUp}
          >
            <span class="chatbox-tab-title">{tab.title}</span>
            {tab.type === 'image' && (
              <button
                class="chatbox-tab-close"
                onClick={(e) => handleTabCloseClick(tab.id, e)}
                title="Close tab"
                aria-label="Close tab"
              >
                ×
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
