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
