import importlib.util
import unittest
from pathlib import Path


SCRIPT_PATH = Path(__file__).with_name("build_faster_whisper_helper.py")


class BuildFasterWhisperHelperTests(unittest.TestCase):
    def test_build_command_creates_a_self_contained_windows_helper(self):
        spec = importlib.util.spec_from_file_location("build_faster_whisper_helper", SCRIPT_PATH)
        module = importlib.util.module_from_spec(spec)
        assert spec.loader is not None
        spec.loader.exec_module(module)

        command = module.build_command(Path("C:/python/python.exe"), Path("C:/out"))

        self.assertEqual(command[:3], [str(Path("C:/python/python.exe")), "-m", "PyInstaller"])
        self.assertIn("--onefile", command)
        self.assertIn("--collect-all", command)
        self.assertIn("faster_whisper", command)
        self.assertIn("ctranslate2", command)
        self.assertIn("nvidia.cublas", command)
        self.assertIn("nvidia.cudnn", command)
        self.assertIn("--distpath", command)


if __name__ == "__main__":
    unittest.main()
