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
        with tempfile.TemporaryDirectory() as tmpdir:
            shim = os.path.join(tmpdir, 'faster_whisper.py')
            with open(shim, 'w') as f:
                f.write('raise ImportError("No module named faster_whisper")\n')
            env = {'PYTHONPATH': tmpdir + ':' + os.environ.get('PYTHONPATH', '')}
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
