import json
import os
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

import local_ai as ai
import local_secrets
import local_server as app


class ModelsTest(unittest.TestCase):
    def setUp(self):
        self.previous = app.DATA
        self.temp = tempfile.TemporaryDirectory()
        app.DATA = Path(self.temp.name)
        app.initialize()
        self.env = patch.dict(os.environ, {'AI_API_KEY': ''})
        self.env.start()

    def tearDown(self):
        self.env.stop()
        ai.SECRETS.pop(str(app.DATA), None)
        app.DATA = self.previous
        self.temp.cleanup()

    def test_legacy_and_multiple_keys_survive_restart_without_cross_provider_reuse(self):
        local_secrets.save(app.DATA, 'legacy-fixture')
        with app.database() as db:
            db.execute('INSERT INTO ai_config VALUES (1,?)', (json.dumps({'base_url': 'https://api.deepseek.com', 'model': 'deepseek-chat'}),))
        second = ai.save_config(app, {'new': True, 'base_url': 'https://api.openai.com/v1', 'model': 'gpt-fixture', 'api_key': 'openai-fixture'})
        self.assertEqual(ai.get_key(app), 'openai-fixture')
        self.assertEqual(len(ai.configurations(app)), 2)
        app.initialize()
        ai.SECRETS.clear()
        self.assertEqual(ai.config(app)['id'], second['id'])
        self.assertEqual(ai.get_key(app), 'openai-fixture')
        ai.select_config(app, {'id': 1})
        self.assertEqual(ai.get_key(app), 'legacy-fixture')
        with self.assertRaises(ValueError):
            ai.save_config(app, {'base_url': 'https://api.anthropic.com/v1', 'model': 'claude-fixture'})
        with self.assertRaises(ValueError):
            ai.save_config(app, {'new': True, 'base_url': 'https://api.anthropic.com/v1', 'model': 'claude-fixture'})
        for invalid in (True, '1', -1, 999):
            with self.assertRaises(ValueError):
                ai.select_config(app, {'id': invalid})
        ai.CHAT_LOCK.acquire()
        try:
            with self.assertRaises(ValueError):
                ai.select_config(app, {'id': second['id']})
        finally:
            ai.CHAT_LOCK.release()
        raw = json.dumps(ai.state(app))
        with app.database() as db:
            raw += json.dumps(ai.rows(db, 'ai_config'))
        for secret in ('legacy-fixture', 'openai-fixture'):
            self.assertNotIn(secret, raw)
            for encrypted in app.DATA.rglob('*.dpapi'):
                self.assertNotIn(secret.encode(), encrypted.read_bytes())
        self.assertNotIn('credential_ref', json.dumps(ai.state(app)))

    def test_failed_database_update_keeps_previous_key_and_selection(self):
        ai.save_config(app, {'base_url': 'https://api.deepseek.com', 'model': 'before', 'api_key': 'before-fixture'})
        keys = list(app.DATA.rglob('*.dpapi'))
        with app.database() as db:
            db.execute("CREATE TRIGGER refuse_config BEFORE INSERT ON ai_config BEGIN SELECT RAISE(ABORT,'fixture'); END")
        with self.assertRaises(sqlite3.IntegrityError):
            ai.save_config(app, {'base_url': 'https://api.deepseek.com', 'model': 'after', 'api_key': 'after-fixture'})
        self.assertEqual(ai.config(app)['model'], 'before')
        self.assertEqual(ai.get_key(app), 'before-fixture')
        self.assertEqual(list(app.DATA.rglob('*.dpapi')), keys)
        self.assertFalse(ai.CHAT_LOCK.locked())

    def test_provider_wire_format_preserves_tools_and_uses_matching_token_parameter(self):
        class Reply:
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def read(self, limit): return b'{"choices":[{"message":{"role":"assistant","content":"ok"}}]}'
        schemas = [{'type': 'function', 'function': {'name': 'sample', 'parameters': {'type': 'object', 'properties': {}}}}]
        for base, field in [('https://api.openai.com/v1', 'max_completion_tokens'), ('https://api.anthropic.com/v1', 'max_tokens')]:
            with self.subTest(base=base), patch.object(ai, 'build_opener') as opener:
                opener.return_value.open.return_value = Reply()
                result = ai.completion({'base_url': base, 'model': 'fixture'}, 'provider-fixture', [{'role': 'user', 'content': 'hello'}], schemas)
                request = opener.return_value.open.call_args.args[0]
                self.assertEqual(request.full_url, base + '/chat/completions')
                self.assertEqual(request.get_header('Authorization'), 'Bearer provider-fixture')
                body = json.loads(request.data)
                self.assertEqual(body[field], 8192)
                self.assertEqual(body['tools'], schemas)
                self.assertEqual(result['content'], 'ok')
