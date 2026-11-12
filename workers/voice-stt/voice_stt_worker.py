"""Private, bounded Ogg/Opus -> text service. No Telegram or database credentials.

The HTTP parent owns temporary files. One persistent spawned child owns Whisper;
a hung decoder/model is killed before its temporary file is removed.
"""
from __future__ import annotations

import hmac
import json
import logging
import math
import multiprocessing
import os
import re
import signal
import socket
import tempfile
import threading
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any


LANGUAGES = frozenset(("auto", "ru", "kk", "en"))
MODELS = frozenset(("tiny", "base", "small"))
MAX_TEXT = 1500


class VoiceError(Exception):
    """Only fixed public codes may cross the process/HTTP boundary."""

    def __init__(self, code: str = "voice_transcription_failed") -> None:
        super().__init__(code)
        self.code = code


def integer_env(name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        value = int(os.environ.get(name, str(default)))
    except ValueError:
        raise ValueError(f"Invalid {name}") from None
    if not minimum <= value <= maximum:
        raise ValueError(f"Invalid {name}")
    return value


@dataclass(frozen=True)
class Config:
    secret: str
    port: int = 8091
    model: str = "tiny"
    language: str = "auto"
    threads: int = 2
    max_bytes: int = 4 * 1024 * 1024
    max_seconds: int = 90
    timeout_seconds: int = 60
    download_root: str | None = None
    local_files_only: bool = True

    def __post_init__(self) -> None:
        if not re.fullmatch(r"[A-Za-z0-9_-]{32,256}", self.secret):
            raise ValueError("Invalid LIFEOS_VOICE_WORKER_SECRET")
        if self.model not in MODELS or self.language not in LANGUAGES:
            raise ValueError("Invalid voice model or language")
        if not (1 <= self.threads <= 4 and 1 <= self.max_bytes <= 4 * 1024 * 1024
                and 1 <= self.max_seconds <= 90 and 1 <= self.timeout_seconds <= 120):
            raise ValueError("Invalid voice limits")

    @classmethod
    def from_env(cls) -> "Config":
        return cls(
            secret=os.environ.get("LIFEOS_VOICE_WORKER_SECRET", ""),
            port=integer_env("LIFEOS_VOICE_WORKER_PORT", 8091, 1024, 65535),
            model=os.environ.get("LIFEOS_VOICE_MODEL", "tiny"),
            language=os.environ.get("LIFEOS_VOICE_LANGUAGE", "auto"),
            threads=integer_env("LIFEOS_VOICE_CPU_THREADS", 2, 1, 4),
            max_bytes=integer_env("LIFEOS_VOICE_MAX_BYTES", 4 * 1024 * 1024, 1, 4 * 1024 * 1024),
            max_seconds=integer_env("LIFEOS_VOICE_MAX_SECONDS", 90, 1, 90),
            timeout_seconds=integer_env("LIFEOS_VOICE_WORKER_TIMEOUT_SECONDS", 60, 1, 120),
            download_root=os.environ.get("LIFEOS_VOICE_MODEL_CACHE") or None,
            # Download explicitly during setup, never while handling personal audio.
            local_files_only=True,
        )


def validate_transcription(segments: Any, info: Any, duration: float, language: str) -> dict:
    if not math.isfinite(duration) or duration < 0.3:
        raise VoiceError("voice_empty")
    detected = info.language
    probability = float(info.language_probability)
    if (detected not in LANGUAGES - {"auto"} or not math.isfinite(probability)
            or not 0 <= probability <= 1
            or (language == "auto" and probability < 0.55)):
        raise VoiceError("voice_uncertain")
    parts: list[str] = []
    for index, segment in enumerate(segments):
        if index >= 350:
            raise VoiceError("voice_uncertain")
        scores = (segment.avg_logprob, segment.no_speech_prob, segment.compression_ratio)
        if (not all(math.isfinite(float(score)) for score in scores)
                or segment.avg_logprob < -0.8 or segment.no_speech_prob > 0.6
                or segment.compression_ratio > 2.4):
            raise VoiceError("voice_uncertain")
        text = segment.text.strip()
        if text:
            parts.append(text)
        if sum(map(len, parts)) + len(parts) > MAX_TEXT:
            raise VoiceError("voice_uncertain")
    text = " ".join(parts).strip()
    if (sum(character.isalnum() for character in text) < 2
            or re.search(r"[\x00-\x1f\x7f]", text)):
        raise VoiceError("voice_empty")
    words = re.findall(r"\w+", text.casefold())
    if any(words[i:i + 2] * 3 == words[i:i + 6] for i in range(len(words) - 5)):
        raise VoiceError("voice_uncertain")
    if re.search(r"(.)\1{9,}", text):
        raise VoiceError("voice_uncertain")
    return {"text": text, "language": detected, "languageProbability": probability,
            "durationSeconds": round(duration, 3)}


def decode_bounded(path: str, max_seconds: int):
    """Decode incrementally: container metadata cannot bypass the duration cap."""
    import av
    import numpy as np

    chunks = []
    samples = 0
    max_samples = max_seconds * 16000
    resampler = av.AudioResampler(format="flt", layout="mono", rate=16000)
    with av.open(path, mode="r") as container:
        if (len(container.streams.audio) != 1 or container.streams.video
                or container.streams.audio[0].codec_context.name != "opus"
                or "ogg" not in container.format.name):
            raise VoiceError("voice_unsupported")
        for index, frame in enumerate(container.decode(audio=0)):
            if index >= 50000:
                raise VoiceError("voice_too_long")
            frame.pts = None
            for output in resampler.resample(frame):
                samples += output.samples
                if samples > max_samples:
                    raise VoiceError("voice_too_long")
                chunks.append(output.to_ndarray().reshape(-1))
        for output in resampler.resample(None):
            samples += output.samples
            if samples > max_samples:
                raise VoiceError("voice_too_long")
            chunks.append(output.to_ndarray().reshape(-1))
    if samples < 4800:
        raise VoiceError("voice_empty")
    audio = np.concatenate(chunks)
    if not np.isfinite(audio).all() or float(np.sqrt(np.mean(audio * audio))) < 0.0001:
        raise VoiceError("voice_empty")
    return audio, samples / 16000


def model_child(connection, config: Config) -> None:
    # Third-party native libraries must not print personal input or exceptions.
    null_fd = os.open(os.devnull, os.O_WRONLY)
    os.dup2(null_fd, 1)
    os.dup2(null_fd, 2)
    os.close(null_fd)
    logging.disable(logging.CRITICAL)
    os.environ["OMP_NUM_THREADS"] = str(config.threads)
    os.environ["OPENBLAS_NUM_THREADS"] = "1"
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
    model = None
    while True:
        try:
            path, language = connection.recv()
        except EOFError:
            return
        try:
            if model is None:
                from faster_whisper import WhisperModel
                model = WhisperModel(config.model, device="cpu", compute_type="int8",
                                     cpu_threads=config.threads, num_workers=1,
                                     download_root=config.download_root,
                                     local_files_only=config.local_files_only)
            audio, duration = decode_bounded(path, config.max_seconds)
            segments, info = model.transcribe(
                audio, language=None if language == "auto" else language,
                task="transcribe", beam_size=1, best_of=1, temperature=0,
                vad_filter=True, vad_parameters={"min_silence_duration_ms": 300},
                condition_on_previous_text=False, word_timestamps=False,
                max_new_tokens=256,
            )
            result = validate_transcription(segments, info, duration, language)
        except VoiceError as error:
            result = {"error": error.code}
        except Exception:
            result = {"error": "voice_transcription_failed"}
        try:
            connection.send(result)
        except (BrokenPipeError, EOFError, OSError):
            return


class InferenceProcess:
    def __init__(self, config: Config, *, context=None, target=model_child) -> None:
        self.config = config
        self.context = context or multiprocessing.get_context("spawn")
        self.target = target
        self.process = None
        self.connection = None

    def _start(self) -> None:
        self.connection, child = self.context.Pipe()
        self.process = self.context.Process(target=self.target, args=(child, self.config), daemon=True)
        self.process.start()
        child.close()

    def transcribe(self, path: str, language: str) -> dict:
        if self.process is None or not self.process.is_alive():
            self.close()
            self._start()
        try:
            self.connection.send((path, language))
            if not self.connection.poll(self.config.timeout_seconds):
                self.close()
                raise VoiceError("voice_timeout")
            result = self.connection.recv()
            if "error" in result:
                raise VoiceError(result["error"])
            return result
        except (EOFError, BrokenPipeError, OSError):
            self.close()
            raise VoiceError() from None

    def close(self) -> None:
        if self.process is not None:
            if self.process.is_alive():
                self.process.terminate()
                self.process.join(1)
                if self.process.is_alive():
                    self.process.kill()
            self.process.join()
            self.process.close()
        if self.connection is not None:
            self.connection.close()
        self.process = self.connection = None


class VoiceService:
    def __init__(self, config: Config, inference=None, temp_root: str | None = None) -> None:
        self.config = config
        self.inference = inference or InferenceProcess(config)
        self.lock = threading.Lock()
        self.temp_root = temp_root

    def transcribe(self, audio: bytes, language: str) -> dict:
        if language not in LANGUAGES:
            raise VoiceError("voice_unsupported_language")
        if len(audio) > self.config.max_bytes:
            raise VoiceError("voice_too_large")
        if len(audio) < 47 or not audio.startswith(b"OggS"):
            raise VoiceError("voice_unsupported")
        # Parent always removes the file, even when decoder/model is killed.
        with tempfile.TemporaryDirectory(prefix="lifeos-voice-", dir=self.temp_root) as directory:
            path = Path(directory) / "audio.ogg"
            descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(descriptor, "wb") as output:
                output.write(audio)
            return self.inference.transcribe(str(path), language)


class VoiceHttpServer(ThreadingHTTPServer):
    # server_close waits for active handlers, which own temporary directories.
    daemon_threads = False
    block_on_close = True
    request_queue_size = 4

    def __init__(self, address, service: VoiceService) -> None:
        self.service = service
        self.slots = threading.BoundedSemaphore(4)
        super().__init__(address, VoiceHandler)

    def process_request(self, request, client_address) -> None:
        if not self.slots.acquire(blocking=False):
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)
        except Exception:
            self.slots.release()
            raise

    def process_request_thread(self, request, client_address) -> None:
        try:
            super().process_request_thread(request, client_address)
        finally:
            self.slots.release()

    def handle_error(self, request, client_address) -> None:
        # BaseServer otherwise prints tracebacks with caller-controlled input.
        pass


