"""Browser fixture ONLY: real app HTTP and DB, deterministic simulated model."""
from datetime import date,timedelta
from pathlib import Path
import json
import sys
import uuid
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import local_ai as ai
import local_server as app


def model(cfg,key,messages,schemas,timeout=45):
    if any(s['function']['name']=='submit_profile' for s in schemas):
        if messages[-1]['role']=='tool':return {'role':'assistant','content':'画像生成完成。'}
        body={'summary':'学习记录不足，先采用短时段安排。','preferences':[],'adjustments':['为复习预留时间'],
              'difficulty_estimates':[{'difficulty':d,'low':None,'high':None,'basis':'学习样本不足'} for d in ('简单','普通','困难')]}
        return {'role':'assistant','content':None,'tool_calls':[{'id':'profile','type':'function','function':{'name':'submit_profile','arguments':json.dumps(body)}}]}
    text=next(m['content'] for m in reversed(messages) if m['role']=='user')
    ctx=json.JSONDecoder().raw_decode(text.split('：',1)[1])[0]
    text=text.rsplit('用户本轮消息：\n',1)[-1]
    if messages[-1]['role']=='user':
        name='read_skill';args={'name':'study-plan' if text=='plan' else 'calendar-import'}
    elif messages[-1]['role']=='tool' and 'instructions' in messages[-1]['content']:
        if text=='import':name='propose_import';args={'attachment_id':ctx['attachment']['id'],'reason':'导入你上传的课表'}
        elif text=='delete':name='propose_delete_import';args={'batch_id':ctx['imports'][0]['id'],'reason':'撤销刚才误导入的课表'}
        else:
            name='propose_plan';args={'goal_id':'','title':'Python 浏览器验证','mode':'简单','deadline':(date.today()+timedelta(days=30)).isoformat(),
              'topics':[{'id':'syntax','title':'基础语法','minutes':60}],
              'sessions':[{'topic_id':'syntax','date':(date.today()+timedelta(days=29)).isoformat(),'title':'变量与数据类型','start':'22:00','end':'23:00','note':'练习变量赋值与输入输出'}],
              'reason':'保持一个月截止日，先掌握基础。'}
    else:return {'role':'assistant','content':'方案已准备好，请核对下方的日期和安排，确认后写入日历。'}
    return {'role':'assistant','content':None,'tool_calls':[{'id':uuid.uuid4().hex,'type':'function','function':{'name':name,'arguments':json.dumps(args)}}]}


if __name__=='__main__':
    app.DATA=Path('.preview')/('ai-e2e-'+uuid.uuid4().hex)
    app.initialize();ai.completion=model
    print('SIMULATED MODEL / isolated data:',app.DATA,flush=True)
    app.ThreadingHTTPServer(('127.0.0.1',8767),app.Handler).serve_forever()
