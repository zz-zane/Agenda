"""Local wake phrase and renewable voice sessions. No recordings on disk."""
from collections import deque
import queue
import re
import threading
import time
from pathlib import Path

import numpy as np
import sounddevice as sd
import sherpa_onnx


def make_spotter():
    root = Path(__file__).resolve().parent
    folder = root / "models/sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20"
    names = dict(tokens="tokens.txt", encoder="encoder-epoch-13-avg-2-chunk-16-left-64.int8.onnx",
                 decoder="decoder-epoch-13-avg-2-chunk-16-left-64.onnx",
                 joiner="joiner-epoch-13-avg-2-chunk-16-left-64.int8.onnx")
    if any(not (folder / name).is_file() for name in names.values()):
        raise RuntimeError("唤醒词模型缺失，请运行 setup_voice.py。")
    return sherpa_onnx.KeywordSpotter(**{k: str(folder/v) for k, v in names.items()},
                                    keywords_file=str(root / "assets/dada-keywords.txt"), num_threads=2)


def detects_wake(spotter, pcm, rate=16_000):
    stream = spotter.create_stream()
    stream.accept_waveform(rate, np.asarray(pcm, dtype=np.float32).reshape(-1) / 32768)
    stream.accept_waveform(rate, np.zeros(int(rate * .66), dtype=np.float32))
    stream.input_finished()
    while spotter.is_ready(stream):
        spotter.decode_stream(stream)
        if spotter.get_result(stream):
            return True
    return False


def wake_command(text):
    # Only the configured greeting starts a voice session.
    match = re.match(r"^你好(.*)$",
                     text.strip(), re.IGNORECASE)
    return match[1].lstrip(" ，,。.!！?？:：") if match else None


class Utterance:
    """100 ms PCM blocks; retain leading audio and endpoint after 800 ms silence."""
    def __init__(self, threshold=300):
        self.threshold = threshold
        self.reset()

    def reset(self):
        self.pre = deque(maxlen=3)
        self.frames = []
        self.silence = self.voiced = 0

    def feed(self, pcm):
        # ponytail: energy-based endpointing; use a VAD model if noisy-room tests fail.
        loud = float(np.sqrt(np.mean(pcm.astype(np.float32) ** 2))) >= self.threshold
        if not self.frames:
            self.pre.append(pcm)
            if not loud:
                return None
            self.frames = list(self.pre)
        else:
            self.frames.append(pcm)
        self.voiced += int(loud)
        self.silence = 0 if loud else self.silence + 1
        if self.silence >= 8 or len(self.frames) >= 150:
            # Never execute a truncated long utterance.
            result = np.concatenate(self.frames) if self.voiced >= 2 and len(self.frames) < 150 else None
            self.reset()
            return result
        return None


class WakeVoice:
    def __init__(self, voice, events, threshold=300):
        self.voice, self.events = voice, events
        self.segment = Utterance(threshold)
        self.audio = queue.Queue(maxsize=30)
        self.stopped = threading.Event()
        self.blocked = threading.Event()
        self.barge_mode = threading.Event()
        self.barge_hit = threading.Event()
        self.epoch = 0
        self.deadline = 0
        self.ignore_until = 0
        self.thread = threading.Thread(target=self._run, daemon=True)

    def pause(self):
        self.barge_mode.clear()
        self.blocked.set()
        self.epoch += 1
        self.deadline = 0

    def begin_barge(self):
        # ponytail: keyword-only barge-in; add playback-reference AEC if speaker echo causes false wakes.
        self.pause()
        self.barge_hit.clear()
        self.ignore_until = 0
        self.barge_mode.set()

    def check_barge(self, spotter, stream, pcm, epoch):
        stream.accept_waveform(16_000, pcm.astype(np.float32)/32768)
        while spotter.is_ready(stream):
            spotter.decode_stream(stream)
            if spotter.get_result(stream):
                if epoch == self.epoch and self.barge_mode.is_set() and not self.stopped.is_set():
                    self.barge_hit.set()
                    self.pause()
                return

    def resume(self):
        self.epoch += 1
        self.deadline = 0
        self.ignore_until = time.monotonic() + .4
        self.blocked.clear()

    def stop(self):
        self.pause()
        self.stopped.set()

    def listen_after_reply(self):
        self.resume()
        self.deadline = self.ignore_until + 10

    def emit(self, kind, payload=""):
        self.events.put((kind, (self, payload)))

    def _capture(self, data, _frames, _time, status):
        if self.stopped.is_set() or (self.blocked.is_set() and not self.barge_mode.is_set()) or time.monotonic() < self.ignore_until:
            return
        if status:
            self.epoch += 1  # Discard incomplete audio rather than acting on dropped words.
            return
        try:
            self.audio.put_nowait((self.epoch, data.copy().reshape(-1)))
        except queue.Full:
            self.epoch += 1

    def accept_text(self, text, now):
        command = wake_command(text)
        if command is not None:
            if not command:
                self.deadline = now + 10
                self.emit("wake_active")
                return
        elif self.deadline and now <= self.deadline:
            command = text.strip()
        else:
            return  # Background speech stays local and is never logged/submitted.
        if command:
            self.pause()
            self.emit("wake_command", command)

    def recognize(self, samples, spotter, epoch):
        # The capture loop expires only between utterances: finish a sentence
        # that began within the window, even if decoding crosses its deadline.
        armed = bool(self.deadline)
        if not armed and not detects_wake(spotter, samples):
            return
        text = self.voice.transcribe_samples(samples)
        if epoch != self.epoch or self.stopped.is_set() or self.blocked.is_set():
            return
        if armed:
            self.deadline = time.monotonic() + 10
        if not armed and wake_command(text) is None:
            # Phonetic wake succeeded even if ASR misspells the greeting.
            text = "你好"
        self.accept_text(text, time.monotonic())

    def _run(self):
        try:
            self.voice.check_models()
            spotter = make_spotter()
            with sd.InputStream(samplerate=16_000, blocksize=1600, channels=1,
                                dtype="int16", callback=self._capture):
                self.emit("wake_ready")
                epoch = self.epoch
                barge_stream = spotter.create_stream()
                while not self.stopped.is_set():
                    if epoch != self.epoch:
                        epoch = self.epoch
                        self.segment.reset()
                        barge_stream = spotter.create_stream()
                    if self.deadline and time.monotonic() > self.deadline and not self.segment.frames:
                        self.deadline = 0
                        self.segment.reset()
                        self.emit("wake_timeout")
                    try:
                        capture_epoch, pcm = self.audio.get(timeout=.1)
                    except queue.Empty:
                        continue
                    if capture_epoch != epoch:
                        continue
                    if self.barge_mode.is_set():
                        self.check_barge(spotter, barge_stream, pcm, epoch)
                        continue
                    if self.blocked.is_set():
                        continue
                    samples = self.segment.feed(pcm)
                    if samples is not None:
                        self.recognize(samples, spotter, epoch)
        except Exception as exc:
            if not self.stopped.is_set():
                self.emit("wake_error", str(exc))
