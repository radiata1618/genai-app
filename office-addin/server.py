import http.server
import ssl
import os
import subprocess

PORT = 8081
CERT_FILE = "cert.pem"
KEY_FILE = "key.pem"

def generate_self_signed_cert():
    if not os.path.exists(CERT_FILE) or not os.path.exists(KEY_FILE):
        print("Generating self-signed certificate...")
        subprocess.check_call([
            "openssl", "req", "-x509", "-newkey", "rsa:4096",
            "-keyout", KEY_FILE, "-out", CERT_FILE,
            "-days", "365", "-nodes",
            "-subj", "/CN=localhost"
        ])
        print("Certificate generated.")
    else:
        print("Certificate already exists.")

class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # Enable CORS for Office Add-ins
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

def run(server_class=http.server.HTTPServer, handler_class=Handler):
    generate_self_signed_cert()
    
    server_address = ('0.0.0.0', PORT)
    httpd = server_class(server_address, handler_class)
    
    # Create SSL context
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(certfile=CERT_FILE, keyfile=KEY_FILE)
    httpd.socket = context.wrap_socket(httpd.socket, server_side=True)

    print(f"Serving HTTPS on port {PORT}...")
    # Change directory to src so index.html is at root
    os.chdir('src') 
    httpd.serve_forever()

if __name__ == "__main__":
    run()
