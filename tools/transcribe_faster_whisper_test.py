import importlib.util
import io
import json
import sys
import types
import unittest
import os
from pathlib import Path
from unittest.mock import patch


SCRIPT_PATH = Path(__file__).with_name("transcribe_faster_whisper.py")


def load_script():
    spec = importlib.util.spec_from_file_location("transcribe_faster_whisper", SCRIPT_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class TranscribeFasterWhisperTest(unittest.TestCase):
    def test_registers_pip_nvidia_dll_directories_before_loading_the_model(self):
        module = load_script()
        added = []
        fake_root = Path('C:/Python/Lib/site-packages')

        with patch.object(module.site, 'getsitepackages', return_value=[str(fake_root)]), \
             patch.object(module.Path, 'is_dir', return_value=True), \
             patch.object(os, 'add_dll_directory', side_effect=lambda value: added.append(str(value)), create=True), \
             patch.dict(os.environ, {'PATH': 'C:/Windows'}, clear=False):
            discovered = module.configure_cuda_dll_search_path()

        self.assertIn(str(fake_root / 'nvidia' / 'cublas' / 'bin'), added)
        self.assertIn(str(fake_root / 'nvidia' / 'cudnn' / 'bin'), added)
        self.assertEqual(discovered[:2], [
            str(fake_root / 'nvidia' / 'cublas' / 'bin'),
            str(fake_root / 'nvidia' / 'cudnn' / 'bin'),
        ])

    def test_configures_stdout_as_utf8(self):
        module = load_script()

        self.assertEqual(module.configure_utf8_stdio(), "utf-8")

    def test_defaults_to_cpu_int8_model_runtime(self):
        calls = []

        class FakeModel:
            def __init__(self, *args, **kwargs):
                calls.append((args, kwargs))

            def transcribe(self, audio, **kwargs):
                self.kwargs = kwargs
                return [], None

        fake_module = types.SimpleNamespace(WhisperModel=FakeModel)

        with patch.dict(sys.modules, {"faster_whisper": fake_module}):
            module = load_script()
            with patch.object(
                sys,
                "argv",
                ["transcribe_faster_whisper.py", "--audio", "sample.wav", "--model", "tiny"],
            ), patch("sys.stdout", io.StringIO()):
                self.assertEqual(module.main(), 0)

        self.assertEqual(calls, [(("tiny",), {"device": "cpu", "compute_type": "int8"})])

    def test_auto_runtime_prefers_cuda_float16_when_ct2_reports_a_usable_device(self):
        module = load_script()
        fake_ct2 = types.SimpleNamespace(
            get_cuda_device_count=lambda: 1,
            get_supported_compute_types=lambda device: {"float16", "int8_float16"},
        )

        self.assertEqual(module.resolve_runtime("auto", "auto", fake_ct2), ("cuda", "float16"))

    def test_serve_reuses_one_loaded_model_for_multiple_audio_requests(self):
        calls = []

        class FakeModel:
            def __init__(self, *args, **kwargs):
                calls.append((args, kwargs))

            def transcribe(self, audio, **kwargs):
                return [types.SimpleNamespace(start=0, end=1, text=audio)], None

        fake_module = types.SimpleNamespace(WhisperModel=FakeModel)
        stdin = io.StringIO('{"id":"one","audio":"one.mp3"}\n{"id":"two","audio":"two.mp3"}\n')
        stdout = io.StringIO()

        with patch.dict(sys.modules, {"faster_whisper": fake_module}):
            module = load_script()
            with patch.object(sys, "argv", ["transcribe_faster_whisper.py", "--serve", "--model", "tiny"]), patch("sys.stdout", stdout):
                self.assertEqual(module.main(stdin=stdin), 0)

        self.assertEqual(calls, [(('tiny',), {'device': 'cpu', 'compute_type': 'int8'})])
        self.assertEqual(
            [json.loads(line) for line in stdout.getvalue().splitlines()],
            [
                {'ready': True, 'device': 'cpu', 'computeType': 'int8'},
                {'id': 'one', 'segments': [{'start': 0, 'end': 1, 'text': 'one.mp3'}]},
                {'id': 'two', 'segments': [{'start': 0, 'end': 1, 'text': 'two.mp3'}]},
            ],
        )

    def test_health_check_reports_the_actual_cuda_runtime_after_a_short_inference(self):
        calls = []
        case = self

        class FakeModel:
            def __init__(self, *args, **kwargs):
                calls.append((args, kwargs))

            def transcribe(self, audio, **kwargs):
                case.assertTrue(str(audio).endswith('.wav'))
                return [], None

        fake_module = types.SimpleNamespace(WhisperModel=FakeModel)
        stdout = io.StringIO()

        with patch.dict(sys.modules, {"faster_whisper": fake_module}):
            module = load_script()
            with patch.object(sys, "argv", [
                "transcribe_faster_whisper.py", "--health-check", "--model", "tiny",
                "--device", "cuda", "--compute-type", "float16"
            ]), patch("sys.stdout", stdout):
                self.assertEqual(module.main(), 0)

        self.assertEqual(calls, [(('tiny',), {'device': 'cuda', 'compute_type': 'float16'})])
        self.assertEqual(json.loads(stdout.getvalue()), {
            'ok': True, 'device': 'cuda', 'computeType': 'float16'
        })


if __name__ == "__main__":
    unittest.main()
