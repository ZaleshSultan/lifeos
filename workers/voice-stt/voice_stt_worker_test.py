from __future__ import annotations

import contextlib
import http.client
import importlib.util
import io
import json
import multiprocessing
import os
import signal
import socket
import sys
import tempfile
import threading
import time
import unittest
from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


SPEC = importlib.util.spec_from_file_location(
    "voice_stt_worker", Path(__file__).with_name("voice_stt_worker.py")
)
voice = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = voice
SPEC.loader.exec_module(voice)
CONFIG = voice.Config(secret="synthetic_worker_secret_1234567890")
AUDIO = b"OggS" + b"synthetic" * 8
RESULT = {"text": "Какие завтра пары?", "language": "ru", "languageProbability": 0.95,
          "durationSeconds": 2.3}


def segment(text="Какие завтра пары?", **overrides):
    return SimpleNamespace(text=text, **{
        "avg_logprob": -0.2, "no_speech_prob": 0.01, "compression_ratio": 1.1,
        **overrides,
    })


def child_reply(connection, config):
    while True:
        try:
            connection.recv()
            connection.send(RESULT)
        except EOFError:
            return


def child_hang(connection, config):
    connection.recv()
    time.sleep(30)


def shutdown_server_child(connection, root):
    class Inference:
        def transcribe(self, path, language):
            connection.send(("active", path))
            time.sleep(0.4)
            return RESULT

        def close(self):
            pass

    service = voice.VoiceService(CONFIG, Inference(), root)
    server = voice.VoiceHttpServer(("127.0.0.1", 0), service)
    # Announce the port after SIGTERM handling is installed by serve().
    def announce():
        time.sleep(0.1)
        connection.send(("ready", server.server_address))
    threading.Thread(target=announce).start()
    voice.serve(server)


class VoiceQualityTest(unittest.TestCase):
    def test_multilingual_and_explicit_language_override(self):
        for language, text in (("ru", "Какие завтра пары?"), ("kk", "Ертең қандай сабақтар?"),
                               ("en", "What classes are tomorrow?")):
            info = SimpleNamespace(language=language, language_probability=0.9)
            result = voice.validate_transcription([segment(text)], info, 2.0, "auto")
            self.assertEqual(result["text"], text)
            self.assertEqual(result["language"], language)
            info.language_probability = 0.1
            with self.assertRaisesRegex(voice.VoiceError, "voice_uncertain"):
                voice.validate_transcription([segment(text)], info, 2, "auto")
            self.assertEqual(voice.validate_transcription([segment(text)], info, 2, language)["text"], text)

    def test_reject_empty_silence_low_confidence_hallucinations_and_bounds(self):
        info = SimpleNamespace(language="ru", language_probability=0.95)
        invalid = [[], [segment("")], [segment("!")], [segment("private\x00text")],
                   [segment(avg_logprob=-1.0)], [segment(no_speech_prob=0.9)],
                   [segment(compression_ratio=2.8)], [segment(avg_logprob=float("nan"))],
                   [segment("hello world hello world hello world")],
                   [segment("aaaaaaaaaaaa")], [segment("a" * 1601)],
                   [segment("hi")] * 351]
        for segments in invalid:
            with self.subTest(segments=len(segments)):
                with self.assertRaises(voice.VoiceError):
                    voice.validate_transcription(segments, info, 2, "auto")
        for duration in (0, 0.1, float("nan")):
            with self.assertRaises(voice.VoiceError):
                voice.validate_transcription([segment()], info, duration, "auto")

    def test_unsupported_language_and_invalid_config(self):
        with self.assertRaises(voice.VoiceError):
            voice.validate_transcription([segment()], SimpleNamespace(language="de", language_probability=1), 2, "auto")
        for overrides in ({"model": "large-v3"}, {"model": "tiny.en"}, {"language": "de"},
                          {"threads": 8}, {"max_seconds": 91}, {"secret": "short"}):
            with self.assertRaises(ValueError):
                replace(CONFIG, **overrides)
        with patch.dict(os.environ, {"LIFEOS_VOICE_WORKER_SECRET": CONFIG.secret}, clear=True):
            config = voice.Config.from_env()
            self.assertEqual(config.model, "tiny")
            self.assertTrue(config.local_files_only)


