"""Stand-in for the Asyntai public API, for browser tests of the extension.

It answers the four endpoints the extension calls, sends the same CORS
headers as asyntai.com, and logs every request to requests.jsonl so a test
can check what the extension sent. No AI call is made.

Keys: "good-key" works, "starter-less" gets 403, anything else gets 401.

    python test/mock_api.py 8898
"""
import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

LOG = os.path.join(os.path.dirname(os.path.abspath(__file__)), "requests.jsonl")
WEBSITES = [
    {"id": 11, "domain": "docs.example.test", "is_primary": False},
    {"id": 10, "domain": "example.test", "is_primary": True},
]


class Handler(BaseHTTPRequestHandler):
    def _send(self, status, body):
        raw = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(raw)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "authorization, content-type")
        self.end_headers()

    def _handle(self, method):
        length = int(self.headers.get("Content-Length") or 0)
        body = json.loads(self.rfile.read(length) or b"{}") if length else {}
        auth = self.headers.get("Authorization", "")
        with open(LOG, "a", encoding="utf-8") as log:
            log.write(json.dumps({"method": method, "path": self.path, "auth": auth, "body": body}) + "\n")

        key = auth[7:] if auth.startswith("Bearer ") else ""
        if key == "starter-less":
            return self._send(403, {"success": False, "error": "API access needs a paid plan."})
        if key != "good-key":
            return self._send(401, {"success": False, "error": "Invalid API key"})

        if method == "GET" and self.path == "/api/v1/account/":
            return self._send(200, {"success": True, "account": {"email": "test@example.test", "plan": "pro"}})
        if method == "GET" and self.path == "/api/v1/websites/":
            return self._send(200, {"success": True, "websites": WEBSITES})
        if method == "POST" and self.path == "/api/v1/chat/":
            question = body.get("message", "")
            site = body.get("website_id")
            answer = (
                f"**Answer** for website {site}: you asked *{question}*.\n\n"
                "- Step one\n- Step two\n\n"
                "Read more in [the guide](https://example.test/guide).\n\n"
                "<img src=x onerror=\"document.title='XSS'\">"
            )
            return self._send(200, {
                "success": True,
                "response": answer,
                "session_id": body.get("session_id") or "server-session",
                "ai_disclosure": "Answers are written by AI.",
            })
        if method == "POST" and self.path == "/api/v1/knowledge/text/":
            return self._send(201, {"success": True, "context_id": "ctx-1"})
        return self._send(404, {"success": False, "error": "Not found"})

    def do_GET(self):
        self._handle("GET")

    def do_POST(self):
        self._handle("POST")

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8898
    if os.path.exists(LOG):
        os.remove(LOG)
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
