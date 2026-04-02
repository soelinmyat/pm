# Plan: PM-113 — Faster-whisper transcription script with speaker diarization

## Goal

Ship `scripts/transcribe.py` — a CLI that transcribes any audio file to diarized, timestamped text using faster-whisper + pyannote.audio locally.

## Architecture

```
audio file ──► transcribe.py ──► faster-whisper (CTranslate2) ──► raw segments
                    │                                                   │
                    └──► pyannote.audio (diarization) ──► speaker map ──┘
                                                                        │
                                                              merge + format
                                                                        │
                                                              stdout / --output file
```

Single-file script. No package, no server. Dependencies listed in `scripts/requirements.txt`.

## Tech Stack

- Python 3.10+ (system or venv)
- faster-whisper (CTranslate2 backend)
- pyannote.audio (speaker diarization)
- torch (CPU-only on Mac is fine)
- ffmpeg (system dependency for non-wav formats)

## Contract

```
# Basic usage — stdout
python scripts/transcribe.py meeting.mp3

# Output to file
python scripts/transcribe.py meeting.mp3 --output transcript.txt

# Custom model
python scripts/transcribe.py meeting.mp3 --model large-v3

# Skip diarization (faster)
python scripts/transcribe.py meeting.mp3 --no-diarize

# HuggingFace token for pyannote (required for diarization)
HF_TOKEN=hf_xxx python scripts/transcribe.py meeting.mp3
```

Output format (with diarization):
```
[00:00:02] Speaker A: Welcome everyone to the standup.
[00:00:08] Speaker B: Thanks. I worked on the API refactor yesterday.
```

Output format (without diarization / `--no-diarize`):
```
[00:00:02] Welcome everyone to the standup.
[00:00:08] Thanks. I worked on the API refactor yesterday.
```

Exit codes: 0 success, 1 failure (stderr message).

### Done

- [ ] `scripts/transcribe.py` accepts audio file, outputs timestamped transcript
- [ ] Speaker diarization with labels (Speaker A, Speaker B, ...)
- [ ] `--output`, `--model`, `--no-diarize` flags work
- [ ] `scripts/requirements.txt` lists all Python deps
- [ ] Graceful error on missing deps with install instructions
- [ ] Supports .mp3, .wav, .m4a, .ogg, .flac, .webm
- [ ] Exit 0 on success, non-zero on failure
- [ ] Tests pass: `python -m pytest tests/test_transcribe.py -v`

## Files in Scope

| File | Change |
|------|--------|
| `scripts/transcribe.py` | New — transcription CLI script |
| `scripts/requirements.txt` | New — Python dependencies |
| `tests/test_transcribe.py` | New — unit tests (mocked heavy deps) |

---

## Tasks

### Task 1: Create requirements.txt

Create `scripts/requirements.txt` with the Python dependencies.

**File:** `scripts/requirements.txt`

```
faster-whisper>=1.0.0
pyannote.audio>=3.1
torch>=2.0
```

**Verify:**
```bash
cat scripts/requirements.txt
# Expected: 3 lines listing faster-whisper, pyannote.audio, torch
```

---

### Task 2: Write failing tests — CLI argument parsing

Create `tests/test_transcribe.py` with tests that verify CLI argument parsing. These tests mock the heavy dependencies and test the argument parser only.

**File:** `tests/test_transcribe.py`

