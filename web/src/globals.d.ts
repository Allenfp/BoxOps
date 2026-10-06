// Defined by vite.config.ts, and inlined wherever code uses it: the app's
// build id (AppInfo in model/bundle.ts). Its time is in index.html (site.ts).
declare const __BOXOPS_BUILD__: string;

interface Window {
  /** Set by the boot watchdog in index.html; main.tsx calls it once the app is running. */
  __boxopsBoot?(): void;
  /**
   * Set by browser tests before the app starts. `cull`: the timeline draws
   * only what's near the screen whatever the roadmap's size (false: all of
   * it, always).
   */
  __boxopsTest?: { cull?: boolean };
}
