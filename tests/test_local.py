"""Run with the existing environment: python -m unittest discover -s tests."""
from datetime import date, timedelta
from io import BytesIO
from pathlib import Path
import json
import tempfile
import threading
import unittest
from urllib.request import Request, urlopen
from urllib.error import HTTPError

from PIL import Image
import local_server as app
from sample_workbook import workbook_bytes


class LocalCalendarTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        app.DATA = Path(cls.temp.name)
        app.initialize()
        cls.server = app.ThreadingHTTPServer(('127.0.0.1', 0), app.Handler)
        cls.base = 'http://127.0.0.1:' + str(cls.server.server_port)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()
        cls.temp.cleanup()

    def call(self, path, body=None, raw=False):
        data = body if raw else json.dumps(body).encode() if body is not None else None
        request = Request(self.base + path, data=data, headers={'Content-Type':'application/octet-stream' if raw else 'application/json'})
        try:
            with urlopen(request) as response:
                return response.status, json.loads(response.read())
        except HTTPError as error:
            return error.code, json.loads(error.read())

    def test_completion_without_photos(self):
        # Exercise real HTTP writes, all task sources, persistence and the day boundary.
        from unittest.mock import patch
        now='2031-04-20'
        with app.database() as db:
            for task_id,day,origin in [('check-manual',now,None),('check-course',now,'fixture-course'),
                                      ('check-goal',now,None),('check-replaced',now,None),
                                      ('check-past','2031-04-19',None),('check-future','2031-04-21',None)]:
                db.execute('INSERT INTO tasks(id,date,title,start,end,origin) VALUES (?,?,?,?,?,?)',
                           (task_id,day,task_id,'09:00','10:00',origin))
            db.execute("INSERT INTO task_meta(task_id,goal_id,topic_id) VALUES ('check-goal','goal','topic')")
            db.execute("INSERT INTO task_meta(task_id,batch_id) VALUES ('check-course','batch')")
            db.execute("INSERT INTO task_meta(task_id,superseded) VALUES ('check-replaced',1)")
        with patch.object(app,'today',return_value=now):
            for task_id in ['check-manual','check-course','check-goal']:
                for _ in range(2):self.assertEqual(self.call('/api/tasks/done',{'id':task_id})[0],200)
            for task_id in ['check-replaced','check-past','check-future','missing']:
                self.assertEqual(self.call('/api/tasks/done',{'id':task_id})[0],422)
            self.assertEqual(self.call('/api/checkin',{'date':now})[0],422)
            output=BytesIO();Image.new('RGB',(4,4),'blue').save(output,'PNG')
            self.assertEqual(self.call('/api/photos/'+now,output.getvalue(),True)[0],200)
            self.assertIn(now,[c['date'] for c in self.call('/api/state')[1]['checkins']])
            tasks={t['id']:t for t in self.call('/api/state')[1]['tasks']}
            self.assertNotIn('check-replaced',tasks)
            self.assertEqual(tasks['check-goal']['topic_id'],'topic')
            self.assertEqual(tasks['check-course']['batch_id'],'batch')
            for task_id in ['check-manual','check-course','check-goal']:self.assertEqual(tasks[task_id]['done'],1)
        app.initialize()
        with app.database() as db:
            self.assertEqual(db.execute("SELECT count(*) FROM task_meta WHERE task_id LIKE 'check-%' AND done=1").fetchone()[0],3)
            self.assertEqual(db.execute('SELECT count(*) FROM checkins WHERE date=?',(now,)).fetchone()[0],1)
            db.execute('DELETE FROM photos WHERE date=?',(now,))
            db.execute('DELETE FROM checkins WHERE date=?',(now,))
            db.execute("DELETE FROM task_meta WHERE task_id LIKE 'check-%'")
            db.execute("DELETE FROM tasks WHERE id LIKE 'check-%'")

    def test_diary_persistence_and_conflicts(self):
        from unittest.mock import patch
        day='2035-05-20'
        with patch.object(app,'today',return_value=day):
            body={'date':day,'content':'今天完成离散数学。\n<script>只是文字</script>','revision':0}
            self.assertEqual(self.call('/api/diary',body)[0],200)
            self.assertEqual(self.call('/api/diary',body)[0],409)
            body['revision']=1;body['content']='第二次记录'
            self.assertEqual(self.call('/api/diary',body)[0],200)
            for change,code in [({'date':'2035-05-19'},403),({'date':'2035-05-21'},403),
                                ({'content':'a'*10001},422),({'revision':True},422)]:
                self.assertEqual(self.call('/api/diary',body|change)[0],code)
        app.initialize()
        entry=next(e for e in self.call('/api/state')[1]['diary_entries'] if e['date']==day)
        self.assertEqual((entry['content'],entry['revision']),('第二次记录',2))

    def test_photo_checkin_and_history(self):
        now = app.today()
        past = (date.today()-timedelta(days=1)).isoformat()
        future = (date.today()+timedelta(days=1)).isoformat()
        self.assertEqual(self.call('/api/checkin', {'date':now})[0],422)
        output=BytesIO(); Image.new('RGB',(40,40),'blue').save(output,'PNG')
        raw=output.getvalue()
        self.assertEqual(self.call('/api/photos/'+past,raw,True)[0],403)
        self.assertEqual(self.call('/api/photos/'+future,raw,True)[0],403)
        self.assertEqual(self.call('/api/photos/'+now,b'not a photo',True)[0],422)
        status,result=self.call('/api/photos/'+now,raw,True)
        self.assertEqual(status,200)
        self.assertTrue((app.DATA/'photos'/result['filename']).is_file())
        self.assertEqual(self.call('/api/checkin',{'date':now})[0],422)
        self.assertFalse(self.call('/api/state')[1]['checkins'])
        self.call('/api/tasks',dict(title='Auto check-in task',date=now,start='08:00',end='09:00'))
        task=next(t for t in self.call('/api/state')[1]['tasks'] if t['title']=='Auto check-in task')
        self.assertEqual(self.call('/api/tasks/done',{'id':task['id']})[0],200)
        self.assertEqual(len(self.call('/api/state')[1]['checkins']),1)
        self.assertEqual(self.call('/api/checkin',{'date':now})[0],200)
        self.assertEqual(self.call('/api/checkin',{'date':now})[0],200)
        self.assertEqual(self.call('/api/checkin',{'date':past})[0],403)
        state=self.call('/api/state')[1]
        self.assertEqual(len(state['checkins']),1)
        self.assertEqual(len(state['photos']),1)

    def test_task_save_edit_and_import_idempotence(self):
        raw=workbook_bytes()
        status,first=self.call('/api/import',raw,True)
        self.assertEqual(status,200,first)
        self.assertEqual(first['added'],172)
        self.assertEqual(first['from'],'2000-01-01')
        second=self.call('/api/import',raw,True)[1]
        self.assertEqual(second['added'],0)
        with app.database() as db:
            self.assertEqual(db.execute('SELECT content FROM source_files').fetchone()[0],raw)
            self.assertEqual(db.execute('SELECT COUNT(*) FROM source_files').fetchone()[0],1)
        self.assertEqual(self.call('/api/profile')[1]['records']['source_files'],1)
        state=self.call('/api/state')[1]
        course=next(t for t in state['tasks'] if t['date']=='2000-01-01' and t['title']=='示例课程' and t['start']=='10:25')
        self.assertEqual((course['start'],course['end']),('10:25','12:00'))
        status,_=self.call('/api/tasks',dict(course,title='不能改历史'))
        self.assertEqual(status,403)
        task=dict(date=app.today(),title='我的新安排',start='23:00',end='24:00',note='')
        self.assertEqual(self.call('/api/tasks',task)[0],200)
        saved=next(t for t in self.call('/api/state')[1]['tasks'] if t['title']==task['title'])
        self.assertEqual(self.call('/api/tasks',dict(saved,title='调整后的安排'))[0],200)
        self.assertEqual(self.call('/api/tasks',dict(task,end='22:00'))[0],422)

    def test_open_count_and_static_privacy(self):
        self.call('/api/open',{});self.call('/api/open',{})
        self.assertEqual(len(self.call('/api/state')[1]['visits']),1)
        self.assertEqual(self.call('/data/calendar.db')[0],404)
        request=Request(self.base+'/api/open',data=b'{}',headers={'Origin':'http://elsewhere.invalid'})
        with self.assertRaises(HTTPError) as cm:urlopen(request)
        self.assertEqual(cm.exception.code,403)


if __name__ == '__main__':
    unittest.main()
