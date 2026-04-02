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
        segments = transcribe(args.audio_file, args.model)

        if not segments:
            print('Warning: No speech detected in audio file.', file=sys.stderr)
            sys.exit(0)

        if not args.no_diarize:
            speaker_turns = diarize(args.audio_file)
            segments = assign_speakers(segments, speaker_turns)
            output = format_output(segments, include_speakers=True)
        else:
            output = format_output(segments, include_speakers=False)

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