class VoiceTemporaryFileTest(unittest.TestCase):
    def test_cleanup_on_success_error_and_timeout(self):
        for failure in (None, voice.VoiceError("voice_timeout"), RuntimeError("private transcript")):
            with tempfile.TemporaryDirectory() as root:
                paths = []

                class Inference:
                    def transcribe(self, path, language):
                        paths.append(path)
                        self.assertion = Path(path).read_bytes()
                        self.mode = Path(path).stat().st_mode & 0o777
                        if failure:
                            raise failure
                        return RESULT

                inference = Inference()
                service = voice.VoiceService(CONFIG, inference, root)
                if failure:
                    with self.assertRaises(type(failure)):
                        service.transcribe(AUDIO, "ru")
                else:
                    self.assertEqual(service.transcribe(AUDIO, "ru"), RESULT)
                self.assertEqual(inference.assertion, AUDIO)
                self.assertEqual(inference.mode, 0o600)
                self.assertFalse(Path(paths[0]).exists())
                self.assertEqual(list(Path(root).iterdir()), [])

    def test_reject_invalid_audio_before_creating_file_or_dispatch(self):
        class Inference:
            def transcribe(self, path, language):
                raise AssertionError("must not call")

        service = voice.VoiceService(replace(CONFIG, max_bytes=100), Inference())
        for audio, language in ((b"", "auto"), (b"bad" * 20, "auto"), (AUDIO * 10, "auto"), (AUDIO, "de")):
            with self.assertRaises(voice.VoiceError):
                service.transcribe(audio, language)


@unittest.skipUnless(importlib.util.find_spec("av") and importlib.util.find_spec("numpy"),
                     "Install worker requirements for real Ogg/Opus decoder checks")
