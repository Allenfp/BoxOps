import type { Locator, Page } from "@playwright/test";
import { CDC, DAGSTER, box, boxFile, dragDays, expect, save, test } from "./helpers";
import type { FakeGitHub } from "./fake-github";

// What the stylesheet (src/styles/) must keep doing, checked from computed
// styles rather than screenshots: rules a broader selector used to override,
// layouts that mustn't clip or overflow, and colours that must stay readable.

/** These computed style properties of `el`. */
const css = (el: Locator, ...props: string[]) =>
  el.evaluate((e, ps) => Object.fromEntries(ps.map((p) => [p, getComputedStyle(e).getPropertyValue(p)])), props);

test("the box editor's title is its own: big and borderless, a field only when pointed at or focused", async ({ page, github: _ }) => {
  await box(page, DAGSTER).click();
  const editor = page.getByRole("dialog", { name: /^Edit / });
  const title = editor.getByRole("textbox", { name: "Title", exact: true });
  const start = editor.getByRole("textbox", { name: "Start", exact: true });
  await start.focus();
  const { "border-top-color": focused } = await css(start, "border-top-color");
  expect(await css(title, "font-size", "font-weight", "border-top-color", "background-color")).toEqual({
    "font-size": "16px",
    "font-weight": "600",
    "border-top-color": "rgba(0, 0, 0, 0)",
    "background-color": "rgba(0, 0, 0, 0)",
  });
  // Focused, it has the ring every field has.
  await title.focus();
  expect(await css(title, "border-top-color", "outline-style")).toEqual({ "border-top-color": focused, "outline-style": "solid" });
});

test("the box editor's selects (FTE, Lane, Type, Flag) are as tall as its text and date fields", async ({ page, github: _ }) => {
  await box(page, DAGSTER).click();
  const editor = page.getByRole("dialog", { name: /^Edit / });
  const height = (l: Locator) => l.evaluate((e) => e.getBoundingClientRect().height);
  const field = await height(editor.getByRole("textbox", { name: "Start" }));
  expect(await height(editor.getByRole("textbox", { name: "Epic link" }))).toBe(field);
  for (const name of ["FTE", "Lane", "Type", "Flag"]) expect(await height(editor.getByLabel(name, { exact: true })), name).toBe(field);
});

test("the pre-save check lists others' saves in the text column, bullets too, as the token form lists what to check; its link out underlines only its words", async ({ page, github }) => {
  const left = (l: Locator) => l.evaluate((e) => e.getBoundingClientRect().left);
  await dragDays(page, DAGSTER, 10);
  github.otherSave({ [boxFile(CDC)]: (t) => t.replace("CDC pipeline for orders DB", "CDC v2") }, "Sam Lee", "CDC pipeline: renamed");
  await save(page);
  const check = page.locator(".save-dialog[open]");
  const saves = check.locator(".save-list");
  await expect(saves).toBeVisible();
  const lead = await left(check.locator(".lead").first());
  const [list, item] = [await left(saves), await left(saves.locator("li").first())];
  expect(list).toBe(lead); // the bullets are in the column, not left of it
  await check.getByRole("button", { name: "Review changes" }).click();
  // Signed out, the token form's list.
  await page.evaluate(() => sessionStorage.clear());
  await save(page);
  const help = page.locator(".save-dialog[open] .token-help");
  await expect(help).toBeVisible();
  const [text, tokenList, tokenItem] = [await left(help), await left(help.locator("ul")), await left(help.locator("ul li").first())];
  expect(tokenList).toBe(text);
  expect(item - list).toBe(tokenItem - tokenList);

  // Its link out underlines its words, not the gap before its ↗, nor the ↗.
  const link = help.getByRole("link", { name: "Create a fine-grained token for acme/roadmap" });
  expect(await link.evaluate((a) => [...a.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE && n.textContent!.trim() === "" && n.textContent !== "").length)).toBe(0);
  expect(await link.evaluate((a) => getComputedStyle(a).textDecorationLine)).toBe("none");
  expect(await link.locator("span").evaluate((s) => getComputedStyle(s).textDecorationLine)).toBe("underline");
  const [words, icon] = [(await link.locator("span").boundingBox())!, (await link.locator("svg").boundingBox())!];
  expect(icon.x).toBeGreaterThan(words.x + words.width);
});

test("the Engineers list's names are list items, not the editor's field labels", async ({ page, github: _ }) => {
  await box(page, DAGSTER).click();
  await page.getByRole("dialog", { name: /^Edit / }).getByRole("button", { name: /^Engineers/ }).click();
  const option = page.getByRole("dialog", { name: "Engineers" }).locator(".picker-option").first();
  expect(await css(option, "flex-direction", "font-size", "font-weight")).toEqual({
    "flex-direction": "row",
    "font-size": "13px",
    "font-weight": "400",
  });
});

