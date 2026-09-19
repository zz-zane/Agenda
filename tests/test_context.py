import json
from pathlib import Path
import tempfile
import time
import unittest
import local_context as context
import local_server as app

class ContextChecks(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.old=app.DATA;app.DATA=Path(self.temp.name);app.initialize()
    def tearDown(self):
        app.DATA=self.old;self.temp.cleanup()
    def seed(self,first='旧要求：运动每周四次，每次连续两小时。',count=30):
        with app.database() as db:
            for i in range(count):db.execute('INSERT INTO chat(role,content) VALUES (?,?)',('user' if i%2==0 else 'assistant',first if i==0 else f'原文消息{i}，用户确认的条件。'))
    def test_summary_restart_recent_originals_and_failure(self):
        self.seed();summary='用户确认运动每周四次，每次连续两小时；其余要求尚待安排。'
        self.assertTrue(context.compact(app,lambda m:summary,'test-model'))
        with app.database() as db:
            saved=context.saved(db);self.assertEqual(saved['upto'],18)
            history=context.history(db);self.assertIn(summary,history[0]['content'])
            self.assertEqual(len(history),13)
            self.assertEqual(db.execute('SELECT COUNT(*) FROM chat').fetchone()[0],30)
            self.assertIn('运动',db.execute('SELECT content FROM chat WHERE id=1').fetchone()[0])
        app.initialize()
        self.assertFalse(context.compact(app,lambda m:self.fail('unchanged restart must not spend a model call'),'test-model'))
        with app.database() as db:db.execute("INSERT INTO chat(role,content) VALUES ('user','新增条件')")
        with self.assertRaises(ValueError):context.compact(app,lambda m:'','test-model')
        with app.database() as db:self.assertEqual(context.saved(db),saved)
    def test_long_message_checkpoint_and_budget(self):
        original='A'*(context.BATCH_CHARS+17)
        self.seed(original,count=13)
        chunks=[]
        def summarize(messages):
            parts=json.loads(messages[-1]['content'])['messages'];chunks.extend(p['content'] for p in parts)
            return '长期条件保持不变，本批超长消息已摘要；继续处理剩余正文。'
        self.assertTrue(context.compact(app,summarize,'fixture'))
        with app.database() as db:
            self.assertEqual(context.saved(db)['offset'],context.BATCH_CHARS)
            self.assertLessEqual(sum(len(m['content']) for m in context.history(db)),context.HISTORY_CHARS+context.SUMMARY_CHARS+300)
        self.assertTrue(context.compact(app,summarize,'fixture'))
        self.assertEqual(''.join(chunks),original)
        self.assertFalse(context.compact(app,summarize,'fixture'))
    def test_background_missing_key_and_no_duplicate_job(self):
        self.seed()
        def wait():
            end=time.monotonic()+3
            while str(app.DATA.resolve()) in context.RUNNING and time.monotonic()<end:time.sleep(.01)
            self.assertNotIn(str(app.DATA.resolve()),context.RUNNING)
        context.start(app,lambda:({'model':'test'},''),lambda *args:self.fail('No key'))
        wait()
        with app.database() as db:self.assertEqual(context.status(app,db)['status'],'no_key')
        calls=[]
        def summarize(*args):calls.append(1);time.sleep(.05);return '已压缩所有较早记录；用户明确要求仍然保留，未完成事项待处理。'
        context.start(app,lambda:({'model':'test'},'fixture'),summarize)
        context.start(app,lambda:({'model':'test'},'fixture'),summarize)
        wait();self.assertEqual(len(calls),1)
        with app.database() as db:self.assertTrue(context.status(app,db)['has_summary'])
        with app.database() as db:
            for _ in range(2):db.execute("INSERT INTO chat(role,content) VALUES ('user','短补充')")
        context.start(app,lambda:({'model':'test'},'fixture'),summarize,startup=False)
        wait();self.assertEqual(len(calls),1)

if __name__=='__main__':unittest.main()
