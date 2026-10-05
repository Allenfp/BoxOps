// Which files in a roadmap folder are roadmap files. One rule for the loader,
// the build, the command-line tools and (later) the app's reader from GitHub,
// so they all read the same files and report the same ones as unexpected.

/** departments/<id>.yaml, also .yml; never a hidden name or a subfolder. */
export const DEPARTMENT_PATH = /^departments\/[^./][^/]*\.ya?ml$/;
/** boxes/<id>.yaml, also .yml; never a hidden name or a subfolder. */
export const BOX_PATH = /^boxes\/[^./][^/]*\.ya?ml$/;

/** A file the loader reads (path relative to the roadmap folder, "/"-separated). Readers skip every other file. */
export function isRoadmapPath(path: string): boolean {
  return path === "settings.yaml" || path === "people.yaml" || DEPARTMENT_PATH.test(path) || BOX_PATH.test(path);
}

/**
 * A path with a part starting with "." (.DS_Store, .gitkeep, an editor's lock
 * file): readers skip it without a word. Every other file that isn't a roadmap
 * file is reported as unexpected.
 */
export function isHiddenPath(path: string): boolean {
  return path.split("/").some((name) => name.startsWith("."));
}