```python
"""Tests for scripts/transcribe.py — mocks heavy deps, tests CLI contract."""

import subprocess
import sys
import os
import re
import tempfile

SCRIPT = os.path.join(os.path.dirname(__file__), '..', 'scripts', 'transcribe.py')


def run_transcribe(*args, env_override=None):
    """Run transcribe.py as a subprocess and return (returncode, stdout, stderr)."""
    env = os.environ.copy()
    if env_override:
        env.update(env_override)
    result = subprocess.run(
        [sys.executable, SCRIPT, *args],
        capture_output=True, text=True, env=env, timeout=30
    )
    return result.returncode, result.stdout, result.stderr


class TestCLIArguments:
    """Test argument parsing and validation — no model loading needed."""

    def test_no_args_prints_usage_and_fails(self):
        code, stdout, stderr = run_transcribe()
        assert code != 0
        assert 'usage' in stderr.lower() or 'error' in stderr.lower()

    def test_nonexistent_file_fails(self):
        code, stdout, stderr = run_transcribe('/tmp/no_such_file_abc123.mp3')
        assert code != 0
        assert 'not found' in stderr.lower() or 'no such file' in stderr.lower() or 'does not exist' in stderr.lower()

    def test_unsupported_format_fails(self):
        with tempfile.NamedTemporaryFile(suffix='.txt', delete=False) as f:
            f.write(b'not audio')
            tmp = f.name
        try:
            code, stdout, stderr = run_transcribe(tmp)
            assert code != 0
            assert 'unsupported' in stderr.lower() or 'format' in stderr.lower()
        finally:
            os.unlink(tmp)

    def test_help_flag(self):
        code, stdout, stderr = run_transcribe('--help')
        assert code == 0
        assert '--model' in stdout
        assert '--output' in stdout
        assert '--no-diarize' in stdout

    def test_supported_extensions_listed_in_help(self):
        code, stdout, stderr = run_transcribe('--help')
        for ext in ['mp3', 'wav', 'm4a', 'ogg', 'flac', 'webm']:
            assert ext in stdout.lower(), f'Extension {ext} not in help text'


class TestMissingDependencies:
    """Test graceful error when heavy deps are not installed.

    These tests use a subprocess with modified PYTHONPATH to simulate
    import failures. We create a shim that raises ImportError.
    """

    def test_missing_faster_whisper_shows_install_instructions(self):
        # Create a fake module that raises ImportError
        with tempfile.TemporaryDirectory() as tmpdir:
            shim = os.path.join(tmpdir, 'faster_whisper.py')
            with open(shim, 'w') as f:
                f.write('raise ImportError("No module named faster_whisper")\n')
            env = {'PYTHONPATH': tmpdir + ':' + os.environ.get('PYTHONPATH', '')}
            # Create a dummy audio file
            dummy = os.path.join(tmpdir, 'test.wav')
            with open(dummy, 'wb') as f:
                f.write(b'\x00' * 100)
            code, stdout, stderr = run_transcribe(dummy, env_override=env)
            assert code != 0
            assert 'pip install' in stderr.lower() or 'requirements.txt' in stderr.lower()


class TestOutputFormat:
    """Test output format matches contract.

    Uses regex to validate timestamp + speaker label format.
    """

    def test_timestamp_format_regex(self):
        """Verify the timestamp pattern used in output."""
        pattern = r'^\[\d{2}:\d{2}:\d{2}\] (Speaker [A-Z]: )?.+'
        # Valid lines
        assert re.match(pattern, '[00:01:23] Speaker A: Hello world')
        assert re.match(pattern, '[00:00:02] Welcome everyone')
        # Invalid lines
        assert not re.match(pattern, '00:01:23 Speaker A: missing brackets')
        assert not re.match(pattern, '[1:2:3] bad timestamp format')
```

