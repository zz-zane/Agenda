"""Local Chinese speech recognition and synthesis; no cloud credentials."""
from pathlib import Path
import threading
import wave

import numpy as np
import sherpa_onnx

MODELS = Path(__file__).resolve().parent / "models"


class LocalVoice:
    def __init__(self):
        self.recognizer = None
        self.tts = None
        self.lock = threading.Lock()

    def check_models(self):
        for name in ("sensevoice/model.int8.onnx", "sensevoice/tokens.txt", "vits-icefall-zh-aishell3/model.onnx", "vits-icefall-zh-aishell3/tokens.txt", "vits-icefall-zh-aishell3/lexicon.txt"):
            if not (MODELS / name).is_file():
                raise RuntimeError("本地语音模型未安装完整，请运行 setup_voice.py。")

    def transcribe(self, path):
        with wave.open(str(path), "rb") as wav:
            if wav.getsampwidth() != 2 or wav.getnchannels() != 1:
                raise ValueError("识别需要单声道 16 位 WAV。")
            rate = wav.getframerate()
            samples = np.frombuffer(wav.readframes(wav.getnframes()), dtype=np.int16)
        return self.transcribe_samples(samples, rate)

    def transcribe_samples(self, samples, rate=16_000):
        self.check_models()
        with self.lock:
            if self.recognizer is None:
                folder = MODELS / "sensevoice"
                self.recognizer = sherpa_onnx.OfflineRecognizer.from_sense_voice(
                    model=str(folder / "model.int8.onnx"), tokens=str(folder / "tokens.txt"),
                    num_threads=2, language="zh", use_itn=True)
            stream = self.recognizer.create_stream()
            stream.accept_waveform(rate, np.asarray(samples, dtype=np.float32).reshape(-1) / 32768)
            self.recognizer.decode_stream(stream)
            return stream.result.text.strip()

    def synthesize(self, text, path, speaker_id=21):
        if isinstance(speaker_id, bool) or not isinstance(speaker_id, int) or not 0 <= speaker_id < 174:
            raise ValueError("本地音色编号必须为 0–173 的整数。")
        self.check_models()
        with self.lock:
            if self.tts is None:
                folder = MODELS / "vits-icefall-zh-aishell3"
                config = sherpa_onnx.OfflineTtsConfig(
                    model=sherpa_onnx.OfflineTtsModelConfig(
                        vits=sherpa_onnx.OfflineTtsVitsModelConfig(model=str(folder / "model.onnx"),
                            tokens=str(folder / "tokens.txt"), lexicon=str(folder / "lexicon.txt")),
                        num_threads=2, provider="cpu"),
                    rule_fsts=",".join(str(folder / name) for name in ("phone.fst", "date.fst", "number.fst")))
                self.tts = sherpa_onnx.OfflineTts(config)
            audio = self.tts.generate(text, sid=speaker_id, speed=1.0)
            if not len(audio.samples):
                raise RuntimeError("未生成语音，请尝试中文文本。")
            pcm = (np.clip(audio.samples, -1, 1) * 32767).astype(np.int16)
            with wave.open(str(path), "wb") as wav:
                wav.setnchannels(1)
                wav.setsampwidth(2)
                wav.setframerate(audio.sample_rate)
                wav.writeframes(pcm.tobytes())
