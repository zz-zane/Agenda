import unittest
from unittest.mock import MagicMock, patch
import numpy as np
from agenda_pet.voice_bridge import VoiceBridge, opens_today
from agenda_pet.wake_voice import WakeVoice, wake_command


class VoiceChecks(unittest.TestCase):
    def test_today_command_is_local_and_not_sent_to_model(self):
        for text in ['打开今日待办表','请帮我打开今天的待办清单','查看今日代办']:
            self.assertTrue(opens_today(text))
        self.assertFalse(opens_today('删除今日待办'))
        events=[]; bridge=VoiceBridge(MagicMock(),events.append)
        source=MagicMock();bridge.source=source;bridge.speak=False
        bridge.events.put(('wake_command',(source,'打开今日待办表')))
        bridge.poll()
        self.assertIn('open-today',events)
        self.assertFalse(any(isinstance(e,dict) and e['type']=='voice-text' for e in events))
        source.listen_after_reply.assert_called_once()

    def test_local_wake_to_agenda_and_disabled_cleanup(self):
        events=[]; cat=MagicMock()
        bridge=VoiceBridge(cat,events.append)
        with patch('agenda_pet.voice_bridge.WakeVoice') as factory, patch('agenda_pet.voice_bridge.winsound.PlaySound'):
            source=factory.return_value
            bridge.configure({'enabled':True,'speak':False,'speaker':21,'threshold':300})
            source.thread.start.assert_called_once()
            bridge.events.put(('wake_command',(source,'安排明天的学习')))
            bridge.poll()
            self.assertTrue(bridge.busy)
            self.assertIn({'type':'voice-text','text':'安排明天的学习'},events)
            source.pause.assert_called()
            bridge.reply('已生成预览',True)
            source.listen_after_reply.assert_called_once()
            bridge.stop();source.stop.assert_called_once()
            before=len(events)
            bridge.events.put(('wake_command',(source,'过期指令')));bridge.poll()
            self.assertEqual(len(events),before)

    def test_barge_in_does_not_submit_a_command(self):
        bridge=VoiceBridge(MagicMock(),MagicMock())
        source=WakeVoice(MagicMock(),bridge.events)
        source.begin_barge()
        spotter=MagicMock();spotter.get_result.return_value='你好'
        source.check_barge(spotter,MagicMock(),np.zeros(1600,dtype=np.int16),source.epoch)
        self.assertTrue(source.barge_hit.is_set())
        self.assertTrue(source.blocked.is_set())
        self.assertTrue(bridge.events.empty())
        source.voice.transcribe_samples.assert_not_called()
        self.assertEqual(wake_command('你好，安排学习'),'安排学习')
        self.assertIsNone(wake_command('背景里的普通讲话'))


if __name__=='__main__': unittest.main()