**Verify (tests should fail because transcribe.py doesn't exist yet):**
```bash
cd /Users/soelinmyat/Projects/pm && python -m pytest tests/test_transcribe.py -v 2>&1 | head -20
# Expected: ERRORS or FAILED — script not found
```

---

### Task 3: Implement transcribe.py — argument parsing and validation

Create the script with argument parsing, file validation, and supported format checking. Does not yet do transcription.

**File:** `scripts/transcribe.py`

```python
#!/usr/bin/env python3
"""Transcribe audio files to timestamped, speaker-diarized text.

Uses faster-whisper (CTranslate2) for transcription and pyannote.audio
for speaker diarization.

Usage:
    python transcribe.py <audio_file> [--output PATH] [--model MODEL] [--no-diarize]

Supported formats: .mp3, .wav, .m4a, .ogg, .flac, .webm
"""

import argparse
import os
import sys

SUPPORTED_EXTENSIONS = {'.mp3', '.wav', '.m4a', '.ogg', '.flac', '.webm'}
DEFAULT_MODEL = 'base'


def parse_args(argv=None):
    parser = argparse.ArgumentParser(
        description='Transcribe audio files to timestamped text with speaker diarization.',
        epilog=f'Supported formats: {", ".join(sorted(SUPPORTED_EXTENSIONS))}',
    )
    parser.add_argument(
        'audio_file',
        help='Path to audio file to transcribe',
    )
    parser.add_argument(
        '--output', '-o',
        help='Write transcript to this file instead of stdout',
    )
    parser.add_argument(
        '--model', '-m',
        default=DEFAULT_MODEL,
        help=f'Whisper model size (default: {DEFAULT_MODEL}). Options: tiny, base, small, medium, large-v3',
    )
    parser.add_argument(
        '--no-diarize',
        action='store_true',
        help='Skip speaker diarization (faster, no HF_TOKEN needed)',
    )
    return parser.parse_args(argv)


def validate_input(audio_file):
    """Validate the input file exists and has a supported extension."""
    if not os.path.isfile(audio_file):
        print(f'Error: File does not exist: {audio_file}', file=sys.stderr)
        sys.exit(1)

    ext = os.path.splitext(audio_file)[1].lower()
    if ext not in SUPPORTED_EXTENSIONS:
        print(
            f'Error: Unsupported format "{ext}". '
            f'Supported: {", ".join(sorted(SUPPORTED_EXTENSIONS))}',
            file=sys.stderr,
        )
        sys.exit(1)


def check_dependencies():
    """Check that required Python packages are installed."""
    missing = []
    try:
        import faster_whisper  # noqa: F401
    except ImportError:
        missing.append('faster-whisper')

    try:
        import torch  # noqa: F401
    except ImportError:
        missing.append('torch')

    if missing:
        print(
            f'Error: Missing required packages: {", ".join(missing)}\n'
            f'Install with: pip install -r scripts/requirements.txt\n'
            f'Or: pip install {" ".join(missing)}',
            file=sys.stderr,
        )
        sys.exit(1)


def check_diarization_dependencies():
    """Check pyannote.audio is installed (only needed when diarizing)."""
    try:
        import pyannote.audio  # noqa: F401
    except ImportError:
        print(
            'Error: Missing pyannote.audio (required for speaker diarization)\n'
            'Install with: pip install -r scripts/requirements.txt\n'
            'Or: pip install pyannote.audio\n'
            'Or use --no-diarize to skip speaker diarization.',
            file=sys.stderr,
        )
        sys.exit(1)

    if not os.environ.get('HF_TOKEN'):
        print(
            'Error: HF_TOKEN environment variable required for speaker diarization.\n'
            'Get a token at https://huggingface.co/settings/tokens\n'
            'Accept pyannote license at https://huggingface.co/pyannote/speaker-diarization-3.1\n'
            'Then: HF_TOKEN=hf_xxx python scripts/transcribe.py <file>\n'
            'Or use --no-diarize to skip speaker diarization.',
            file=sys.stderr,
        )
        sys.exit(1)


def format_timestamp(seconds):
    """Convert seconds to HH:MM:SS format."""
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    return f'{hours:02d}:{minutes:02d}:{secs:02d}'


def transcribe(audio_file, model_name):
    """Transcribe audio using faster-whisper. Returns list of segments."""
    from faster_whisper import WhisperModel

    model = WhisperModel(model_name, device='cpu', compute_type='int8')
    segments, info = model.transcribe(audio_file, beam_size=5)

    result = []
    for segment in segments:
        result.append({
            'start': segment.start,
            'end': segment.end,
            'text': segment.text.strip(),
        })
    return result


def diarize(audio_file):
    """Run speaker diarization using pyannote.audio. Returns timeline of speaker labels."""
    from pyannote.audio import Pipeline

    hf_token = os.environ['HF_TOKEN']
    pipeline = Pipeline.from_pretrained(
        'pyannote/speaker-diarization-3.1',
        use_auth_token=hf_token,
    )
    diarization = pipeline(audio_file)

    turns = []
    for turn, _, speaker in diarization.itertracks(yield_label=True):
        turns.append({
            'start': turn.start,
            'end': turn.end,
            'speaker': speaker,
        })
    return turns


def assign_speakers(segments, speaker_turns):
    """Map each transcription segment to a speaker based on overlap with diarization turns."""
    # Build speaker label map: SPEAKER_00 -> Speaker A, SPEAKER_01 -> Speaker B, etc.
    unique_speakers = []
    for turn in speaker_turns:
        if turn['speaker'] not in unique_speakers:
            unique_speakers.append(turn['speaker'])
    label_map = {
        spk: f'Speaker {chr(65 + i)}' for i, spk in enumerate(unique_speakers)
    }

    result = []
    for seg in segments:
        seg_mid = (seg['start'] + seg['end']) / 2
        best_speaker = None
        best_overlap = 0

        for turn in speaker_turns:
            overlap_start = max(seg['start'], turn['start'])
            overlap_end = min(seg['end'], turn['end'])
            overlap = max(0, overlap_end - overlap_start)
            if overlap > best_overlap:
                best_overlap = overlap
                best_speaker = turn['speaker']

        # Fallback: check which turn contains the segment midpoint
        if best_speaker is None:
            for turn in speaker_turns:
                if turn['start'] <= seg_mid <= turn['end']:
                    best_speaker = turn['speaker']
                    break

        speaker_label = label_map.get(best_speaker, 'Unknown') if best_speaker else 'Unknown'
        result.append({
            'start': seg['start'],
            'text': seg['text'],
            'speaker': speaker_label,
        })
    return result


def format_output(segments, include_speakers=True):
    """Format segments into timestamped lines."""
    lines = []
    for seg in segments:
        ts = format_timestamp(seg['start'])
        if include_speakers and 'speaker' in seg:
            lines.append(f'[{ts}] {seg["speaker"]}: {seg["text"]}')
        else:
            lines.append(f'[{ts}] {seg["text"]}')
    return '\n'.join(lines)


def main(argv=None):
    args = parse_args(argv)
    validate_input(args.audio_file)
    check_dependencies()

    if not args.no_diarize:
        check_diarization_dependencies()

    try:
        # Transcribe
        segments = transcribe(args.audio_file, args.model)

        if not segments:
            print('Warning: No speech detected in audio file.', file=sys.stderr)
            sys.exit(0)

        # Diarize (optional)
        if not args.no_diarize:
            speaker_turns = diarize(args.audio_file)
            segments = assign_speakers(segments, speaker_turns)
            output = format_output(segments, include_speakers=True)
        else:
            output = format_output(segments, include_speakers=False)

        # Write output
        if args.output:
            with open(args.output, 'w', encoding='utf-8') as f:
                f.write(output + '\n')
            print(f'Transcript written to {args.output}', file=sys.stderr)
        else:
            print(output)

    except KeyboardInterrupt:
        print('\nTranscription interrupted.', file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f'Error during transcription: {e}', file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
```

**Verify (CLI parsing tests should now pass):**
```bash
cd /Users/soelinmyat/Projects/pm && python -m pytest tests/test_transcribe.py::TestCLIArguments -v
# Expected: all TestCLIArguments tests PASS
```

---

### Task 4: Verify all tests pass

Run the full test suite to confirm all tests pass with mocked/shimmed dependencies.

```bash
cd /Users/soelinmyat/Projects/pm && python -m pytest tests/test_transcribe.py -v
# Expected: all tests PASS
```

Fix any failures.

---

### Task 5: Manual smoke test — help and error paths

```bash
cd /Users/soelinmyat/Projects/pm

# Help text
python scripts/transcribe.py --help
# Expected: usage with --model, --output, --no-diarize, supported formats

# No args
python scripts/transcribe.py 2>&1
# Expected: exit 1, usage/error message

# Nonexistent file
python scripts/transcribe.py /tmp/nope.mp3 2>&1
# Expected: exit 1, "does not exist"

# Wrong format
echo "hello" > /tmp/test.txt && python scripts/transcribe.py /tmp/test.txt 2>&1
# Expected: exit 1, "Unsupported format"
```

---

### Task 6: Commit

```bash
cd /Users/soelinmyat/Projects/pm
git add scripts/transcribe.py scripts/requirements.txt tests/test_transcribe.py
git commit -m "feat(PM-113): add faster-whisper transcription script with speaker diarization"
```