test("the Engineers list open in a table cell looks as it does in the box editor: its field's hint shows, Add is faded", async ({ page, github: _ }) => {
  const list = page.getByRole("dialog", { name: "Engineers" });
  /** How the list's new-name field (and its hint) and its Add button (nothing typed) look, the pointer away; and the field focused. */
  const looks = async () => {
    await expect(list).toBeVisible();
    await page.mouse.move(1, 600);
    const field = list.getByRole("textbox", { name: "New engineer name" });
    const props = ["border-top-color", "background-color", "outline-style", "outline-color"];
    const looks = {
      field: await css(field, ...props),
      hint: await field.evaluate((e) => getComputedStyle(e, "::placeholder").color),
      add: await css(list.getByRole("button", { name: "Add", exact: true }), "opacity"),
    };
    const tick = list.getByRole("checkbox").first();
    await tick.focus();
    const ticked = await css(tick, "outline-style", "outline-color");
    await field.focus();
    return { ...looks, focused: await css(field, ...props), ticked };
  };
  await box(page, DAGSTER).click();
  await page.getByRole("dialog", { name: /^Edit / }).getByRole("button", { name: /^Engineers/ }).click();
  const editor = await looks();
  expect(editor.add.opacity).not.toBe("1");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Table", exact: true }).click();
  await page.locator(".box-table tr.box-row").first().getByRole("button", { name: /^Engineers/ }).click();
  expect(await looks()).toEqual(editor);
});

test("the Engineers list isn't cut off by the box editor's scrolling fields: the last name and the add field show", async ({ page, github: _ }) => {
  await box(page, DAGSTER).click();
  await page.getByRole("dialog", { name: /^Edit / }).getByRole("button", { name: /^Engineers/ }).click();
  const list = page.getByRole("dialog", { name: "Engineers" });
  for (const el of [list.getByRole("checkbox").last(), list.getByRole("textbox", { name: "New engineer name" })]) {
    // What's drawn at its middle is itself, not what's around a box that clips it.
    expect(
      await el.evaluate((e) => {
        const r = e.getBoundingClientRect();
        return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === e && r.bottom <= innerHeight;
      }),
    ).toBe(true);
  }
});

test("a date's calendar open in a table cell looks as it does in the box editor, not like the table's cells", async ({ page, github: _ }) => {
  const calendar = page.getByRole("dialog", { name: "Choose date" });
  /** How the calendar's weekday headings and a Monday (the first cell of a row) look. */
  const looks = async () => {
    await expect(calendar).toBeVisible();
    const props = ["position", "height", "background-color", "border-left-width", "border-bottom-width", "vertical-align"];
    const monday = calendar.locator("tbody tr").nth(1).locator("td").first();
    return { heading: await css(calendar.locator("th").first(), ...props), monday: await css(monday, ...props) };
  };
  await box(page, DAGSTER).click();
  await page.getByRole("dialog", { name: /^Edit / }).getByRole("button", { name: "Choose date" }).first().click();
  const editor = await looks();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Table", exact: true }).click();
  // The same box's start, so the same month and the same day picked.
  const dagster = page.locator("tbody tr").filter({ has: page.locator('input[aria-label="Title"][value="Dagster 2.x upgrade"]') });
  await dagster.getByRole("textbox", { name: "Start" }).focus();
  await page.keyboard.press("Alt+ArrowDown");
  expect(await looks()).toEqual(editor);
});

test("team settings: colour swatches fill their 28px button, and names read as fields, not labels", async ({ page, github: _ }) => {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Team settings…" }).click();
  const dialog = page.getByRole("dialog", { name: "Team settings" });
  expect(await css(dialog.getByLabel("Project colour"), "width", "padding-left", "padding-top")).toEqual({
    width: "28px",
    "padding-left": "2px",
    "padding-top": "2px",
  });
  expect(await css(dialog.getByLabel("Type 1 name"), "font-size", "font-weight")).toEqual({ "font-size": "13px", "font-weight": "400" });
});

test("the department editor's own colour is a field like team settings' colours, filled by its swatch", async ({ page, github: _ }) => {
  await page.getByRole("button", { name: "Edit Analytics" }).click();
  const custom = page.getByRole("dialog", { name: "Edit Analytics" }).getByLabel("Custom colour");
  expect(await css(custom, "width", "height", "padding-left")).toEqual({ width: "28px", height: "28px", "padding-left": "2px" });
});

test("a table cell that won't do stays red while it's pointed at or focused, as a date field does", async ({ page, github: _ }) => {
  await page.getByRole("button", { name: "Table", exact: true }).click();
  const title = page.locator(".box-table tr.box-row").first().getByRole("textbox", { name: "Title" });
  await title.fill("");
  await expect(title).toHaveAttribute("aria-invalid", "true");
  const red = await page.evaluate(() => {
    const probe = document.body.appendChild(document.createElement("span"));
    probe.style.color = "var(--danger)";
    const c = getComputedStyle(probe).color;
    probe.remove();
    return c;
  });
  const edge = async () => (await css(title, "border-top-color"))["border-top-color"];
  // Focused (to put it right), pointed at too, then pointed at with focus gone.
  expect(await edge()).toBe(red);
  await title.hover();
  expect(await edge()).toBe(red);
  await page.getByRole("searchbox", { name: "Search boxes" }).focus();
  await title.hover();
  expect(await edge()).toBe(red);
});

