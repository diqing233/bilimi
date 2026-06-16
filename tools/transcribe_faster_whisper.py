import argparse
import json
import sys


def parse_args():
    parser = argparse.ArgumentParser(description="Transcribe audio with local faster-whisper.")
    parser.add_argument("--audio", required=True, help="Audio file path to transcribe.")
    parser.add_argument("--model", default="small", help="faster-whisper model name.")
    parser.add_argument("--device", default="cpu", help="faster-whisper device, defaults to cpu.")
    parser.add_argument(
        "--compute-type",
        default="int8",
        help="faster-whisper compute type, defaults to int8 for CPU compatibility.",
    )
    return parser.parse_args()


def main():
    args = parse_args()

    try:
        from faster_whisper import WhisperModel
    except ModuleNotFoundError as error:
        print(f"BILIMI_FASTER_WHISPER_IMPORT_ERROR: {error}", file=sys.stderr)
        return 3

    try:
        model = WhisperModel(args.model, device=args.device, compute_type=args.compute_type)
        segments, _info = model.transcribe(args.audio)
        payload = {
            "segments": [
                {
                    "start": segment.start,
                    "end": segment.end,
                    "text": segment.text,
                }
                for segment in segments
            ]
        }
    except Exception as error:
        print(f"BILIMI_FASTER_WHISPER_TRANSCRIBE_ERROR: {error}", file=sys.stderr)
        return 4

    print(json.dumps(payload, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
