"""Synthetic schedules only: no personal timetable, provider key or live database."""
from collections import Counter
from copy import deepcopy
from datetime import date, timedelta
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import local_ai as ai
import local_schedule as schedule
import local_server as app


class ScheduleTest(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.previous=app.DATA;app.DATA=Path(self.temp.name)
        self.today=patch.object(app,'today',return_value='2026-09-13');self.today.start();app.initialize()
        self.spec={'goal_id':'','title':'示例时间计划','mode':'普通','deadline':'2026-12-20',
                   'from_date':'2026-09-14','to_date':'2026-12-20','reason':'按用户频次与连续时长安排',
                   'windows':[{'start':'08:30','end':'21:00'}],
                   'blocked':[{'from_date':r['from_date'],'to_date':r['to_date'],'start':'18:00','end':'24:00'} for r in schedule.HOLIDAYS['ranges']],
                   'rules':[]}
        for topic,title,minutes,weekly,until,skip in [('english','英语阅读',45,0,'2026-12-20',[]),('python','Python练习',120,0,'2026-12-20',[]),('sport','运动',120,4,'2026-12-20',[]),('prob','概率复习',60,0,'2026-12-13',['概率示例课']),('discrete','离散复习',60,0,'2026-12-13',['离散示例课'])]:
            self.spec['rules'].append({'topic_id':topic,'title':title,'minutes':minutes,'per_week':weekly,'until':until,'skip_courses':skip,'preferred_start':'19:00' if weekly else '', 'preferred_end':'21:00' if weekly else ''})
        with app.database() as db:
            for i,day in enumerate(schedule.days(app,'2026-09-14','2026-12-20')):
                weekday=date.fromisoformat(day).weekday()
                for title,start,end in ([('离散示例课','14:00','15:30')] if weekday==0 else [('概率示例课','10:30','12:00')] if weekday==1 else [('离散示例课','08:30','10:00'),('概率示例课','10:30','12:00')] if weekday==3 else []):
                    db.execute('INSERT INTO tasks VALUES (?,?,?,?,?,?,?)',(f'{i}-{title}',day,title,start,end,'虚构课表',f'fixture-{i}-{title}'))

    def tearDown(self):
        self.today.stop();ai.SECRETS.pop(str(app.DATA),None);app.DATA=self.previous;self.temp.cleanup()

    def expand(self,spec=None):
        with app.database() as db:return schedule.expand(ai.context(db,app),app,spec or self.spec)

    def test_full_term_counts_conditional_courses_holidays_and_exact_duration(self):
        plan=self.expand();sessions=plan['sessions'];counts=Counter(s['topic_id'] for s in sessions)
        self.assertEqual(counts,{'english':98,'python':98,'sport':56,'prob':65,'discrete':65})
        weekly=Counter()
        for s in sessions:
            if s['topic_id']=='sport':
                self.assertEqual(app.minutes(s['end'])-app.minutes(s['start']),120)
                weekly[date.fromisoformat(s['date']).isocalendar()[:2]]+=1
            if s['topic_id']=='prob':self.assertNotIn(date.fromisoformat(s['date']).weekday(),[1,3])
            if s['topic_id']=='discrete':self.assertNotIn(date.fromisoformat(s['date']).weekday(),[0,3])
            for b in self.spec['blocked']:
                if b['from_date']<=s['date']<=b['to_date']:self.assertLessEqual(s['end'],'18:00')
        self.assertEqual(set(weekly.values()),{4})
        with app.database() as db:
            before=len(ai.rows(db,'tasks'));draft=ai.propose(db,app,'plan',plan,{})['draft']
            self.assertEqual(len(ai.rows(db,'tasks')),before)
            broken=deepcopy(plan);sport=next(s for s in broken['sessions'] if s['topic_id']=='sport');sport['end']=schedule.clock(app.minutes(sport['end'])-1)
            with self.assertRaisesRegex(ValueError,'连续时长'):ai.validate(db,app,'plan',broken,{})
            thursday=schedule.query(ai.context(db,app),app,'2026-09-17','2026-09-17','')['days'][0]
            self.assertEqual(len(thursday['courses']),2)
            self.assertTrue(any(w['start']<='14:00' and w['end']>='16:00' for w in thursday['free_windows']))
        ai.apply(app,draft)
        with app.database() as db:self.assertEqual(sum(bool(t.get('goal_id')) for t in ai.context(db,app)['tasks']),len(sessions))

    def test_partial_replan_preserves_done_and_outside_scope_and_deadline(self):
        spec=deepcopy(self.spec);spec['to_date']='2026-09-27'
        with app.database() as db:draft=ai.propose(db,app,'plan',self.expand(spec),{})['draft']
        ai.apply(app,draft)
        with app.database() as db:
            old=ai.context(db,app)['goals'][0];spec['goal_id']=old['id']
            db.execute("UPDATE task_meta SET done=1 WHERE task_id IN (SELECT id FROM tasks WHERE date<'2026-09-16')")
            done=[t for t in ai.context(db,app)['tasks'] if t.get('goal_id') and t.get('done')]
            outside=[t for t in ai.context(db,app)['tasks'] if t.get('goal_id') and t['date']>'2026-09-20']
        spec['from_date']='2026-09-16';spec['to_date']='2026-09-20'
        with patch.object(app,'today',return_value='2026-09-16'),patch.object(ai,'datetime') as clock:
            clock.now.return_value.strftime.return_value='07:00'
            plan=self.expand(spec)
            with app.database() as db:
                draft=ai.propose(db,app,'plan',plan,{})['draft']
                late=deepcopy(spec);late['deadline']='2026-12-21'
                with self.assertRaisesRegex(ValueError,'截止日'):ai.propose(db,app,'plan',self.expand(late),{})
            ai.apply(app,draft)
        with app.database() as db:
            active=[t for t in ai.context(db,app)['tasks'] if not t.get('superseded')]
            for t in done:self.assertIn(t,active)
            for t in outside:self.assertTrue(any(all(a[k]==t[k] for k in ['date','title','start','end','topic_id']) for a in active))
            sports=[t for t in active if t.get('goal_id') and t['topic_id']=='sport' and '2026-09-14'<=t['date']<='2026-09-20']
            self.assertEqual(len(sports),4)

    def test_insufficient_contiguous_time_has_no_partial_draft(self):
        spec=deepcopy(self.spec);spec['to_date']='2026-09-20';spec['rules']=[spec['rules'][2]];spec['windows']=[{'start':'13:00','end':'14:59'}]
        with self.assertRaisesRegex(ValueError,'120分钟×4次'):self.expand(spec)
        with app.database() as db:self.assertEqual(ai.rows(db,'proposals'),[])

    def test_official_runtime_compact_plan_keeps_earlier_requirements(self):
        spec=deepcopy(self.spec);spec['to_date']='2026-09-20'
        with app.database() as db:
            db.execute("INSERT INTO chat(role,content) VALUES ('user','每天保留英语阅读45分钟')")
            for i in range(24):db.execute('INSERT INTO chat(role,content) VALUES (?,?)',('assistant' if i%2 else 'user','后续补充'))
        calls=[]
        def provider(messages,schemas):
            calls.append(messages)
            def tool(name,args,i):return {'id':str(i),'type':'function','function':{'name':name,'arguments':json.dumps(args)}}
            if len(calls)==1:
                self.assertTrue(any('每天保留英语阅读45分钟' in (m.get('content') or '') for m in messages))
                return {'role':'assistant','content':None,'tool_calls':[tool('read_skill',{'name':'study-plan'},i) for i in range(7)]}
            if len(calls)==2:return {'role':'assistant','content':None,'tool_calls':[tool('get_schedule',{'from_date':'2026-09-14','to_date':'2026-09-20','goal_id':''},8)]}
            if len(calls)==3:return {'role':'assistant','content':None,'tool_calls':[tool('propose_scheduled_plan',spec,9)]}
            self.fail('Compact plan should use the verified local summary, not another provider reply')
        result=ai.chat(app,{'message':'普通，按已确认的要求生成'},request_fn=provider)
        self.assertEqual(result['status'],'completed');self.assertEqual(len(result['drafts']),1)
        self.assertIn('运动：4 次',result['answer']);self.assertIn('尚未写入',result['answer'])


if __name__=='__main__':unittest.main()