test("a dialog dims the page behind it in either theme, where a backdrop inherits no custom properties too", async ({ page, github: _ }) => {
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await expect(page.locator("html")).toHaveAttribute("data-theme", colorScheme);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "Keyboard shortcuts…" }).click();
    const dialog = page.getByRole("dialog", { name: "Keyboard shortcuts" });
    await expect(dialog).toBeVisible();
    const backdrop = () => dialog.evaluate((d) => getComputedStyle(d, "::backdrop").backgroundColor);
    const dim = await backdrop();
    expect(dim, colorScheme).not.toBe("rgba(0, 0, 0, 0)");
    // As Safari before 17.4, Chrome before 122 and Firefox before 120 have it: no --backdrop on the backdrop.
    await page.evaluate(() => document.documentElement.style.setProperty("--backdrop", "initial"));
    expect(await backdrop(), colorScheme).toBe(dim);
    await page.evaluate(() => document.documentElement.style.removeProperty("--backdrop"));
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  }
});

test("the table's and People's column headers are shown whole, none running under the next", async ({ page, github: _ }) => {
  for (const view of ["Table", "People"]) {
    await page.getByRole("button", { name: view, exact: true }).click();
    const main = page.getByRole("main", { name: view });
    await expect(main.locator("tbody tr").first()).toBeVisible();
    const cut = await main.locator("thead th").evaluateAll((ths) => ths.filter((th) => th.scrollWidth > th.clientWidth).map((th) => th.textContent));
    expect(cut, view).toEqual([]);
  }
});

test("a warning longer than the warnings menu wraps, read in full rather than cut off", async ({ page, github: _ }) => {
  await page.getByRole("button", { name: /^\d+ warnings?$/ }).click();
  const panel = page.getByRole("dialog", { name: /^\d+ warnings?$/ });
  await expect(panel.locator(".link-button").first()).toBeVisible();
  expect(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
});

test("a menu open as the window's made smaller is kept inside it", async ({ page, github: _ }) => {
  await page.getByRole("button", { name: /^\d+ warnings?$/ }).click();
  const panel = page.getByRole("dialog", { name: /^\d+ warnings?$/ });
  await expect(panel.locator(".link-button").first()).toBeVisible();
  await page.setViewportSize({ width: 320, height: 400 });
  const inside = () =>
    panel.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;
    });
  await expect.poll(inside).toBe(true);
});

test("in a high-contrast theme, what only colour showed stays: the chosen view, Today (across boxes too), progress, switches, the picked day", async ({ page, browserName, github: _ }) => {
  test.skip(browserName !== "chromium", "only Chromium emulates Windows' contrast themes (forced colours)");
  await page.emulateMedia({ forcedColors: "active" });
  const views = page.getByRole("group", { name: "View" });
  const bg = async (el: Locator, pseudo?: string) => el.evaluate((e, p) => getComputedStyle(e, p).backgroundColor, pseudo);
  expect(await bg(views.getByRole("button", { name: "Timeline" }))).not.toEqual(await bg(views.getByRole("button", { name: "Table" })));
  expect(await bg(page.locator(".today-line"))).not.toEqual(await bg(page.locator(".timeline")));
  // So does its stretch across a box, under the box's text, which keeps the box's own colour round it.
  expect(await bg(box(page, DAGSTER), "::before")).toEqual(await bg(page.locator(".today-line")));
  expect(await bg(box(page, DAGSTER).locator(".box-title"))).toEqual(await bg(box(page, DAGSTER)));
  // A lane's name shows no edge (a short row's would be cut off) until it's pointed at.
  const lane = page.locator(".lane-name").first();
  expect((await css(lane, "border-top-color"))["border-top-color"]).toEqual(await bg(page.locator(".timeline")));
  await lane.hover();
  expect((await css(lane, "border-top-color"))["border-top-color"]).not.toEqual(await bg(page.locator(".timeline")));
  // Dagster is under way: half its ring is filled.
  expect(await css(box(page, DAGSTER).locator(".status-mark"), "background-image")).toEqual({
    "background-image": expect.stringContaining("linear-gradient"),
  });

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const on = page.locator(".settings-menu .toggle input:checked").first();
  const off = page.locator(".settings-menu .toggle input:not(:checked)").first();
  expect(await css(off, "border-top-style", "border-top-width")).toEqual({ "border-top-style": "solid", "border-top-width": "1px" });
  expect(await bg(on)).not.toEqual(await bg(off));
  expect(await bg(on, "::after")).not.toEqual(await bg(off, "::after"));
  await page.keyboard.press("Escape");

  await box(page, DAGSTER).click();
  await page.getByRole("dialog", { name: /^Edit / }).getByRole("button", { name: "Choose date" }).first().click();
  const calendar = page.getByRole("dialog", { name: "Choose date" });
  expect(await bg(calendar.locator(".calendar-day.selected"))).not.toEqual(await bg(calendar.locator(".calendar-day:not(.selected, .weekend)").first()));
});

