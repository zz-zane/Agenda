"""Reuse MiaoDesk local wake/ASR/TTS; send recognized text to Agenda only."""
from pathlib import Path
import queue
import tempfile
import threading
import time
import wave
import winsound
import re
from .local_voice import LocalVoice
from .wake_voice import WakeVoice


def opens_today(text):
    text = re.sub(r'[\s，。！？,.!?]', '', text)
    return re.fullmatch(r'(?:请|帮我|请帮我)?(?:打开|查看|看看|显示)?(?:今日|今天的?|当天)(?:待办|代办)(?:表|清单|列表)?', text) is not None


class VoiceBridge:
    def __init__(self, cat, emit):
        self.cat, self.emit = cat, emit
        self.events = queue.Queue()
        self.voice = LocalVoice()
        self.source = None
        self.session = self.busy = False
        self.speaking = False
        self.speak = True
        self.speaker = 21
        self.threshold = 300
        self.generation = 0
        self.cancel = threading.Event()

    def status(self, text):
        self.emit({'type': 'voice-status', 'text': text})

    def configure(self, value):
        if (type(value.get('enabled')) is not bool or type(value.get('speak')) is not bool
                or type(value.get('speaker')) is not int or not 0 <= value['speaker'] < 174
                or type(value.get('threshold')) is not int or not 100 <= value['threshold'] <= 3000):
            return
        restart = value['threshold'] != self.threshold
        self.speak, self.speaker, self.threshold = value['speak'], value['speaker'], value['threshold']
        if not value['enabled'] or restart: self.stop()
        if value['enabled'] and self.source is None:
            self.cancel = threading.Event()
            self.source = WakeVoice(self.voice, self.events, self.threshold)
            if self.busy: self.source.pause()
            self.status('正在打开本地麦克风…')
            self.source.thread.start()

    def stop(self):
        self.generation += 1
        self.cancel.set()
        winsound.PlaySound(None, 0)
        if self.source: self.source.stop()
        self.source = None
        self.session = False
        self.speaking = False
        self.status('麦克风已关闭')

    def working(self):
        self.busy = True
        self.cancel.set()
        winsound.PlaySound(None, 0)
        if self.source: self.source.pause()

    def reply(self, text, ok):
        self.busy = False
        self.speaking = False
        if not self.source: return
        if ok and self.speak and text: self.say(text[:4096], True)
        else: self.resume()

    def resume(self):
        if not self.source or self.busy: return
        if self.session:
            self.source.listen_after_reply()
            self.cat.behavior.enter('聆听')
            self.status('请继续说话，等待 10 秒；超时后说“你好”唤醒')
        else:
            self.source.resume()
            self.status('本地监听中，说“你好”唤醒')

    def say(self, text, interruptible=False):
        self.speaking = True
        self.cancel.set()
        cancel = self.cancel = threading.Event()
        source, generation, speaker = self.source, self.generation, self.speaker
        if source: source.pause()
        self.cat.behavior.enter('聆听')
        self.status('正在朗读…')
        def run():
            result = 'finished'
            try:
                with tempfile.TemporaryDirectory(prefix='agenda-voice-') as directory:
                    path = Path(directory) / 'reply.wav'
                    self.voice.synthesize(text, path, speaker)
                    if cancel.is_set(): return
                    with wave.open(str(path), 'rb') as audio: duration = audio.getnframes()/audio.getframerate()
                    if source and interruptible:
                        source.begin_barge()
                        self.events.put(('status', (generation, '正在朗读，说“你好”可打断')))
                    winsound.PlaySound(str(path), winsound.SND_FILENAME | winsound.SND_ASYNC)
                    deadline = time.monotonic()+duration
                    while time.monotonic() < deadline and not cancel.wait(.02):
                        if source and source.barge_hit.is_set() and interruptible:
                            result = 'barge'; break
                    winsound.PlaySound(None, 0)
            except Exception:
                result = 'speech-error'
            finally:
                if not cancel.is_set(): self.events.put((result, (generation, source)))
        threading.Thread(target=run, daemon=True).start()

    def poll(self):
        while not self.events.empty():
            kind, value = self.events.get()
            if kind.startswith('wake_'):
                source, payload = value
                if source is not self.source: continue
                if kind == 'wake_ready': self.status('本地监听中，说“你好”唤醒')
                elif kind == 'wake_active' and not self.busy:
                    self.session = True; self.say('我在')
                elif kind == 'wake_command' and not self.busy:
                    if opens_today(payload):
                        self.session = True
                        self.emit('open-today')
                        if self.speak: self.say('已打开今日待办')
                        else: self.resume()
                        continue
                    self.session = True; self.working(); self.cat.behavior.work()
                    self.emit({'type': 'voice-text', 'text': payload[:12000]})
                elif kind == 'wake_timeout':
                    self.session = False; self.cat._sleep(); self.status('等待超时，请再说“你好”')
                elif kind == 'wake_error':
                    self.stop(); self.emit({'type': 'voice-error', 'text': '语音未启动，请检查默认麦克风、系统麦克风权限和语音模型。'})
            else:
                generation, payload = value
                if generation != self.generation: continue
                if kind == 'status': self.status(payload)
                elif kind == 'barge' and payload is self.source and not self.busy:
                    self.speaking = False
                    self.session = True; self.say('我在')
                elif kind in ('finished', 'speech-error'):
                    self.speaking = False
                    self.resume()
                    if not self.source: self.cat.behavior.wake(); self.status('试听已完成')
                    if kind == 'speech-error': self.status('朗读失败，文字回复已保留。')
