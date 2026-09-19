"""Real pinned DSH process, bounded scripted provider; no production data."""
import time
import unittest
from dsh_bridge import run


class DSHTest(unittest.TestCase):
    def test_loop_budget_and_no_extra_tools(self):
        requests=[];calls=[]
        def provider(messages):
            requests.append(messages)
            return {'role':'assistant','content':None,'tool_calls':[{'id':str(len(requests)),'type':'function','function':{'name':'read_skill','arguments':'{"name":"study-plan"}'}}]}
        out=run([{'role':'system','content':'Use only Agenda tools.'},{'role':'user','content':'plan'}],provider,
                {'read_skill':({'name':str},lambda **args:calls.append(args) or {'instructions':'test'})},max_calls=2)
        self.assertEqual(out['status'],'max_calls')
        self.assertEqual(len(requests),2);self.assertEqual(len(calls),2)

    def test_duplicate_arguments_rejected_before_tool(self):
        calls=[]
        def provider(messages):
            return {'role':'assistant','content':None,'tool_calls':[{'id':'bad','type':'function','function':{'name':'read_skill','arguments':'{"name":"a","name":"b"}'}}]}
        out=run([{'role':'system','content':'Agenda'},{'role':'user','content':'test'}],provider,
                {'read_skill':({'name':str},lambda **args:calls.append(args))})
        self.assertEqual(out['status'],'model_error');self.assertEqual(calls,[])

    def test_cancel_slow_model_does_not_call_tool(self):
        calls=[]
        def provider(messages):
            time.sleep(2)
            return {'role':'assistant','content':None,'tool_calls':[{'id':'late','type':'function','function':{'name':'read_skill','arguments':'{"name":"x"}'}}]}
        started=time.monotonic()
        out=run([{'role':'system','content':'Agenda'},{'role':'user','content':'test'}],provider,
                {'read_skill':({'name':str},lambda **args:calls.append(args))},timeout=1.5)
        self.assertEqual(out['status'],'cancelled');self.assertLess(time.monotonic()-started,3)
        time.sleep(1);self.assertEqual(calls,[])


if __name__=='__main__': unittest.main()