/** Open a branch preview: the timeline read-only. */
async function preview(page: Page, github: FakeGitHub) {
  const main = github.head;
  github.branches.feature = github.otherSave({ [boxFile(CDC)]: (t) => t.replace("CDC pipeline for orders DB", "CDC pipeline v2") });
  github.head = main;
  await page.goto("./?ref=feature&zoom=months");
  await expect(page.getByRole("grid", { name: "Timeline" })).toHaveAttribute("aria-readonly", "true");
}
/** The pointer away, each lane's +, PTO row's + and department's ✎ is there (for focus), disabled, and doesn't show. */
async function addsHidden(page: Page) {
  await page.mouse.move(1300, 850);
  for (const add of [".lane-add", ".pto-add", ".dept-edit"]) {
    await expect(page.locator(add).first()).toHaveAttribute("aria-disabled", "true");
    await expect(page.locator(add).first()).toHaveCSS("opacity", "0");
  }
}

test("while a save is under way, the +s and ✎s don't show, the pointer away", async ({ page, github }) => {
  await dragDays(page, DAGSTER, 5);
  github.inject("graphql", "hang");
  await save(page);
  await expect(page.getByRole("button", { name: "Saving…" })).toBeVisible();
  await addsHidden(page);
});

test("in a preview, a + or a department's ✎ shows only when pointed at or focused, and dimmed", async ({ page, github }) => {
  await preview(page, github);
  await addsHidden(page);
  const lane = page.locator(".lane-label", { has: page.locator(".lane-add") }).first();
  await lane.hover();
  await expect(lane.locator(".lane-add")).toHaveCSS("opacity", "0.4");
  const dept = page.locator(".dept-label").first();
  await dept.hover();
  await expect(dept.locator(".dept-edit")).toHaveCSS("opacity", "0.4");
  // Focused from the keyboard, the same.
  await page.locator('[data-cell="lane:de-1"]').focus();
  await page.keyboard.press("ArrowRight");
  await page.mouse.move(1300, 850);
  await expect(page.locator(".lane-add").first()).toBeFocused();
  await expect(page.locator(".lane-add").first()).toHaveCSS("opacity", "0.4");
});

