"""HTTP server for BoxOps."""

import json
import os
from http.server import HTTPServer, SimpleHTTPRequestHandler
from typing import Any

import yaml

from config import build_process_data, load_config
from template import generate_html

BASE_DIR: str = ""


class BoxOpsHandler(SimpleHTTPRequestHandler):
    """HTTP handler that regenerates HTML from YAML on every request."""

    def do_GET(self) -> None:
        if self.path == "/" or self.path == "/index.html":
            try:
                processes, people = load_config(BASE_DIR)
                all_processes = build_process_data(processes, people)
                html = generate_html(all_processes, people, processes)
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header(
                    "Cache-Control", "no-cache, no-store, must-revalidate"
                )
                self.end_headers()
                self.wfile.write(html.encode("utf-8"))
            except Exception as e:
                self.send_response(500)
                self.send_header("Content-Type", "text/plain")
                self.end_headers()
                self.wfile.write(f"Error: {e}".encode("utf-8"))
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self) -> None:
        if self.path == "/api/processes":
            try:
                length = int(self.headers.get("Content-Length", 0))
                body = self.rfile.read(length)
                processes_data: list[dict[str, Any]] = json.loads(body)
                processes_path = os.path.join(
                    BASE_DIR, "config", "processes.yaml"
                )
                with open(processes_path, "w") as f:
                    yaml.dump(
                        {"processes": processes_data},
                        f,
                        default_flow_style=False,
                        sort_keys=False,
                        allow_unicode=True,
                    )
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"ok": True}).encode("utf-8"))
            except Exception as e:
                self.send_response(500)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(
                    json.dumps({"error": str(e)}).encode("utf-8")
                )
        elif self.path == "/api/people":
            try:
                length = int(self.headers.get("Content-Length", 0))
                body = self.rfile.read(length)
                people_data: list[dict[str, Any]] = json.loads(body)
                people_path = os.path.join(BASE_DIR, "config", "people.yaml")
                with open(people_path, "w") as f:
                    yaml.dump(
                        {"people": people_data},
                        f,
                        default_flow_style=False,
                        sort_keys=False,
                        allow_unicode=True,
                    )
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"ok": True}).encode("utf-8"))
            except Exception as e:
                self.send_response(500)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(
                    json.dumps({"error": str(e)}).encode("utf-8")
                )
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format: str, *args: Any) -> None:
        print(f"[boxops] {args[0]}")


def start_server(base_dir: str, port: int = 8765) -> None:
    """Start the BoxOps HTTP server."""
    global BASE_DIR
    BASE_DIR = base_dir

    server = HTTPServer(("localhost", port), BoxOpsHandler)
    print(f"BoxOps running at http://localhost:{port}")
    print("Edit YAML configs and refresh the browser to see changes.")
    print("Press Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down.")
        server.server_close()