class VoiceHandler(BaseHTTPRequestHandler):
    server_version = "LifeOSVoice"
    header_timeout_seconds = 10

    def setup(self) -> None:
        super().setup()
        self.connection.settimeout(self.header_timeout_seconds)
        # Bound incomplete/trickling headers before authentication as well.
        def stop_headers() -> None:
            try:
                self.connection.shutdown(socket.SHUT_RD)
            except OSError:
                pass
        self.header_timer = threading.Timer(self.header_timeout_seconds, stop_headers)
        self.header_timer.daemon = True
        self.header_timer.start()

    def finish(self) -> None:
        self.header_timer.cancel()
        super().finish()

    def log_message(self, format, *args) -> None:
        pass

    def reply(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.close_connection = True
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self) -> None:
        self.header_timer.cancel()
        service = self.server.service
        if self.path != "/transcribe":
            self.reply(404, {"error": "not_found"})
            return
        headers = self.headers.get_all("Authorization", [])
        if (len(headers) != 1 or not hmac.compare_digest(
                headers[0].encode("utf-8"), f"Bearer {service.config.secret}".encode("ascii"))):
            self.reply(401, {"error": "unauthorized"})
            return
        lengths = self.headers.get_all("Content-Length", [])
        content_types = self.headers.get_all("Content-Type", [])
        if (self.headers.get("Transfer-Encoding") is not None or len(lengths) != 1
                or not re.fullmatch(r"[0-9]{1,9}", lengths[0])
                or len(content_types) != 1 or content_types[0].split(";")[0].lower() != "audio/ogg"):
            self.reply(400, {"error": "voice_unsupported"})
            return
        size = int(lengths[0])
        if not 47 <= size <= service.config.max_bytes:
            self.reply(413, {"error": "voice_too_large"})
            return
        languages = self.headers.get_all("X-Voice-Language", [])
        language = languages[0] if languages else service.config.language
        if len(languages) > 1 or language not in LANGUAGES:
            self.reply(400, {"error": "voice_unsupported_language"})
            return
        if not service.lock.acquire(blocking=False):
            self.reply(429, {"error": "voice_busy"})
            return
        timer = None
        try:
            # A total upload deadline also covers slow trickles between socket reads.
            def stop_upload() -> None:
                try:
                    self.connection.shutdown(socket.SHUT_RD)
                except OSError:
                    pass
            timer = threading.Timer(10, stop_upload)
            timer.daemon = True
            timer.start()
            self.connection.settimeout(10)
            audio = self.rfile.read(size)
            timer.cancel()
            if len(audio) != size:
                raise VoiceError("voice_download_failed")
            result = service.transcribe(audio, language)
            self.reply(200, result)
        except VoiceError as error:
            self.reply(504 if error.code == "voice_timeout" else 422, {"error": error.code})
        except Exception:
            self.reply(503, {"error": "voice_transcription_failed"})
        finally:
            if timer is not None:
                timer.cancel()
            service.lock.release()


def serve(server: VoiceHttpServer) -> None:
    def stop(_signum, _frame) -> None:
        # shutdown must run outside the serve_forever thread.
        threading.Thread(target=server.shutdown, daemon=True).start()

    previous_handlers = {number: signal.signal(number, stop)
                         for number in (signal.SIGINT, signal.SIGTERM)}
    try:
        server.serve_forever()
    finally:
        # Handler threads finish/timeout and remove files before child teardown.
        server.server_close()
        server.service.inference.close()
        for number, handler in previous_handlers.items():
            signal.signal(number, handler)


def main() -> None:
    logging.disable(logging.CRITICAL)
    config = Config.from_env()
    service = VoiceService(config)
    serve(VoiceHttpServer(("127.0.0.1", config.port), service))


if __name__ == "__main__":
    main()