test.describe("with less motion asked for", () => {
  test.use({ reducedMotion: "reduce" });

  test("nothing slides: switches and chevrons change at once, and Today is a jump, not a scroll", async ({ page, github: _ }) => {
    expect(await css(page.locator(".chevron").first(), "transition-duration")).toEqual({ "transition-duration": "0s" });
    const timeline = page.locator(".timeline");
    await timeline.evaluate((el) => {
      el.scrollLeft = 0;
      (window as { seen?: number[] }).seen = [];
      el.addEventListener("scroll", () => (window as { seen?: number[] }).seen!.push(el.scrollLeft));
    });
    await page.getByRole("button", { name: "Today", exact: true }).click();
    await expect.poll(() => timeline.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
    await page.waitForTimeout(500);
    // A smooth scroll passes through many places on the way (0 is the scroll to the start, above).
    const seen = await page.evaluate(() => (window as { seen?: number[] }).seen!);
    expect(new Set(seen.filter((x) => x > 0)).size).toBe(1);
  });
});

// Only the views' own scrollers scroll (the timeline, the table, People), never the page: a page that scrolls
// too pans the toolbar away, sideways or up, leaving a blank strip. Small and narrow windows, and a roadmap
// taller than the window, in each view.
for (const [width, height] of [
  [320, 640],
  [810, 1080],
  [1440, 500],
]) {
  test.describe(`at ${width} by ${height} px`, () => {
    test.use({ viewport: { width, height } });

    test("the page itself never scrolls, in any view", async ({ page, github: _ }) => {
      for (const view of ["Timeline", "Table", "People"]) {
        await page.getByRole("button", { name: view, exact: true }).click();
        await expect(page.getByRole("main", { name: view }).locator(".timeline, tbody tr").first()).toBeVisible();
        const past = await page.evaluate(() => {
          const { scrollWidth, scrollHeight } = document.documentElement;
          return { across: scrollWidth - innerWidth, down: scrollHeight - innerHeight };
        });
        expect(past, view).toEqual({ across: 0, down: 0 });
      }
    });
  });
}

test.describe("at 1280 px wide", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("a long roadmap title is cut short (whole in its tooltip), and Save and the gear stay on screen", async ({ page, github: _ }) => {
    const title = "Enterprise Data Platform Engineering Roadmap 2026–2027";
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "Team settings…" }).click();
    await page.getByLabel("Roadmap title").fill(title);
    await page.keyboard.press("Escape");
    const h1 = page.getByRole("heading", { level: 1 });
    await expect(h1).toHaveText(title);
    await expect(h1).toHaveAttribute("title", title);
    expect(await h1.evaluate((e) => e.scrollWidth > e.clientWidth)).toBe(true);
    await expect(page.getByRole("button", { name: "Save · 1 change" })).toBeInViewport({ ratio: 1 });
    await expect(page.getByRole("button", { name: "Settings", exact: true })).toBeInViewport({ ratio: 1 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
});

test.describe("at 320 px wide (a phone, or a window zoomed to 400%)", () => {
  test.use({ viewport: { width: 320, height: 640 } });

  test("nothing runs off the side: the toolbar wraps, and the box editor is as wide as the window", async ({ page, github: _ }) => {
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    for (const name of ["People", "Quarters", "Today", "Undo", "Settings"]) {
      await expect(page.getByRole("button", { name, exact: true })).toBeInViewport({ ratio: 1 });
    }
    await box(page, DAGSTER).focus();
    await page.keyboard.press("Enter");
    const editor = page.getByRole("dialog", { name: /^Edit / });
    await expect(editor).toBeInViewport({ ratio: 1 });
    expect(await editor.locator(".editor-body").evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
  });

  test("the broken-rule popup leaves room as tall as it is to scroll clear of it, while it shows", async ({ page, github: _ }) => {
    await box(page, DAGSTER).focus();
    await page.keyboard.press("Enter");
    const editor = page.getByRole("dialog", { name: /^Edit / });
    await editor.getByRole("button", { name: "Rule", exact: true }).click();
    await editor.getByLabel("New rule").selectOption("after");
    await editor.getByLabel("Add a rule with").selectOption("C4P");
    await page.keyboard.press("Escape");
    const toast = page.locator(".toast");
    await expect(toast).toBeVisible();
    /** How far the popup reaches up from the window's bottom, and the room `scroller` leaves below its rows. */
    const room = (scroller: string) =>
      page.evaluate((sel) => {
        const top = document.querySelector(".toast")?.getBoundingClientRect().top;
        return { popup: top === undefined ? 0 : Math.ceil(innerHeight - top), room: parseFloat(getComputedStyle(document.querySelector(sel)!).paddingBottom) };
      }, scroller);
    const timeline = await room(".tl-canvas");
    expect(timeline.popup).toBeGreaterThan(100);
    expect(timeline.room).toBe(timeline.popup);
    await page.getByRole("button", { name: "Table", exact: true }).click();
    await expect(page.locator(".box-table tbody tr").first()).toBeVisible();
    const table = await room(".table-scroll");
    expect(table.room).toBe(table.popup);
    await toast.getByRole("button", { name: "Dismiss" }).click();
    await expect(toast).toHaveCount(0);
    expect(await room(".table-scroll")).toEqual({ popup: 0, room: 0 });
  });

  /** What in `el` (the element itself included) reaches past the window's or `el`'s sides, or scrolls sideways. */
  const sticksOut = (el: Locator) =>
    el.evaluate((e) => {
      const { left, right } = e.getBoundingClientRect();
      const name = (c: Element) => `${c.tagName} ${c.getAttribute("aria-label") ?? c.textContent!.trim().slice(0, 20)}`;
      return [
        ...(left < 0 || right > innerWidth ? [`${name(e)} is past the window's side`] : []),
        ...[e, ...e.querySelectorAll(".editor-body")].filter((c) => c.scrollWidth > c.clientWidth).map((c) => `${name(c)} scrolls sideways`),
        ...[...e.querySelectorAll("*")]
          .filter((c) => {
            if (c instanceof SVGElement) return false; // an icon's button is named instead
            const r = c.getBoundingClientRect();
            return r.width > 0 && (r.left < left - 0.5 || r.right > right + 0.5);
          })
          .map((c) => `${name(c)} is past the dialog's side`),
      ];
    });

  const parts: [string, (page: Page) => Promise<Locator>][] = [
    [
      "the department editor (with a lane's dates set)",
      async (page) => {
        await page.getByRole("button", { name: "Edit Data Engineering" }).click();
        const dialog = page.getByRole("dialog", { name: "Edit Data Engineering" });
        await dialog.getByRole("button", { name: "From (set when lane 4 opens)" }).click();
        await dialog.getByRole("button", { name: "Until (set when lane 4 closes)" }).click();
        await expect(dialog.getByLabel("Until (lane 4 closes)")).toBeVisible();
        return dialog;
      },
    ],
    [
      "the PTO editor",
      async (page) => {
        await page.getByRole("button", { name: "Add PTO in Data Engineering" }).click();
        return page.getByRole("dialog", { name: /^Edit PTO/ });
      },
    ],
    [
      "team settings",
      async (page) => {
        await page.getByRole("button", { name: "Settings", exact: true }).click();
        await page.getByRole("button", { name: "Team settings…" }).click();
        return page.getByRole("dialog", { name: "Team settings" });
      },
    ],
  ];
  for (const [name, open] of parts) {
    test(`${name} fits across it, wrapping rather than running off the side`, async ({ page, github: _ }) => {
      const dialog = await open(page);
      await expect(dialog).toBeVisible();
      expect(await sticksOut(dialog)).toEqual([]);
    });
  }

  test("the table's dates fit across it with a date set (Clear dates showing) and a problem under To", async ({ page, github: _ }) => {
    await page.getByRole("button", { name: "Table", exact: true }).click();
    await expect(page.locator(".box-table tbody tr").first()).toBeVisible();
    const dates = page.getByRole("group", { name: "Dates" });
    /** How far the page reaches past the window's side. */
    const past = () => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    await dates.getByRole("textbox", { name: "From date" }).fill("2026-10-05");
    await expect(dates.getByRole("button", { name: "Clear dates" })).toBeInViewport({ ratio: 1 });
    expect(await past()).toBe(0);
    await dates.getByRole("textbox", { name: "To date" }).fill("2026/01");
    const problem = dates.locator(".date-problem");
    await expect(problem).toHaveText("Dates are written YYYY-MM-DD.");
    await expect(problem).toBeInViewport({ ratio: 1 });
    expect(await past()).toBe(0);
  });

  test("the keyboard shortcuts fit across it, wrapping Windows' and Linux's longer Ctrl+… keys", async ({ page, github: _ }) => {
    // The app writes keys for the platform the browser reports, read as it starts.
    await page.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, "platform", { get: () => "Win32" });
      Object.defineProperty(Navigator.prototype, "userAgentData", { get: () => ({ platform: "Windows" }) });
    });
    await page.reload();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "Keyboard shortcuts…" }).click();
    const dialog = page.getByRole("dialog", { name: "Keyboard shortcuts" });
    await expect(dialog.getByRole("table", { name: "On the timeline" })).toContainText("Home, End  or  Ctrl+← Ctrl+→");
    expect(await sticksOut(dialog)).toEqual([]);
    // Inside the list's own margins too, not just the dialog's sides.
    const wide = await dialog.locator(".shortcuts").evaluate((list) => {
      const { left, right } = list.getBoundingClientRect();
      return [...list.querySelectorAll("table")]
        .filter((t) => t.getBoundingClientRect().left < left - 0.5 || t.getBoundingClientRect().right > right + 0.5)
        .map((t) => t.caption!.textContent);
    });
    expect(wide).toEqual([]);
  });

  test.describe("signed out", () => {
    test.use({ signedIn: false });

    test("the save dialog fits across it", async ({ page, github: _ }) => {
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await page.getByRole("button", { name: "Team settings…" }).click();
      await page.getByLabel("Roadmap title").fill("Platform Roadmap");
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "Save · 1 change" }).click();
      const dialog = page.getByRole("dialog", { name: "Connect to GitHub to save" });
      await expect(dialog).toBeVisible();
      expect(await sticksOut(dialog)).toEqual([]);
    });
  });
});

