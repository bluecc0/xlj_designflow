"""
Serves the penpot MCP plugin dist files at http://localhost:4400
with CORS headers so penpot (port 9001) can load the plugin.
"""
import http.server
import os
import sys

PORT = 4400
DIST_DIR = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "penpot", "mcp", "packages", "plugin", "dist"
)


class CORSHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIST_DIR, **kwargs)

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def log_message(self, fmt, *args):
        # Suppress request noise
        pass


if __name__ == "__main__":
    os.chdir(DIST_DIR)
    server = http.server.HTTPServer(("0.0.0.0", PORT), CORSHandler)
    print(f"Plugin server: http://localhost:{PORT}/manifest.json", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
