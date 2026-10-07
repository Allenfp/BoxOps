// The licences a release ships for what it carries that isn't BoxOps' own
// code. The app's, dist/app/licenses.txt: Vite's build.license list of the
// packages the app bundles (React, react-dom, scheduler, yaml), then the
// icons Icon.tsx draws, which are Lucide's, some derived from Feather's: no
// package brings those in, so Vite can't list them. The command-line tool's,
// THIRD_PARTY_LICENSES.txt at the top of a release commit: Vite's list of
// the packages dist/boxops.mjs bundles (yaml). Node-only (the Vite configs).

import type { Plugin } from "vite";

/** Lucide's licence (https://lucide.dev, ISC) for the icons in src/components/Icon.tsx, and Feather's (MIT) for those derived from it. */
export const ICONS_NOTICE = `## Lucide icons (ISC; some derived from Feather, MIT)

The app's icons (src/components/Icon.tsx in BoxOps) are Lucide's
(https://lucide.dev), their SVG paths copied in: x, pencil, plus,
chevron-right, chevron-down, triangle-alert, arrow-up-right, undo-2, redo-2,
arrow-up, arrow-down, settings, grip-vertical and calendar. Of these, x,
plus, chevron-right, chevron-down, triangle-alert (alert-triangle),
arrow-up-right, arrow-up, arrow-down and calendar are derived from the
Feather project, under the MIT licence below.

ISC License

Copyright (c) 2026 Lucide Icons and Contributors

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

The MIT License (MIT) (for the icons derived from Feather)

Copyright (c) 2013-present Cole Bemis

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;

/** The opening line of the list Vite writes. */
const VITE_INTRO = "The app bundles dependencies which contain the following licenses:";

/**
 * The licence file Vite writes for a build (build.license's `fileName`), with
 * its opening line saying what bundles them (`bundler`, "The app" if not
 * given) and `append` added at its end. Fails the build if Vite wrote none.
 */
export function licenseFile(fileName: string, o: { bundler?: string; append?: string }): Plugin {
  return {
    name: "boxops-licenses",
    apply: "build",
    generateBundle: {
      // After Vite's own plugin has written the list.
      order: "post",
      handler(_, bundle) {
        const asset = bundle[fileName];
        if (asset?.type !== "asset") throw new Error(`${fileName}, the licences of what this build bundles, wasn’t written: is build.license on?`);
        let text = typeof asset.source === "string" ? asset.source : new TextDecoder().decode(asset.source);
        if (o.bundler) {
          if (!text.includes(VITE_INTRO)) throw new Error(`${fileName} doesn’t open as Vite’s list did (“${VITE_INTRO}”): see cli/licenses.ts`);
          text = text.replace(VITE_INTRO, () => VITE_INTRO.replace("The app", o.bundler as string));
        }
        if (o.append) text = `${text.trimEnd()}\n\n${o.append.trimEnd()}\n`;
        asset.source = text;
      },
    },
  };
}
