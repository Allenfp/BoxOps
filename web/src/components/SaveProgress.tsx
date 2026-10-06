// What the toolbar says while a save runs: its step, with the seconds so far
// once it's slow. Part of saving's code (saving.ts): a save runs only once
// that's here.

import { useEffect, useState } from "react";
import { useAnnounce } from "../a11y/useAnnounce";
import type { SaveStep } from "../github/save";

const STEP_TEXT: Record<SaveStep, string> = {
  checking: "Checking for newer saves…",
  writing: "Writing the commit…",
  verifying: "Checking whether it went through…",
  retrying: "Trying again…",
};

/**
 * What a save is doing, with the seconds so far once it's slow: a save can
 * wait on GitHub for a minute or two. Only the step is announced, not every
 * second.
 */
export function SaveProgress({ step }: { step: SaveStep }) {
  useAnnounce(STEP_TEXT[step]);
  const [start] = useState(() => Date.now());
  const [now, setNow] = useState(start);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const seconds = Math.floor((now - start) / 1000);
  return (
    <span className="hint save-progress">
      <span>{STEP_TEXT[step]}</span>
      {seconds >= 5 ? ` ${seconds} s` : ""}
    </span>
  );
}

