import importlib.util
import sys
import types
import unittest
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
    def test_defaults_to_cpu_int8_model_runtime(self):
        calls = []

        class FakeModel:
            def __init__(self, *args, **kwargs):
                calls.append((args, kwargs))

            def transcribe(self, audio):
                return [], None

        fake_module = types.SimpleNamespace(WhisperModel=FakeModel)

        with patch.dict(sys.modules, {"faster_whisper": fake_module}):
            module = load_script()
            with patch.object(
                sys,
                "argv",
                ["transcribe_faster_whisper.py", "--audio", "sample.wav", "--model", "tiny"],
            ):
                self.assertEqual(module.main(), 0)

        self.assertEqual(calls, [(("tiny",), {"device": "cpu", "compute_type": "int8"})])


if __name__ == "__main__":
    unittest.main()
