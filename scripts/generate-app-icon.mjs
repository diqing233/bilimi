import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, '..')

export const APP_ICON_SOURCE = resolve(repoRoot, 'electron/assets/bilimi-icon-source.png')
export const APP_ICON_AVATAR = resolve(repoRoot, 'electron/assets/bilimi-avatar.png')
export const APP_ICON_ICO = resolve(repoRoot, 'electron/assets/bilimi.ico')
export const APP_BUILD_ICON_PNG = resolve(repoRoot, 'build/icon.png')
export const APP_BUILD_ICON_ICO = resolve(repoRoot, 'build/icon.ico')
export const APP_ICON_RESIZE_MODE = 'contain-square'

export const APP_ICON_AVATAR_SIZE = 512
export const APP_ICON_ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]

function resolvePythonCommand() {
  return process.env.BILIMI_PYTHON_PATH || process.env.PYTHON || 'python'
}

function buildPythonProgram() {
  return String.raw`
import json
import sys
from pathlib import Path
from PIL import Image

payload = json.loads(sys.argv[1])
source_path = Path(payload["source"])
avatar_path = Path(payload["avatar"])
ico_path = Path(payload["ico"])
build_png_path = Path(payload["buildPng"])
build_ico_path = Path(payload["buildIco"])
avatar_size = int(payload["avatarSize"])
ico_sizes = [int(size) for size in payload["icoSizes"]]

source = Image.open(source_path).convert("RGBA")
if source.width != source.height:
    raise ValueError(f"App icon source must be square, got {source.width}x{source.height}")

avatar = source.resize((avatar_size, avatar_size), Image.Resampling.LANCZOS)

avatar_path.parent.mkdir(parents=True, exist_ok=True)
build_png_path.parent.mkdir(parents=True, exist_ok=True)
avatar.save(avatar_path, format="PNG", optimize=True)
avatar.save(ico_path, format="ICO", sizes=[(size, size) for size in ico_sizes])
avatar.save(build_png_path, format="PNG", optimize=True)
avatar.save(build_ico_path, format="ICO", sizes=[(size, size) for size in ico_sizes])

print(f"wrote {avatar_path}")
print(f"wrote {ico_path}")
print(f"wrote {build_png_path}")
print(f"wrote {build_ico_path}")
`
}

export function generateAppIcon() {
  const payload = {
    source: APP_ICON_SOURCE,
    avatar: APP_ICON_AVATAR,
    ico: APP_ICON_ICO,
    buildPng: APP_BUILD_ICON_PNG,
    buildIco: APP_BUILD_ICON_ICO,
    resizeMode: APP_ICON_RESIZE_MODE,
    avatarSize: APP_ICON_AVATAR_SIZE,
    icoSizes: APP_ICON_ICO_SIZES
  }
  const result = spawnSync(resolvePythonCommand(), ['-c', buildPythonProgram(), JSON.stringify(payload)], {
    encoding: 'utf8',
    stdio: 'pipe'
  })

  if (result.status !== 0) {
    throw new Error(
      [
        'Failed to generate bilimi app icon.',
        result.stdout.trim(),
        result.stderr.trim()
      ]
        .filter(Boolean)
        .join('\n')
    )
  }

  return result.stdout.trim()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(generateAppIcon())
}
