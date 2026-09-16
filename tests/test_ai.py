"""Isolated business checks: no key, no external model, no live data writes."""
from copy import deepcopy
from datetime import date,timedelta
from pathlib import Path
import json
import tempfile
import unittest
from unittest.mock import patch

import local_server as app
import local_ai as ai


class AITest(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.previous=app.DATA
        app.DATA=Path(self.temp.name);app.initialize()
        self.day=lambda n:(date.today()+timedelta(days=n)).isoformat()
        self.plan={'goal_id':'','title':'Python','mode':'简单','deadline':self.day(30),
          'topics':[{'id':'syntax','title':'语法','minutes':60},{'id':'functions','title':'函数','minutes':60}],
          'sessions':[self.session('syntax',1),self.session('functions',2)],'reason':'一个月内完成基础大纲'}

    def tearDown(self):
        ai.SECRETS.pop(str(app.DATA),None);app.DATA=self.previous;self.temp.cleanup()

    def session(self,topic,n):
        return {'topic_id':topic,'date':self.day(n),'title':topic,'start':'09:00','end':'10:00','note':'具体练习'}

    def draft(self,kind,body,grant=None):
        with app.database() as db:return ai.propose(db,app,kind,body,grant or {})['draft']

    def test_skill_tool_loop_preview_and_idempotent_apply(self):
        captured=[]
        def provider(messages,schemas):
            captured.append(deepcopy(messages))
            n=len(captured)
            if n==1:return {'role':'assistant','content':None,'tool_calls':[{'id':'s','type':'function','function':{'name':'read_skill','arguments':'{"name":"study-plan"}'}}]}
            if n==2:
                self.assertIn('截止',messages[-1]['content'])
                return {'role':'assistant','content':None,'tool_calls':[{'id':'p','type':'function','function':{'name':'propose_plan','arguments':json.dumps(self.plan)}}]}
            self.assertEqual(messages[-1]['tool_call_id'],'p')
            return {'role':'assistant','content':'计划已生成，等待确认。'}
        out=ai.chat(app,{'message':'一个月学 Python，简单模式'},request_fn=provider)
        self.assertEqual(out['status'],'completed');self.assertEqual(len(captured),3)
        with app.database() as db:self.assertEqual(len(ai.rows(db,'tasks')),0)
        ai.apply(app,out['drafts'][0]);ai.apply(app,out['drafts'][0])
        with app.database() as db:self.assertEqual(len(ai.rows(db,'tasks')),2)

    def test_missed_days_keep_scope_deadline_and_completed_history(self):
        ai.apply(app,self.draft('plan',self.plan))
        with app.database() as db:
            g=ai.context(db,app)['goals'][0]
            db.execute('UPDATE tasks SET date=?',(self.day(-3),))
            # A historical completed topic counts; an uncompleted past topic does not.
            db.execute("UPDATE task_meta SET done=1 WHERE topic_id='syntax'")
        new={**self.plan,'goal_id':g['id'],'sessions':[self.session('functions',4)]}
        with self.assertRaisesRegex(ValueError,'截止日'):
            self.draft('plan',{**new,'deadline':self.day(33)})
        with self.assertRaisesRegex(ValueError,'剩余'):
            self.draft('plan',{**new,'sessions':[{**self.session('functions',4),'end':'09:30'}]})
        with self.assertRaisesRegex(ValueError,'大纲'):
            self.draft('plan',{**new,'topics':[self.plan['topics'][1]]})
        ai.apply(app,self.draft('plan',new))
        with app.database() as db:
            ctx=ai.context(db,app)
            self.assertEqual(ctx['goals'][0]['deadline'],self.day(30))
            self.assertEqual(sum(t.get('done',0) for t in ctx['tasks']),1)
            self.assertEqual(sum(t.get('superseded',0) for t in ctx['tasks']),1)
        extended={**new,'deadline':self.day(33),'sessions':[self.session('functions',32)]}
        grant={'goal_id':g['id'],'deadline':self.day(33)}
        ai.apply(app,self.draft('plan',extended,grant))
        with app.database() as db:self.assertEqual(ai.context(db,app)['goals'][0]['deadline'],self.day(33))

    def test_runtime_manual_task_preview_and_failed_turn_invalidation(self):
        calls=[]
        body={'delete_ids':[],'tasks':[{'date':self.day(1),'title':'临时有事','start':'15:00','end':'16:00','note':''}],'reason':'调整明天'}
        def provider(messages,schemas):
            calls.append(messages)
            if len(calls)==1:
                return {'role':'assistant','content':None,'tool_calls':[{'id':'manual','type':'function','function':{'name':'propose_tasks','arguments':json.dumps(body)}}]}
            return {'role':'assistant','content':'请确认临时安排。'}
        out=ai.chat(app,{'message':'明天下午有事'},request_fn=provider)
        self.assertEqual(out['status'],'completed')
        ai.apply(app,out['drafts'][0])
        with app.database() as db:self.assertEqual(len(ai.rows(db,'tasks')),1)
        attempts=[]
        def fail_after_preview(messages,schemas):
            attempts.append(1)
            if len(attempts)>1:raise ValueError('模型接口 HTTP 503')
            return {'role':'assistant','content':None,'tool_calls':[{'id':'plan','type':'function','function':{'name':'propose_plan','arguments':json.dumps(self.plan)}}]}
        failed=ai.chat(app,{'message':'学习 Python'},request_fn=fail_after_preview)
        self.assertEqual(failed['status'],'model_error');self.assertEqual(failed['drafts'],[])
        with app.database() as db:
            self.assertFalse(any(p['status']=='pending' for p in ai.rows(db,'proposals')))
            self.assertEqual(len(ai.rows(db,'tasks')),1)

    def test_conflicts_stale_preview_and_past_write_rejected(self):
        p=self.draft('plan',self.plan)
        with app.database() as db:db.execute('INSERT INTO tasks VALUES (?,?,?,?,?,?,NULL)',('busy',self.day(1),'有事','09:00','10:00',''))
        with self.assertRaisesRegex(ValueError,'变化'):ai.apply(app,p)
        with self.assertRaisesRegex(ValueError,'冲突'):self.draft('plan',self.plan)
        old={'delete_ids':[],'tasks':[{'date':self.day(-1),'title':'旧日','start':'09:00','end':'10:00','note':''}],'reason':'x'}
        with self.assertRaises(ValueError):self.draft('tasks',old)
        with app.database() as db:self.assertEqual(len(ai.rows(db,'goals')),0)

    def test_import_delete_only_selected_batch(self):
        with app.database() as db:
            ai.import_tasks(db,[(self.day(-2),'误导入','09:00','10:00','')],'wrong.xlsx')
            ai.import_tasks(db,[(self.day(2),'保留课程','09:00','10:00','')],'keep.xlsx')
            batch=ai.rows(db,'imports')[0]['id']
            db.execute('INSERT INTO checkins VALUES (?,?)',(self.day(-2),'old'))
            db.execute('INSERT INTO tasks VALUES (?,?,?,?,?,?,NULL)',('manual',self.day(3),'手工','09:00','10:00',''))
        ai.apply(app,self.draft('delete_import',{'batch_id':batch,'reason':'撤销错误课表'}))
        with app.database() as db:
            self.assertEqual(len(ai.rows(db,'tasks')),2);self.assertEqual(len(ai.rows(db,'checkins')),1)
            db.execute('INSERT INTO attachments VALUES (?,?,?)',('upload','new.xlsx',json.dumps([(self.day(4),'新课','10:00','11:00','')])))
        ai.apply(app,self.draft('import',{'attachment_id':'upload','reason':'导入附件'}))
        with app.database() as db:self.assertEqual(len(ai.rows(db,'tasks')),3)

    def test_course_edit_and_chat_extension(self):
        with app.database() as db:
            ai.import_tasks(db,[(self.day(3),'英语','09:00','10:00','')],'course.xlsx')
            course=ai.rows(db,'tasks')[0]
        changed={k:course[k] for k in ('id','date','title','start','end','note')}
        changed.update(start='14:00',end='15:00',note='新教室')
        ai.apply(app,self.draft('edit_courses',{'courses':[changed],'reason':'下午上课'}))
        with app.database() as db:
            saved=ai.rows(db,'tasks')[0];self.assertEqual(saved['start'],'14:00');self.assertEqual(saved['origin'],course['origin'])
        ai.apply(app,self.draft('plan',self.plan))
        with app.database() as db:goal=ai.context(db,app)['goals'][0]
        extended={**self.plan,'goal_id':goal['id'],'deadline':self.day(33)}
        with self.assertRaises(ValueError):self.draft('plan',extended)
        calls=[]
        def provider(messages,schemas):
            calls.append(1)
            if len(calls)==1:name='authorize_extension';args={'goal_id':goal['id'],'deadline':self.day(33),'user_quote':'增加三天'}
            elif len(calls)==2:name='propose_plan';args=extended
            else:return {'role':'assistant','content':'截止增加三天，请确认。'}
            return {'role':'assistant','content':None,'tool_calls':[{'id':str(len(calls)),'type':'function','function':{'name':name,'arguments':json.dumps(args)}}]}
        out=ai.chat(app,{'message':'给 Python 增加三天'},request_fn=provider)
        self.assertEqual(out['status'],'completed')
        with app.database() as db:self.assertEqual(ai.context(db,app)['goals'][0]['deadline'],self.day(30))
        ai.apply(app,out['drafts'][0])
        with app.database() as db:self.assertEqual(ai.context(db,app)['goals'][0]['deadline'],self.day(33))

    def test_selected_courses_runtime_delete_preserves_other_data(self):
        with app.database() as db:
            ai.import_tasks(db,[(self.day(-1),'高数','09:00','10:00',''),(self.day(1),'英语','10:00','11:00','')],'课表.xlsx')
            selected=ai.rows(db,'tasks')[0]['id']
            db.execute('INSERT INTO checkins VALUES (?,?)',(self.day(-1),'saved'))
            db.execute('INSERT INTO tasks VALUES (?,?,?,?,?,?,NULL)',('manual',self.day(2),'手工','09:00','10:00',''))
        calls=[]
        def provider(messages,schemas):
            calls.append(1)
            if len(calls)==1:return {'role':'assistant','content':None,'tool_calls':[{'id':'delete','type':'function','function':{'name':'propose_delete_courses','arguments':json.dumps({'delete_ids':[selected],'reason':'只删除这节高数'})}}]}
            return {'role':'assistant','content':'请确认待删除课程。'}
        out=ai.chat(app,{'message':'删除昨天高数，保留其他课'},request_fn=provider)
        self.assertEqual(out['status'],'completed')
        with app.database() as db:self.assertEqual(len(ai.rows(db,'tasks')),3)
        ai.apply(app,out['drafts'][0]);ai.apply(app,out['drafts'][0])
        with app.database() as db:
            self.assertEqual({t['title'] for t in ai.rows(db,'tasks')},{'英语','手工'})
            self.assertEqual(len(ai.rows(db,'imports')),1);self.assertEqual(len(ai.rows(db,'checkins')),1)
        with self.assertRaises(ValueError):self.draft('delete_courses',{'delete_ids':['manual'],'reason':'invalid'})

    def test_key_not_persisted_and_model_failure_safe(self):
        secret='test-secret-only'
        ai.save_config(app,{'base_url':'https://api.deepseek.com','model':'test','api_key':secret})
        self.assertTrue(ai.config(app)['configured'])
        self.assertNotIn(secret.encode(),(ai.key_directory(app,ai.stored_config(app))/'ai-key.dpapi').read_bytes())
        ai.SECRETS.pop(str(app.DATA),None)
        self.assertEqual(ai.get_key(app),secret)
        with app.database() as db:self.assertNotIn(secret,json.dumps(ai.rows(db,'ai_config')))
        self.assertNotIn(secret,json.dumps(ai.state(app)))
        with self.assertRaises(ValueError):ai.save_config(app,{'base_url':'http://example.com','model':'x'})
        with patch.object(ai,'completion',side_effect=ValueError('模型接口 HTTP 401')):
            out=ai.chat(app,{'message':'hello'})
        self.assertEqual(out['status'],'model_error');self.assertIn('401',out['answer'])
        with app.database() as db:self.assertEqual(len(ai.rows(db,'tasks')),0)


if __name__=='__main__':unittest.main()
