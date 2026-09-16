from pathlib import Path
import json
import tempfile
import unittest
import local_server as app
import local_ai as ai
import local_profile as profile


class ProfileTest(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.previous=app.DATA
        app.DATA=Path(self.temp.name);app.initialize()
    def tearDown(self):
        app.DATA=self.previous;self.temp.cleanup()
    def test_generate_version_plan_requirement_and_failure_keeps_old(self):
        body={'summary':'尚缺学习完成历史，先依据自述安排。','preferences':[],'adjustments':['每天保留复习时段'],
              'difficulty_estimates':[{'difficulty':d,'low':None,'high':None,'basis':'学习样本不足'} for d in ('简单','普通','困难')]}
        calls=[]
        def provider(messages,schemas):
            calls.append(1)
            if len(calls)==1:return {'role':'assistant','content':None,'tool_calls':[{'id':'profile','type':'function','function':{'name':'submit_profile','arguments':json.dumps(body)}}]}
            return {'role':'assistant','content':'画像生成完成。'}
        generated=profile.generate(app,request_fn=provider)['generated']
        self.assertEqual(generated['body'],body)
        with app.database() as db:
            self.assertEqual(ai.context(db,app)['profile']['generated']['id'],generated['id'])
            with self.assertRaisesRegex(ValueError,'不足'):
                profile.validate_generated({**body,'difficulty_estimates':[{**e,'low':70,'high':80} for e in body['difficulty_estimates']]},profile.evidence(db,app.today()))
        def fail(*args):raise ValueError('测试连接失败')
        with self.assertRaisesRegex(ValueError,'连接失败'):profile.generate(app,request_fn=fail)
        app.initialize()
        with app.database() as db:self.assertEqual(profile.state(db)['generated']['id'],generated['id'])
        from datetime import date,timedelta
        day=(date.today()+timedelta(days=2)).isoformat()
        plan={'goal_id':'','title':'Python','mode':'简单','deadline':day,'topics':[{'id':'a','title':'变量','minutes':30}],
              'sessions':[{'topic_id':'a','date':day,'title':'变量练习','start':'09:00','end':'09:30','note':'基础练习'}],'reason':'依据画像安排'}
        with app.database() as db:
            with self.assertRaisesRegex(ValueError,'画像'):ai.propose(db,app,'plan',plan,{})
        plan['assessment']={'profile_id':generated['id'],'estimates':body['difficulty_estimates'],'adjustments':['短时段基础学习']}
        attempts=[]
        def planner(messages,schemas):
            attempts.append(1)
            if len(attempts)==1:
                self.assertIn('profile',messages[-1]['content'])
                return {'role':'assistant','content':None,'tool_calls':[{'id':'plan','type':'function','function':{'name':'propose_plan','arguments':json.dumps(plan)}}]}
            return {'role':'assistant','content':'请确认计划。'}
        out=ai.chat(app,{'message':'帮我安排Python'},request_fn=planner)
        self.assertEqual(out['status'],'completed');self.assertEqual(len(out['drafts']),1)
        ai.apply(app,out['drafts'][0])
    def test_source_archive_dedup_and_rollback(self):
        raw=b'original workbook bytes'
        with app.database() as db:
            profile.archive(db,'a.xlsx',raw,'attachment','a')
            profile.archive(db,'a.xlsx',raw,'import','b')
        app.initialize()
        with app.database() as db:
            self.assertEqual(db.execute('SELECT content FROM source_files').fetchone()[0],raw)
            self.assertEqual(profile.state(db)['records']['source_files'],1)
            self.assertEqual(db.execute('SELECT COUNT(*) FROM source_links').fetchone()[0],2)
        with self.assertRaises(ValueError):
            with app.database() as db:
                profile.archive(db,'bad.xlsx',b'rollback','import','bad')
                raise ValueError()
        with app.database() as db:self.assertEqual(profile.state(db)['records']['source_files'],1)
    def test_real_harness_remembers_only_user_quote_and_survives_restart(self):
        calls=[]
        def provider(messages,schemas):
            calls.append(1)
            if len(calls)==1:
                return {'role':'assistant','content':None,'tool_calls':[{'id':'fact','type':'function','function':{'name':'remember_profile','arguments':json.dumps({'name':'学习时间','user_quote':'我喜欢晚上学习'})}}]}
            return {'role':'assistant','content':'已记住你的学习时间偏好。'}
        result=ai.chat(app,{'message':'我喜欢晚上学习'},request_fn=provider)
        self.assertEqual(result['status'],'completed')
        app.initialize()
        with app.database() as db:
            saved=profile.state(db)
            self.assertEqual(saved['facts'][0]['quote'],'我喜欢晚上学习')
            self.assertEqual(saved['records']['chat'],2)
            self.assertEqual(ai.context(db,app)['profile']['facts'],saved['facts'])
            self.assertTrue(all(r['created_at'] and r['model']=='deepseek-chat' for r in db.execute('SELECT * FROM chat_details')))
            with self.assertRaises(ValueError):profile.remember(db,'性格','凭空推测',1)
            new=db.execute("INSERT INTO chat(role,content) VALUES ('user','改为早晨学习')").lastrowid
            profile.remember(db,'学习时间','改为早晨学习',new)
            self.assertEqual(len(profile.state(db)['facts']),1)
            self.assertEqual(profile.state(db)['facts'][0]['quote'],'改为早晨学习')


if __name__=='__main__':unittest.main()