test.describe("at 1024 px wide", () => {
  test.use({ viewport: { width: 1024, height: 768 } });

  test("People's names stay put while the table scrolls sideways", async ({ page, github: _ }) => {
    await page.getByRole("button", { name: "People", exact: true }).click();
    const scroller = page.locator(".table-scroll");
    const name = page.locator(".people-table td.col-name").first();
    const x = (await name.boundingBox())!.x;
    await scroller.evaluate((el) => (el.scrollLeft = el.scrollWidth));
    expect(await scroller.evaluate((el) => el.scrollLeft)).toBeGreaterThan(300);
    expect((await name.boundingBox())!.x).toBe(x);
  });
});

test.describe("on a touch screen", () => {
  test.use({ hasTouch: true, isMobile: true });

  test("what otherwise shows only on hover is always there: ✎, +, a row's Delete, a date's calendar button", async ({ page, browserName, github: _ }) => {
    test.skip(browserName === "firefox", "Firefox can't emulate a screen without hover");
    expect(await css(page.locator(".dept-edit").first(), "opacity")).toEqual({ opacity: "1" });
    expect(await css(page.locator(".pto-add").first(), "opacity")).toEqual({ opacity: "1" });
    expect(await css(page.locator(".lane-name .edit-icon").first(), "opacity")).toEqual({ opacity: "1" });
    await page.getByRole("button", { name: "Table", exact: true }).click();
    await expect(page.locator(".box-table")).toBeVisible();
    expect(await css(page.locator(".row-delete").first(), "opacity")).toEqual({ opacity: "1" });
    expect(await css(page.locator(".box-table .date-pick").first(), "opacity")).toEqual({ opacity: "0.75" });
  });

  test("read-only, the +s and ✎s are there too, dimmed", async ({ page, browserName, github }) => {
    test.skip(browserName === "firefox", "Firefox can't emulate a screen without hover");
    await preview(page, github);
    for (const add of [".lane-add", ".pto-add", ".dept-edit"]) expect(await css(page.locator(add).first(), "opacity")).toEqual({ opacity: "0.4" });
  });
});

