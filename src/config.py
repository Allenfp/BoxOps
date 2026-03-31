"""Configuration loading and data building for BoxOps."""

import os
from typing import Any

import yaml


def load_config(base_dir: str) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Load processes and people from YAML config files."""
    config_dir = os.path.join(base_dir, "config")

    with open(os.path.join(config_dir, "processes.yaml"), "r") as f:
        processes_data = yaml.safe_load(f)

    with open(os.path.join(config_dir, "people.yaml"), "r") as f:
        people_data = yaml.safe_load(f)

    return processes_data["processes"], people_data["people"]


def build_process_data(
    processes: list[dict[str, Any]],
    people: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Build visualization data for each process."""
    all_processes: list[dict[str, Any]] = []

    for process in processes:
        proc_name: str = process["name"]
        stages: list[dict[str, Any]] = process["stages"]
        stage_ids = [s["id"] for s in stages]
        coverage: dict[str, list[dict[str, str]]] = {sid: [] for sid in stage_ids}

        for person in people:
            for proc in person.get("processes", []):
                if proc["name"] == proc_name:
                    for stage_entry in proc.get("stages", []):
                        if isinstance(stage_entry, str):
                            stage_id = stage_entry
                            contributor_level = "Contributor"
                        else:
                            stage_id = stage_entry["id"]
                            contributor_level = stage_entry.get(
                                "contributor_level", "Contributor"
                            )
                        if stage_id in coverage:
                            coverage[stage_id].append(
                                {
                                    "name": person["name"],
                                    "flight_risk": person.get("flight_risk", "low"),
                                    "contributor_level": contributor_level,
                                }
                            )

        vis_stages: list[dict[str, Any]] = []
        for s in stages:
            sid = s["id"]
            vis_stages.append(
                {
                    "id": sid,
                    "name": s.get("display_name", sid),
                    "people": coverage[sid],
                    "count": len(coverage[sid]),
                    "doc_coverage": s.get("documentation_coverage", 0),
                    "complexity": s.get("complexity", 0),
                    "on_call": s.get("on_call", False),
                }
            )

        all_processes.append(
            {
                "name": proc_name,
                "stages": vis_stages,
            }
        )

    return all_processes
