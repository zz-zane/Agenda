"""Exercise the shipped EXEs with a local HTTPS mock and no Python/Node on PATH."""
import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import queue
import secrets
import ssl
import subprocess
import tempfile
import threading
from urllib.error import HTTPError
from urllib.request import Request, urlopen


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('application', type=Path)
    parser.add_argument('--openssl', required=True, type=Path)
    args = parser.parse_args()
    application = args.application.resolve()
    backend = application.parent / 'resources' / 'backend' / 'AgendaBackend.exe'
    seen = []

    class Provider(BaseHTTPRequestHandler):
        def log_message(self, *args): pass
        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
            seen.append(body)
            if body['messages'][-1]['role'] == 'tool':
                answer = {'role': 'assistant', 'content': 'desktop-runtime-ok'}
            else:
                answer = {'role': 'assistant', 'content': None, 'tool_calls': [
                    {'id': 'fixture', 'type': 'function', 'function': {
                        'name': 'read_skill', 'arguments': '{"name":"study-plan"}'}}]}
            raw = json.dumps({'choices': [{'message': answer}]}).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

    with tempfile.TemporaryDirectory(prefix='agenda-packaged-check-') as folder:
        directory = Path(folder)
        cert, key = directory / 'localhost.pem', directory / 'localhost.key'
        subprocess.run([str(args.openssl), 'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
                        '-keyout', str(key), '-out', str(cert), '-days', '1', '-subj', '/CN=localhost',
                        '-addext', 'subjectAltName=DNS:localhost'], check=True, capture_output=True, timeout=30)
        provider = ThreadingHTTPServer(('127.0.0.1', 0), Provider)
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(cert, key)
        provider.socket = context.wrap_socket(provider.socket, server_side=True)
        thread = threading.Thread(target=provider.serve_forever, daemon=True)
        thread.start()
        token = secrets.token_hex(32)
        env = {k: v for k, v in os.environ.items() if k.upper() not in (
            'AI_API_KEY', 'DEEPSEEK_API_KEY', 'PYTHONPATH', 'PYTHONHOME', 'NODE_OPTIONS')}
        env.update(PATH=str(Path(os.environ['WINDIR']) / 'System32'), SSL_CERT_FILE=str(cert),
                   AGENDA_DESKTOP_TOKEN=token, AGENDA_NODE_BINARY=str(application), ELECTRON_RUN_AS_NODE='1')

        def launch():
            process = subprocess.Popen([str(backend), '--data', str(directory / 'data')], env=env,
                cwd=directory, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                creationflags=subprocess.CREATE_NO_WINDOW)
            incoming = queue.Queue()
            threading.Thread(target=lambda: incoming.put(process.stdout.readline()), daemon=True).start()
            try:
                message = json.loads(incoming.get(timeout=30))
                return process, f"http://127.0.0.1:{message['port']}"
            except Exception:
                process.kill()
                _, error = process.communicate(timeout=10)
                raise AssertionError('Packaged backend startup failed: ' + error.decode(errors='replace'))

        def request(base, route, body=None, authenticate=True):
            headers = {'Content-Type': 'application/json'}
            if authenticate: headers['X-Agenda-Desktop-Token'] = token
            raw = json.dumps(body).encode() if body is not None else None
            with urlopen(Request(base + route, data=raw, headers=headers), timeout=150) as response:
                return json.load(response)

        process = None
        try:
            process, base = launch()
            try:
                request(base, '/api/state', authenticate=False)
                raise AssertionError('Unauthenticated access accepted')
            except HTTPError as error:
                assert error.code == 403
            state = request(base, '/api/state')
            assert not state['tasks'] and not state['photos'] and not state['checkins']
            request(base, '/api/ai/config', {'base_url': f'https://localhost:{provider.server_port}',
                    'model': 'fixture-model', 'api_key': 'desktop-fixture-key'})
            result = request(base, '/api/ai/chat', {'message': '请读取学习计划技能'})
            assert result['status'] == 'completed', result
            assert 'desktop-runtime-ok' in result['answer'] and len(seen) == 2
            assert '截止' in seen[-1]['messages'][-1]['content']
            encrypted_keys=list((directory / 'data' / 'model-keys').glob('*/ai-key.dpapi'))
            assert len(encrypted_keys)==1 and b'desktop-fixture-key' not in encrypted_keys[0].read_bytes()
            process.stdin.close()
            assert process.wait(timeout=10) == 0
            process.stdout.close(); process.stderr.close()
            process, base = launch()
            assert request(base, '/api/ai/state')['config']['configured']
            assert (directory / 'data' / 'backups' / 'before-desktop-v2.db').exists()
            process.stdin.close()
            assert process.wait(timeout=10) == 0
            print('PASS: frozen backend, private HTTP, empty new data, bundled DSH + HTTPS mock tool round, DPAPI restart, backup, EOF shutdown; PATH excludes Python/Node.')
        finally:
            if process:
                if process.poll() is None: process.kill(); process.wait(timeout=10)
                process.stdout.close(); process.stderr.close()
            provider.shutdown(); provider.server_close(); thread.join(5)


if __name__ == '__main__':
    main()
