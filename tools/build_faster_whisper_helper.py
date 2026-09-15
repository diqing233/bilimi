"""Build the Windows faster-whisper helper without requiring user Python at runtime."""

import argparse
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parent
ENTRYPOINT = ROOT / "transcribe_faster_whisper.py"


def build_command(python: Path, output: Path) -> list[str]:
    return [
        str(python),
        "-m",
        "PyInstaller",
        "--noconfirm",
        "--clean",
        "--onefile",
        "--name",
        "bilimi-faster-whisper",
        "--collect-all",
        "faster_whisper",
        "--collect-all",
        "ctranslate2",
        "--collect-all",
        "nvidia.cublas",
        "--collect-all",
        "nvidia.cudnn",
        "--distpath",
        str(output),
        str(ENTRYPOINT),
    ]


def main() -> int:
    parser = argparse.ArgumentParser(description="Build the controlled faster-whisper Windows helper.")
    parser.add_argument("--python", required=True, type=Path, help="Build-only Python executable.")
    parser.add_argument("--output", required=True, type=Path, help="Directory for the helper executable.")
    args = parser.parse_args()

    subprocess.run(build_command(args.python, args.output), check=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
