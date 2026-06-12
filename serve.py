#!/usr/bin/env python3
"""Dev server with caching disabled so edits always reach the browser."""
import http.server

class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def log_message(self, *args):
        pass

if __name__ == '__main__':
    addr = ('127.0.0.1', 8123)
    print(f'serving on http://{addr[0]}:{addr[1]}/')
    http.server.ThreadingHTTPServer(addr, NoCacheHandler).serve_forever()
