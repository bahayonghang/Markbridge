"""One-shot Ollama chat body on 127.0.0.1. The process is not installed."""

import hashlib
import json
import sys
import threading
import time
import unicodedata
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

LOG = sys.argv[1]
LOCK = threading.Lock()
COUNT = 0


def cc(char):
    return unicodedata.category(char) == "Cc"


def cached_field(content):
    marker = "Cached page text:\n"
    start = content.find(marker)
    if start < 0:
        return ""
    start += len(marker)
    end = content.rfind("\nData end")
    if end < start:
        return content[start:]
    return content[start:end]


def url_field(content):
    marker = "URL:\n"
    start = content.find(marker)
    if start < 0:
        return ""
    start += len(marker)
    end = content.find("\nCached page text:\n", start)
    if end < start:
        return content[start:]
    return content[start:end]


def page_from(body):
    messages = body.get("messages")
    if not isinstance(messages, list):
        return "", ""
    for message in messages:
        if not isinstance(message, dict) or message.get("role") != "user":
            continue
        content = message.get("content")
        if isinstance(content, str) and "Cached page text:\n" in content:
            return url_field(content), cached_field(content)
    return "", ""


def quote(page):
    chars = list(page)
    index = 0
    while index < len(chars):
        if cc(chars[index]) and chars[index] not in "\n\t":
            index += 1
            continue
        window = []
        cursor = index
        while cursor < len(chars) and len(window) < 40:
            char = chars[cursor]
            if cc(char) and char not in "\n\t":
                break
            window.append(char)
            cursor += 1
        text = "".join(window).strip()
        if text:
            return text
        index = cursor + 1 if cursor == index else cursor
    return None


def append(row):
    line = json.dumps(row, ensure_ascii=False, separators=(",", ":"))
    with LOCK:
        with open(LOG, "a", encoding="utf-8") as handle:
            handle.write(line + "\n")


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        return

    def do_POST(self):
        global COUNT
        length = int(self.headers.get("Content-Length", "0") or "0")
        raw = self.rfile.read(length) if 0 < length <= 262144 else b""
        auth = self.headers.get("Authorization") is not None
        try:
            body = json.loads(raw.decode("utf-8"))
        except (UnicodeError, json.JSONDecodeError):
            body = None
        if not isinstance(body, dict):
            append({"path": self.path, "auth": auth, "quoted": False, "error": "body"})
            self.reply(400, b"{}")
            return
        forbidden = [key for key in ("tools", "functions", "tool_choice") if key in body]
        url, page = page_from(body)
        evidence = quote(page)
        with LOCK:
            COUNT += 1
            number = COUNT
        row = {
            "n": number,
            "path": self.path,
            "model": body.get("model") if isinstance(body.get("model"), str) else "",
            "forbidden": forbidden,
            "auth": auth,
            "url": url,
            "pageSha256": hashlib.sha256(page.encode("utf-8")).hexdigest(),
            "pageChars": len(page),
            "quoted": evidence is not None and evidence in page,
            "evidence": evidence,
        }
        append(row)
        if evidence is None or forbidden or self.path != "/api/chat":
            self.reply(200, b'{"message":{"content":"not-json"}}')
            return
        suggestion = {
            "title": evidence[:60],
            "tags": ["quote"],
            "summary": None,
            "suggestedFolder": None,
            "evidence": evidence,
        }
        content = json.dumps(suggestion, ensure_ascii=False, separators=(",", ":"))
        payload = json.dumps(
            {"message": {"content": content}}, ensure_ascii=False, separators=(",", ":")
        ).encode("utf-8")
        time.sleep(0.25)
        self.reply(200, payload)

    def reply(self, status, payload):
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(payload)


class Server(ThreadingHTTPServer):
    allow_reuse_address = False
    daemon_threads = True


def main():
    server = Server(("127.0.0.1", 0), Handler)
    host, port = server.server_address
    if host != "127.0.0.1":
        print(f"HOST={host}", flush=True)
        return 1
    print(f"HOST={host}", flush=True)
    print(f"PORT={port}", flush=True)
    server.serve_forever()
    return 0


if __name__ == "__main__":
    sys.exit(main())
