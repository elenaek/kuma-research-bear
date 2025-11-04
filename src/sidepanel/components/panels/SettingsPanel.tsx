import { SettingsTab } from '../SettingsTab.tsx';

/**
 * SettingsPanel - Top-level panel for settings view
 *
 * Displays extension settings and configuration options
 */
export function SettingsPanel() {
  return (
    <div class="tab-content">
      <SettingsTab />
    </div>
  );
}
