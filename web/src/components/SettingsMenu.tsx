// The gear menu. The button is there from the first paint; what the menu
// holds (SettingsPanel.tsx) is fetched when the pointer or focus reaches it.

import { Suspense } from "react";
import { Icon } from "./Icon";
import { lazyPart } from "./lazyPart";
import { Popover } from "./Popover";
import type { SettingsProps } from "./SettingsPanel";

const SettingsPanel = lazyPart(() => import("./SettingsPanel").then((m) => m.SettingsPanel));

export function SettingsMenu(props: SettingsProps) {
  return (
    <Popover
      className="settings-menu"
      label="Settings"
      buttonClass="icon-only"
      button={<Icon name="settings" size={16} />}
      onIntent={SettingsPanel.preload}
    >
      {(close) => (
        <Suspense fallback={<p className="hint menu-note">Loading…</p>}>
          <SettingsPanel {...props} close={close} />
        </Suspense>
      )}
    </Popover>
  );
}
