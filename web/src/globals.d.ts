// Defined by vite.config.ts, and inlined wherever code uses them: the app's
// build id and time (AppInfo in model/bundle.ts).
declare const __BOXOPS_BUILD__: string;
declare const __BOXOPS_BUILD_TIME__: string;

interface Window {
  /** Set by the boot watchdog in index.html; main.tsx calls it once the app is running. */
  __boxopsBoot?(): void;
}
