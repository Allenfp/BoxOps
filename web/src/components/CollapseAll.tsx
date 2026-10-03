// "Collapse all / Expand all", shown next to the departments it acts on.

export function CollapseAll({ all, onToggle }: { all: boolean; onToggle(): void }) {
  return (
    <button className="collapse-all" onClick={onToggle}>
      {all ? "Expand all" : "Collapse all"}
    </button>
  );
}
