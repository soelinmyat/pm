---
type: backlog-issue
id: "PM-113"
title: "Faster-whisper transcription script with speaker diarization"
outcome: "Plugin ships a Python script that transcribes any audio file to diarized text locally"
status: approved
parent: "audio-transcription-ingest"
children: []
labels:
  - "ingest"
  - "audio"
  - "infrastructure"
priority: medium
research_refs: []
created: 2026-04-02
updated: 2026-04-02
---

## Outcome

A bundled Python script takes an audio file path and outputs a diarized transcript (Speaker A/B labeled). Any plugin skill or user can call it directly. Runs fully offline after initial model download.

## Acceptance Criteria

1. `scripts/transcribe.py` accepts an audio file path and outputs transcript to stdout or a specified output path.
2. Output format: timestamped lines with speaker labels (e.g., `[00:01:23] Speaker A: ...`).
3. Uses faster-whisper (CTranslate2 backend) for transcription.
4. Uses pyannote.audio for speaker diarization (Speaker A, Speaker B, etc.).
5. `scripts/requirements.txt` lists: `faster-whisper`, `pyannote.audio`, `torch`.
6. Graceful error if dependencies not installed — clear message with install instructions.
7. Supports: `.mp3`, `.wav`, `.m4a`, `.ogg`, `.flac`, `.webm`.
8. Default model: `base` (fast, ~150MB). Configurable via `--model` flag.
9. Exit code 0 on success, non-zero on failure with stderr message.

## Technical Feasibility

- **Build new.** No existing Python infrastructure in the plugin.
- **Dependencies:** faster-whisper, pyannote.audio, torch. torch is large (~2GB) but required by pyannote.
- **pyannote setup:** Requires HuggingFace token and license acceptance for `pyannote/speaker-diarization-3.1`. Document in script help text.
- **ffmpeg:** faster-whisper needs ffmpeg for non-wav formats. Available via `brew install ffmpeg`.

## Notes

- Consider a `--no-diarize` flag for quick transcription without speaker separation.
- torch can use CPU-only variant (`torch` without CUDA) to reduce install size on Mac.
- Metal/MPS acceleration available on Apple Silicon for faster inference.
