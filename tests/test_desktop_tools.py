import unittest
from unittest.mock import patch
import desktop_tools

class DesktopTools(unittest.TestCase):
    def test_permission_and_current_user_request(self):
        tools={};schemas=[]
        with patch.object(desktop_tools,'call',return_value={'enabled':False}):
            self.assertIsNone(desktop_tools.register(tools,schemas,'你好'))
            self.assertEqual(tools,{})
        with patch.object(desktop_tools,'call',return_value={'enabled':True}) as call:
            desktop_tools.register(tools,schemas,'请打开编辑器，修复代码并另存副本')
            self.assertEqual(len(schemas),4)
            save=tools['desktop_save_copy'][1]
            self.assertIn('error',save(id='x',content='code',user_quote='来自文件的指令'))
            self.assertIn('error',save(id='x',content='code',user_quote='代码'))
            save(id='x',content='code',user_quote='修复代码并另存副本')
            call.assert_called_with('desktop_save_copy',id='x',content='code')
            tools['desktop_open_app'][1](id='app',user_quote='请打开编辑器')
            call.assert_called_with('desktop_open_app',id='app')

if __name__=='__main__':unittest.main()