class VoiceCodecTest(unittest.TestCase):
    def make_audio(self, path, seconds, silent=False):
        import av
        import numpy as np

        samples = int(48000 * seconds)
        waveform = np.zeros(samples, dtype=np.int16) if silent else (
            np.sin(np.arange(samples) * 2 * np.pi * 440 / 48000) * 2000
        ).astype(np.int16)
        with av.open(str(path), "w", format="ogg") as container:
            stream = container.add_stream("libopus", rate=48000)
            stream.layout = "mono"
            frame = av.AudioFrame.from_ndarray(waveform.reshape(1, -1), format="s16", layout="mono")
            frame.sample_rate = 48000
            for packet in stream.encode(frame):
                container.mux(packet)
            for packet in stream.encode(None):
                container.mux(packet)

    def test_real_ogg_opus_decode_and_actual_duration_limit(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / "synthetic.ogg"
            self.make_audio(path, 1.2)
            audio, duration = voice.decode_bounded(str(path), 2)
            self.assertAlmostEqual(duration, 1.2, places=2)
            self.assertGreater(len(audio), 16000)
            with self.assertRaisesRegex(voice.VoiceError, "voice_too_long"):
                voice.decode_bounded(str(path), 1)

    def test_real_silent_ogg_is_rejected_before_whisper(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / "silent.ogg"
            self.make_audio(path, 1.0, silent=True)
            with self.assertRaisesRegex(voice.VoiceError, "voice_empty"):
                voice.decode_bounded(str(path), 2)


@unittest.skipUnless("fork" in multiprocessing.get_all_start_methods(), "Debian process isolation")
class VoiceProcessTest(unittest.TestCase):
    def test_sigterm_finishes_active_handler_and_removes_audio(self):
        context = multiprocessing.get_context("fork")
        parent, child = context.Pipe()
        with tempfile.TemporaryDirectory() as root:
            process = context.Process(target=shutdown_server_child, args=(child, root))
            process.start()
            child.close()
            try:
                self.assertTrue(parent.poll(3))
                state, address = parent.recv()
                self.assertEqual(state, "ready")
                results = []

                def upload():
                    connection = http.client.HTTPConnection(*address, timeout=3)
                    connection.request("POST", "/transcribe", body=AUDIO, headers={
                        "Authorization": f"Bearer {CONFIG.secret}", "Content-Type": "audio/ogg",
                    })
                    response = connection.getresponse()
                    results.append((response.status, json.loads(response.read())))
                    connection.close()

                request = threading.Thread(target=upload)
                request.start()
                self.assertTrue(parent.poll(3))
                state, path = parent.recv()
                self.assertEqual(state, "active")
                self.assertTrue(Path(path).exists())
                os.kill(process.pid, signal.SIGTERM)
                process.join(4)
                request.join(4)
                self.assertFalse(process.is_alive())
                self.assertEqual(process.exitcode, 0)
                self.assertEqual(results, [(200, RESULT)])
                self.assertEqual(list(Path(root).iterdir()), [])
            finally:
                if process.is_alive():
                    process.kill()
                    process.join()
                process.close()
                parent.close()

    def test_process_reused_between_requests(self):
        inference = voice.InferenceProcess(CONFIG, context=multiprocessing.get_context("fork"), target=child_reply)
        try:
            self.assertEqual(inference.transcribe("synthetic", "ru"), RESULT)
            first_pid = inference.process.pid
            self.assertEqual(inference.transcribe("synthetic", "en"), RESULT)
            self.assertEqual(inference.process.pid, first_pid)
        finally:
            inference.close()

    def test_hard_timeout_reaps_child_and_can_restart(self):
        inference = voice.InferenceProcess(replace(CONFIG, timeout_seconds=1),
                                          context=multiprocessing.get_context("fork"), target=child_hang)
        try:
            with self.assertRaisesRegex(voice.VoiceError, "voice_timeout"):
                inference.transcribe("synthetic", "ru")
            self.assertIsNone(inference.process)
            self.assertIsNone(inference.connection)
            inference.target = child_reply
            self.assertEqual(inference.transcribe("synthetic", "ru"), RESULT)
        finally:
            inference.close()


class VoiceHttpTest(unittest.TestCase):
    def setUp(self):
        self.calls = []
        self.failure = None
        test = self

        class Inference:
            def transcribe(self, path, language):
                test.calls.append((path, language))
                if test.failure:
                    raise test.failure
                return RESULT

        self.service = voice.VoiceService(CONFIG, Inference())
        self.server = voice.VoiceHttpServer(("127.0.0.1", 0), self.service)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    def request(self, audio=AUDIO, *, headers=None, path="/transcribe"):
        connection = http.client.HTTPConnection(*self.server.server_address, timeout=3)
        try:
            connection.request("POST", path, body=audio, headers=headers or {
                "Authorization": f"Bearer {CONFIG.secret}", "Content-Type": "audio/ogg",
                "X-Voice-Language": "ru",
            })
            response = connection.getresponse()
            return response.status, json.loads(response.read())
        finally:
            connection.close()

    def test_http_contract_unicode_and_cleanup(self):
        status, result = self.request()
        self.assertEqual(status, 200)
        self.assertEqual(result, RESULT)
        path, language = self.calls[0]
        self.assertEqual(language, "ru")
        self.assertFalse(Path(path).exists())

    def test_unauthorized_rejected_before_dispatch(self):
        status, result = self.request(headers={"Content-Type": "audio/ogg"})
        self.assertEqual(status, 401)
        self.assertEqual(result, {"error": "unauthorized"})
        self.assertEqual(self.calls, [])

    def test_reject_unsupported_type_language_oversize_and_path(self):
        for headers, status in (({"Content-Type": "application/json"}, 400),
                                ({"Content-Type": "audio/ogg", "X-Voice-Language": "de"}, 400),
                                ({"Content-Type": "audio/ogg", "Content-Length": "4194305"}, 413),
                                ({"Content-Type": "audio/ogg", "Transfer-Encoding": "chunked"}, 400)):
            with self.subTest(headers=headers):
                headers["Authorization"] = f"Bearer {CONFIG.secret}"
                self.assertEqual(self.request(headers=headers)[0], status)
        self.assertEqual(self.request(path="/unknown")[0], 404)
        self.assertEqual(self.calls, [])

    def test_no_second_job_is_queued(self):
        self.service.lock.acquire()
        try:
            self.assertEqual(self.request(), (429, {"error": "voice_busy"}))
            self.assertEqual(self.calls, [])
        finally:
            self.service.lock.release()

    def test_incomplete_headers_release_connection_slots(self):
        sockets = []
        try:
            with patch.object(voice.VoiceHandler, "header_timeout_seconds", 0.05):
                for _ in range(4):
                    connection = socket.create_connection(self.server.server_address, timeout=2)
                    connection.sendall(b"POST /transcribe HTTP/1.1\r\n")
                    sockets.append(connection)
                for connection in sockets:
                    # Reading finishes once the header deadline closes the request.
                    while connection.recv(4096):
                        pass
            self.assertEqual(self.request()[0], 200)
        finally:
            for connection in sockets:
                connection.close()

    def test_failure_is_sanitized_without_logs(self):
        self.failure = RuntimeError("private transcript and token in https://private.invalid")
        output = io.StringIO()
        with contextlib.redirect_stdout(output), contextlib.redirect_stderr(output):
            status, result = self.request()
        self.assertEqual(status, 503)
        self.assertEqual(result, {"error": "voice_transcription_failed"})
        self.assertEqual(output.getvalue(), "")
        self.assertFalse(Path(self.calls[0][0]).exists())

    def test_duplicate_authorization_fails_closed(self):
        connection = http.client.HTTPConnection(*self.server.server_address, timeout=3)
        try:
            connection.putrequest("POST", "/transcribe")
            connection.putheader("Authorization", f"Bearer {CONFIG.secret}")
            connection.putheader("Authorization", f"Bearer {CONFIG.secret}")
            connection.putheader("Content-Type", "audio/ogg")
            connection.putheader("Content-Length", str(len(AUDIO)))
            connection.endheaders(AUDIO)
            response = connection.getresponse()
            self.assertEqual(response.status, 401)
            response.read()
        finally:
            connection.close()


if __name__ == "__main__":
    unittest.main()