/**
 * Controls on screen too small for WCAG 2.5.8 (24 by 24 px) and too close to another: a 24 px circle round
 * their middle reaches another control (where it shows: not one under a panel) or another small one's circle.
 * A box's resize handles, a collapsed department's compact boxes, and the timeline's half-FTE boxes and PTO
 * blocks are small by design (docs/architecture.md), and aren't looked at: the handles aren't controls the query
 * finds, and the others are left out.
 */
async function crowded(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const on = (el: Element, x: number, y: number) => {
      const top = document.elementFromPoint(x, y);
      return !!top && (el.contains(top) || top.contains(el));
    };
    const controls = [...document.querySelectorAll<HTMLElement>("button, a[href], input, select, textarea, [tabindex], [data-cell]")].filter((el) => {
      if (el.matches(".box.compact, .box.half, .pto-block")) return false;
      const r = el.getBoundingClientRect();
      return r.width > 1 && r.height > 1 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth && on(el, r.x + r.width / 2, r.y + r.height / 2);
    });
    const rects = controls.map((el) => el.getBoundingClientRect());
    const centre = (r: DOMRect) => [r.x + r.width / 2, r.y + r.height / 2];
    const small = (r: DOMRect) => r.width < 24 || r.height < 24;
    const name = (el: Element) => el.getAttribute("aria-label") || el.textContent!.trim().slice(0, 30) || el.className;
    return controls.flatMap((el, i) => {
      if (!small(rects[i])) return [];
      const [cx, cy] = centre(rects[i]);
      const near = controls.filter((other, j) => {
        if (i === j || el.contains(other) || other.contains(el)) return false;
        const q = rects[j];
        const [x, y] = [Math.min(Math.max(cx, q.left), q.right - 0.5), Math.min(Math.max(cy, q.top), q.bottom - 0.5)];
        if (Math.hypot(x - cx, y - cy) < 12 && on(other, x, y)) return true;
        const [ox, oy] = centre(q);
        return small(q) && Math.hypot(ox - cx, oy - cy) < 24;
      });
      return near.length ? [`${name(el)} (${Math.round(rects[i].width)}×${Math.round(rects[i].height)}) is close to ${near.map(name).join(", ")}`] : [];
    });
  });
}

/** Morgan books three weeks off (People lists one, then "+2 more") and Priya two, the first while Morgan is off (stacked on the timeline). */
async function bookPto(page: Page, github: FakeGitHub) {
  const pto = (...weeks: [string, string][]) => `    pto:\n${weeks.map(([start, end]) => `      - start: ${start}\n        end: ${end}\n`).join("")}`;
  github.deploy(
    github.otherSave({
      "people.yaml": (t) =>
        t
          .replace("    name: Morgan Chen\n    department: analytics\n", (m) => m + pto(["2026-10-05", "2026-10-09"], ["2026-10-19", "2026-10-23"], ["2026-11-02", "2026-11-06"]))
          .replace("    name: Priya Shah\n    department: analytics\n", (m) => m + pto(["2026-10-07", "2026-10-14"], ["2026-10-26", "2026-10-30"])),
    }),
  );
  await page.reload();
  await expect(page.locator(".pto-block")).toHaveCount(5);
}

test("every control is 24 px or has room round it (WCAG 2.5.8), in each view, editor, dialog and menu", async ({ page, github }) => {
  await bookPto(page, github);
  expect(await crowded(page)).toEqual([]);
  await box(page, DAGSTER).click();
  const editor = page.getByRole("dialog", { name: /^Edit / });
  await expect(editor).toBeVisible();
  expect(await crowded(page)).toEqual([]);
  // With its Engineers list open, then a date's calendar.
  await editor.getByRole("button", { name: /^Engineers/ }).click();
  await expect(page.getByRole("dialog", { name: "Engineers" }).getByRole("checkbox").first()).toBeVisible();
  expect(await crowded(page)).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Engineers" })).toHaveCount(0);
  await editor.getByRole("button", { name: "Choose date" }).first().click();
  await expect(page.getByRole("dialog", { name: "Choose date" })).toBeVisible();
  expect(await crowded(page)).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Choose date" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(editor).toHaveCount(0);
  await page.locator(".pto-block").first().click();
  await expect(page.getByRole("dialog", { name: /^Edit PTO/ })).toBeVisible();
  expect(await crowded(page)).toEqual([]);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /^\d+ warnings?$/ }).click();
  await expect(page.getByRole("dialog", { name: /warning/ })).toBeVisible();
  expect(await crowded(page)).toEqual([]);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Edit Analytics" }).click();
  const dept = page.getByRole("dialog", { name: "Edit Analytics" });
  await expect(dept.getByRole("button", { name: "Add lane" })).toBeVisible();
  expect(await crowded(page)).toEqual([]);
  await dept.getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("button", { name: "Team settings…" })).toBeVisible();
  expect(await crowded(page)).toEqual([]);
  await page.getByRole("button", { name: "Team settings…" }).click();
  await expect(page.getByRole("dialog", { name: "Team settings" }).getByRole("button", { name: "Add type" })).toBeVisible();
  expect(await crowded(page)).toEqual([]);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Keyboard shortcuts…" }).click();
  await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
  expect(await crowded(page)).toEqual([]);
  await page.keyboard.press("Escape");
  for (const view of ["Table", "People"]) {
    await page.getByRole("button", { name: view, exact: true }).click();
    await expect(page.getByRole("main", { name: view }).locator("tbody tr").first()).toBeVisible();
    expect(await crowded(page)).toEqual([]);
  }
  // Each of a person's PTO entries, Priya's two and Morgan's one with "+2 more", and then all of Morgan's.
  await expect(page.locator(".pto-list button")).toHaveCount(4);
  await page.getByRole("button", { name: "+2 more PTO for Morgan Chen" }).click();
  await expect(page.locator(".pto-list button")).toHaveCount(6);
  expect(await crowded(page)).toEqual([]);
});

