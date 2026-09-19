from datetime import date, datetime, timedelta
from pathlib import Path
import json
import tempfile
import threading
import unittest
from urllib.request import Request, urlopen
from http.server import ThreadingHTTPServer
import local_server as app
import local_ai as ai


class Reminders(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.old=app.DATA
        app.DATA=Path(self.temp.name);app.initialize()
    def tearDown(self):
        app.DATA=self.old;self.temp.cleanup()
    def test_due_validation_restart_and_ack(self):
        day=app.today()
        with app.database() as db:
            all_day=app.save_reminder(db,{'date':day,'title':'Submit document'})
            timed=app.save_reminder(db,{'date':day,'title':'Meeting','time':'15:00'})
            self.assertEqual(app.save_reminder(db,{'date':day,'title':'Meeting','time':'15:00'})['id'],timed['id'])
            for bad in ('24:00','99:10',None):
                with self.assertRaises(ValueError):app.save_reminder(db,{'date':day,'title':'bad','time':bad})
            with self.assertRaises(ValueError):app.save_reminder(db,{'date':(date.today()-timedelta(days=1)).isoformat(),'title':'past'})
            self.assertEqual([r['id'] for r in app.due_reminders(db,datetime.fromisoformat(day+'T14:59'))],[all_day['id']])
            self.assertEqual(len(app.due_reminders(db,datetime.fromisoformat(day+'T15:00'))),2)
            self.assertEqual(app.due_reminders(db,datetime.fromisoformat(day+'T15:00')+timedelta(days=1)),[])
        app.initialize()
        server=ThreadingHTTPServer(('127.0.0.1',0),app.Handler)
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        base=f'http://127.0.0.1:{server.server_port}'
        try:
            with urlopen(base+'/api/state') as response:self.assertEqual(len(json.load(response)['reminders']),2)
            request=Request(base+'/api/reminders/ack',data=json.dumps({'ids':[all_day['id']]}).encode(),headers={'Content-Type':'application/json'})
            with urlopen(request) as response:self.assertTrue(json.load(response)['ok'])
            with app.database() as db:self.assertNotIn(all_day['id'],[r['id'] for r in app.due_reminders(db)])
        finally:server.shutdown();server.server_close();thread.join()
    def test_model_adds_once_and_reports_saved(self):
        text='明天15点提醒我提交文件';day=(date.today()+timedelta(days=1)).isoformat();calls=[]
        def provider(messages,schemas):
            calls.append(1)
            if len(calls)<=2:
                return {'role':'assistant','content':None,'tool_calls':[{'id':str(len(calls)),'type':'function','function':{'name':'add_reminder','arguments':json.dumps({'date':day,'title':'提交文件','time':'15:00','user_quote':text})}}]}
            return {'role':'assistant','content':'done'}
        result=ai.chat(app,{'message':text},request_fn=provider)
        self.assertIn('15:00',result['answer']);self.assertIn('已添加提醒',result['answer'])
        with app.database() as db:self.assertEqual(db.execute('SELECT COUNT(*) FROM reminders').fetchone()[0],1)


if __name__=='__main__':unittest.main()
