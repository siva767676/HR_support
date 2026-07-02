"""Optional server-side speech-to-text via faster-whisper.

Loaded lazily so the rest of the app works when faster-whisper is not installed.
Usage: await asyncio.to_thread(transcribe_audio, audio_bytes)

Install: pip install faster-whisper
"""
from __future__ import annotations

import logging

logger = logging.getLogger(__name__)

_model = None
_load_error: Exception | None = None


def _get_model():
    global _model, _load_error
    if _model is not None:
        return _model
    if _load_error is not None:
        raise _load_error
    try:
        from faster_whisper import WhisperModel  # type: ignore[import]

        logger.info("Loading faster-whisper model 'base' (first call only)…")
        _model = WhisperModel("base", device="auto", compute_type="int8")
        logger.info("faster-whisper ready")
        return _model
    except ImportError as exc:
        _load_error = RuntimeError(
            "faster-whisper is not installed on this server. "
            "Run: pip install faster-whisper"
        )
        raise _load_error from exc
    except Exception as exc:  # noqa: BLE001
        _load_error = RuntimeError(f"Could not load faster-whisper: {exc}")
        raise _load_error from exc


def transcribe_audio(audio_bytes: bytes, language: str = "en") -> str:
    """Convert raw audio bytes to text.  Run inside asyncio.to_thread() to avoid
    blocking the event loop — Whisper inference is CPU/GPU-bound."""
    import io

    model = _get_model()
    segments, _ = model.transcribe(
        io.BytesIO(audio_bytes),
        language=language,
        beam_size=5,
        vad_filter=True,
    )
    return " ".join(s.text.strip() for s in segments).strip()
