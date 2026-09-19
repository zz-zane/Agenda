"""Desktop boundaries with real HTTP and isolated SQLite, no personal data."""
import json
from contextlib import closing
from pathlib import Path
import sqlite3
import tempfile
import threading
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import desktop_host
import local_server as app


class DesktopTest(unittest.TestCase):
    def test_private_http_and_backup(self):
        previous = app.DATA
        with tempfile.TemporaryDirectory() as directory:
            try:
                target = Path(directory) / 'data'
                desktop_host.prepare_data(target)
                with app.database() as db:
                    db.execute("INSERT INTO visits(date) VALUES ('2000-01-01')")
                desktop_host.prepare_data(target)
                with closing(sqlite3.connect(target / 'backups' / 'before-desktop-v2.db')) as backup:
                    self.assertEqual(backup.execute('SELECT date FROM visits').fetchall(), [('2000-01-01',)])
                token = 'a' * 64
                server = desktop_host.make_server(token)
                thread = threading.Thread(target=server.serve_forever, daemon=True)
                thread.start()
                base = f'http://127.0.0.1:{server.server_port}'
                try:
                    for path in ('/', '/api/state'):
                        with self.assertRaises(HTTPError) as error:
                            urlopen(base + path)
                        self.assertEqual(error.exception.code, 403)
                    with self.assertRaises(HTTPError) as error:
                        urlopen(Request(base + '/', method='HEAD'))
                    self.assertEqual(error.exception.code, 403)
                    headers = {'X-Agenda-Desktop-Token': token}
                    with urlopen(Request(base + '/api/state', headers=headers)) as response:
                        self.assertEqual(len(json.load(response)['visits']), 1)
                    with self.assertRaises(HTTPError) as error:
                        urlopen(Request(base + '/api/open', data=b'{}', headers={**headers, 'Origin': 'https://example.invalid'}))
                    self.assertEqual(error.exception.code, 403)
                    with self.assertRaises(HTTPError) as error:
                        urlopen(Request(base + '/data/calendar.db', headers=headers))
                    self.assertEqual(error.exception.code, 404)
                finally:
                    server.shutdown()
                    server.server_close()
                    thread.join()
            finally:
                app.DATA = previous


if __name__ == '__main__':
    unittest.main()
