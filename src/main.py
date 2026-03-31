#!/usr/bin/env python3
"""BoxOps — Coverage Visualization Server.

Runs a local web server that reads config/processes.yaml and config/people.yaml
on every request, then serves a D3.js 2D visualization of stage coverage.
Edit YAML and refresh the browser to see changes instantly.
"""

import os

from server import start_server


def main() -> None:
    """Entry point for BoxOps."""
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    start_server(base_dir)


if __name__ == "__main__":
    main()
