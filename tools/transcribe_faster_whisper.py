import argparse
import json
import os
import site
import sys
import tempfile
import wave
from pathlib import Path


_DLL_DIRECTORY_HANDLES = []


def configure_cuda_dll_search_path():
    """Expose pip/PyInstaller NVIDIA DLLs before CTranslate2 is imported."""
    roots = []
    bundle_root = getattr(sys, "_MEIPASS", None)
    if bundle_root:
        roots.append(Path(bundle_root))
    try:
        roots.extend(Path(value) for value in site.getsitepackages())
    except AttributeError:
        pass
    user_site = site.getusersitepackages()
    if user_site:
        roots.append(Path(user_site))

    candidates = []
    for root in roots:
        candidates.extend((root / "nvidia" / "cublas" / "bin", root / "nvidia" / "cudnn" / "bin"))
    existing = []
    for candidate in candidates:
        if not candidate.is_dir() or str(candidate) in existing:
            continue
        existing.append(str(candidate))
        add_dll_directory = getattr(os, "add_dll_directory", None)
        if callable(add_dll_directory):
            _DLL_DIRECTORY_HANDLES.append(add_dll_directory(str(candidate)))
    if existing:
        os.environ["PATH"] = os.pathsep.join((*existing, os.environ.get("PATH", "")))
    return existing


def configure_utf8_stdio():
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if callable(reconfigure):
            reconfigure(encoding="utf-8")

    return getattr(sys.stdout, "encoding", None)


def parse_args():
    parser = argparse.ArgumentParser(description="Transcribe audio with local faster-whisper.")
    parser.add_argument("--audio", help="Audio file path to transcribe.")
    parser.add_argument("--serve", action="store_true", help="Read JSON-line audio requests from stdin using one loaded model.")
    parser.add_argument("--health-check", action="store_true", help="Load the selected runtime and run a short silent inference.")
    parser.add_argument("--model", default="small", help="faster-whisper model name.")
    parser.add_argument("--device", default="cpu", help="faster-whisper device: cpu, cuda, or auto.")
    parser.add_argument(
        "--compute-type",
        default="int8",
        help="faster-whisper compute type, or auto for the selected device.",
    )
    parser.add_argument(
        "--vad-filter",
        choices=("true", "false"),
        default="true",
        help="Enable conservative VAD filtering; default true.",
    )
    args = parser.parse_args()
    if not args.serve and not args.health_check and not args.audio:
        parser.error("--audio is required unless --serve or --health-check is used")
    return args


def resolve_runtime(device, compute_type, ctranslate2):
    if device == "auto":
        try:
            use_cuda = ctranslate2.get_cuda_device_count() > 0
        except Exception:
            use_cuda = False
        device = "cuda" if use_cuda else "cpu"

    if compute_type == "auto":
        try:
            supported = ctranslate2.get_supported_compute_types(device)
        except Exception:
            supported = set()
        if device == "cuda" and "float16" in supported:
            compute_type = "float16"
        elif device == "cuda" and "int8_float16" in supported:
            compute_type = "int8_float16"
        else:
            compute_type = "int8"

    return device, compute_type


def create_model(args):
    from faster_whisper import WhisperModel

    device, compute_type = args.device, args.compute_type
    if device == "auto" or compute_type == "auto":
        import ctranslate2

        device, compute_type = resolve_runtime(device, compute_type, ctranslate2)
    args.resolved_device = device
    args.resolved_compute_type = compute_type
    return WhisperModel(args.model, device=device, compute_type=compute_type)


def run_health_check(model, args):
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as output:
        path = output.name
    try:
        with wave.open(path, "wb") as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(16000)
            wav.writeframes(b"\x00\x00" * 1600)
        transcribe(model, path, args.vad_filter == "true")
    finally:
        try:
            import os
            os.unlink(path)
        except OSError:
            pass
    return {
        "ok": True,
        "device": args.resolved_device,
        "computeType": args.resolved_compute_type,
    }


def transcribe(model, audio_path, vad_filter):
    segments, _info = model.transcribe(audio_path, vad_filter=vad_filter)
    return {
        "segments": [
            {
                "start": segment.start,
                "end": segment.end,
                "text": segment.text,
            }
            for segment in segments
        ]
    }


def serve(model, args, stdin):
    for line in stdin:
        try:
            request = json.loads(line)
            request_id = request["id"]
            audio_path = request["audio"]
            if not isinstance(request_id, str) or not isinstance(audio_path, str) or not audio_path:
                raise ValueError("request requires non-empty string id and audio")
            payload = {"id": request_id, **transcribe(model, audio_path, args.vad_filter == "true")}
        except Exception as error:
            payload = {"id": request.get("id") if "request" in locals() and isinstance(request, dict) else None,
                       "error": f"BILIMI_FASTER_WHISPER_TRANSCRIBE_ERROR: {error}"}
        print(json.dumps(payload, ensure_ascii=False), flush=True)
    return 0


def main(stdin=None):
    configure_utf8_stdio()
    configure_cuda_dll_search_path()
    args = parse_args()

    try:
        model = create_model(args)
    except ModuleNotFoundError as error:
        print(f"BILIMI_FASTER_WHISPER_IMPORT_ERROR: {error}", file=sys.stderr)
        return 3
    except Exception as error:
        print(f"BILIMI_FASTER_WHISPER_TRANSCRIBE_ERROR: {error}", file=sys.stderr)
        return 4

    if args.health_check:
        try:
            print(json.dumps(run_health_check(model, args), ensure_ascii=False))
            return 0
        except Exception as error:
            print(f"BILIMI_FASTER_WHISPER_TRANSCRIBE_ERROR: {error}", file=sys.stderr)
            return 4

    if args.serve:
        print(json.dumps({
            "ready": True,
            "device": args.resolved_device,
            "computeType": args.resolved_compute_type,
        }, ensure_ascii=False), flush=True)
        return serve(model, args, stdin or sys.stdin)

    try:
        payload = transcribe(model, args.audio, args.vad_filter == "true")
    except Exception as error:
        print(f"BILIMI_FASTER_WHISPER_TRANSCRIBE_ERROR: {error}", file=sys.stderr)
        return 4

    print(json.dumps(payload, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