test("People's PTO keeps to its column: its dates whole, a long note cut short with … (a word or so showing), whole in its tooltip", async ({ page, github }) => {
  const note = "Parental leave, then a conference in Lisbon";
  github.deploy(
    github.otherSave({
      "people.yaml": (t) => t.replace("    name: Priya Shah\n    department: analytics\n", (m) => `${m}    pto:\n      - start: 2026-12-01\n        end: 2026-12-04\n        note: ${note}\n`),
    }),
  );
  await page.reload();
  await page.getByRole("button", { name: "People", exact: true }).click();
  const cell = page.locator("tr.person-row", { has: page.locator('input[value="Priya Shah"]') }).locator("td.col-pto");
  await expect(cell.locator(".pto-list li")).toHaveCount(1);
  const fits = await cell.evaluate((td) => {
    const right = td.getBoundingClientRect().right;
    return [...td.querySelectorAll("li, li > *")].every((el) => el.getBoundingClientRect().right <= right + 0.5);
  });
  expect(fits).toBe(true);
  const hint = cell.locator(".hint");
  await expect(hint).toHaveAttribute("title", note);
  expect(await hint.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true); // cut short
  // But a word or so of it shows, beside the dates, not just "· …".
  expect(await hint.evaluate((el) => el.clientWidth)).toBeGreaterThanOrEqual(60);
  await expect(cell.getByRole("button", { name: "2026-12-01 – 2026-12-04" })).toBeVisible();
  expect(await cell.locator("li").textContent()).toMatch(/^2026-12-01 – 2026-12-04\s·\s/);
});

test("People's rows take one line, or two with PTO past one entry (as a box row does), each kind one height, in either density", async ({
  page,
  github,
}) => {
  await bookPto(page, github);
  await page.getByRole("button", { name: "People", exact: true }).click();
  const rows = page.locator("tr.person-row");
  await expect(rows.first()).toBeVisible();
  /** Each row's height, by name; then the heights of the one-line rows and of the two-line ones. */
  const heights = async () => {
    const all = await rows.evaluateAll((rs) =>
      rs.map((r) => ({ name: (r.querySelector('input[aria-label="Name"]') as HTMLInputElement).value, height: r.getBoundingClientRect().height })),
    );
    const of = (names: string[], two: boolean) => [...new Set(all.filter((r) => names.includes(r.name) === two).map((r) => r.height))];
    return { one: of(["Morgan Chen", "Priya Shah"], false), two: of(["Morgan Chen", "Priya Shah"], true) };
  };
  const comfortable = await heights();
  expect(comfortable.one).toHaveLength(1);
  expect(comfortable.two).toHaveLength(1);
  expect(comfortable.one[0]).toBeLessThan(comfortable.two[0] - 15);
  // A two-line row is as tall as a box row in the table.
  const boxRow = async () => {
    await page.getByRole("button", { name: "Table", exact: true }).click();
    const h = await page.locator("tr.box-row").first().evaluate((r) => r.getBoundingClientRect().height);
    await page.getByRole("button", { name: "People", exact: true }).click();
    await expect(rows.first()).toBeVisible();
    return h;
  };
  expect(comfortable.two[0]).toBe(await boxRow());
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("dialog", { name: "Settings" }).getByRole("group", { name: "Density" }).getByRole("button", { name: "Compact" }).click();
  await page.keyboard.press("Escape");
  await expect.poll(async () => (await heights()).two[0]).toBeLessThan(comfortable.two[0]);
  const compact = await heights();
  expect(compact.one).toHaveLength(1);
  expect(compact.two).toHaveLength(1);
  expect(compact.one[0]).toBeLessThan(comfortable.one[0]);
  expect(compact.two[0]).toBe(await boxRow());
});
