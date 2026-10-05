// Defined by vite.config.ts, and inlined wherever code uses it: the app's
// build id (AppInfo in model/bundle.ts). Its time is in index.html (site.ts).
declare const __BOXOPS_BUILD__: string;

interface Window {
  /** Set by the boot watchdog in index.html; main.tsx calls it once the app is running. */
  __boxopsBoot?(): void;
}
