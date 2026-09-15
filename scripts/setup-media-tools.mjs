import { createReadStream, createWriteStream } from 'node:fs'
import { copyFile, cp, mkdir, readdir, rm, stat } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createHash } from 'node:crypto'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = join(__dirname, '..')
const platform = process.platform
const toolDir = join(projectRoot, 'tools', platform)
const whisperDir = join(toolDir, 'whisper')
const whisperModelDir = join(whisperDir, 'models')
const senseVoiceBundleRoot = join(toolDir, 'transcription-models', 'sensevoice-small')
const localSenseVoiceRoot = join(process.env.LOCALAPPDATA ?? '', 'bilimi', 'transcription-models', 'sensevoice-small')

const downloads = {
  win32: [
    {
      name: 'yt-dlp.exe',
      url: 'https://github.com/yt-dlp/yt-dlp/releases/download/2026.06.09/yt-dlp.exe',
      target: join(toolDir, 'yt-dlp.exe')
    },
    {
      name: 'ffmpeg and ffprobe',
      url: 'https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-06-30-13-34/ffmpeg-N-125365-g9a01c1cb6a-win64-gpl.zip',
      extract: [
        { pattern: /\/bin\/ffmpeg\.exe$/, target: join(toolDir, 'ffmpeg.exe') },
        { pattern: /\/bin\/ffprobe\.exe$/, target: join(toolDir, 'ffprobe.exe') }
      ]
    },
    {
      name: 'whisper.cpp v1.9.1',
      url: 'https://github.com/ggml-org/whisper.cpp/releases/download/v1.9.1/whisper-bin-x64.zip',
      extract: [
        { pattern: /\/whisper-cli\.exe$/, target: join(whisperDir, 'whisper-cli.exe') },
        { pattern: /\/(?:whisper|ggml(?:-.+)?|SDL2)\.dll$/, targetDir: whisperDir }
      ]
    },
  ]
}

const senseVoiceArtifacts = [
  {
    name: 'SenseVoiceSmall runtime',
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.13.4/sherpa-onnx-v1.13.4-win-x64-shared-MD-Release-no-tts.tar.bz2',
    target: join(toolDir, 'transcription-models', '.downloads', 'runtime.tar.bz2'),
    sha256: 'da8eb60079df2969b7691517c2dd6f4965a0481533b200c3bf25f5e7f7f65b80'
  },
  {
    name: 'SenseVoiceSmall model',
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09.tar.bz2',
    target: join(toolDir, 'transcription-models', '.downloads', 'model.tar.bz2'),
    sha256: '7305f7905bfcf77fa0b39388a313f3da35c68d971661a65475b56fb2162c8e63'
  }
]

async function downloadFile({ name, url, target, force = false }) {
  if (!force && (await isReusableFile(target))) {
    console.log(`Using existing ${name}.`)
    return
  }

  console.log(`Downloading ${name}...`)
  await mkdir(dirname(target), { recursive: true })
  await downloadUrlToFile(url, target)
}

async function downloadAndExtract({ name, url, extract }) {
  if (await isReusableExtract(extract)) {
    console.log(`Using existing ${name}.`)
    return
  }

  console.log(`Downloading ${name}...`)
  const zipPath = join(toolDir, 'download.zip')
  const extractDir = join(toolDir, 'download')
  await rm(zipPath, { force: true })
  await rm(extractDir, { recursive: true, force: true })
  await downloadUrlToFile(url, zipPath)

  await mkdir(extractDir, { recursive: true })
  await expandArchive(zipPath, extractDir)

  const files = await listFiles(extractDir)
  for (const entry of extract) {
    if ('target' in entry) {
      await mkdir(dirname(entry.target), { recursive: true })
    } else {
      await mkdir(entry.targetDir, { recursive: true })
    }
  }

  const pending = new Map(extract.filter((entry) => 'target' in entry).map((entry) => [entry.pattern, entry]))

  for (const file of files) {
    const normalizedFile = file.replace(/\\/g, '/')
    const entry = extract.find((candidate) => candidate.pattern.test(normalizedFile))

    if (!entry) {
      continue
    }

    if ('target' in entry) {
      pending.delete(entry.pattern)
      await copyFile(file, entry.target)
    } else {
      await copyFile(file, join(entry.targetDir, basename(file)))
    }
  }

  await rm(zipPath, { force: true })
  await rm(extractDir, { recursive: true, force: true })

  if (pending.size > 0) {
    throw new Error(`Failed to extract ${[...pending.values()].map((entry) => entry.target).join(', ')}`)
  }
}

function expandTarBz2(archivePath, destination) {
  return new Promise((resolve, reject) => {
    const child = spawn('tar.exe', ['-xjf', archivePath, '-C', destination], { windowsHide: true })
    let stderr = ''
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.on('error', reject)
    child.on('close', (exitCode) => {
      if (exitCode === 0) resolve()
      else reject(new Error(`Failed to extract tar archive: ${stderr.trim()}`))
    })
  })
}

async function isReusableFile(path) {
  try {
    const stats = await stat(path)
    return stats.isFile() && stats.size > 0
  } catch {
    return false
  }
}

async function isReusableDirectory(path) {
  try {
    const entries = await readdir(path)
    return entries.length > 0
  } catch {
    return false
  }
}

async function isReusableExtract(extract) {
  for (const entry of extract) {
    if ('target' in entry) {
      if (!(await isReusableFile(entry.target))) {
        return false
      }
    } else if (!(await isReusableDirectory(entry.targetDir))) {
      return false
    }
  }

  return true
}

async function verifySha1(path, expectedSha1) {
  const hash = createHash('sha1')
  await pipeline(createReadStream(path), hash)
  const actualSha1 = hash.digest('hex')

  if (actualSha1 !== expectedSha1) {
    throw new Error(`${path} SHA1 mismatch: expected ${expectedSha1}, got ${actualSha1}`)
  }
}

async function verifySha256(path, expectedSha256) {
  const hash = createHash('sha256')
  await pipeline(createReadStream(path), hash)
  const actualSha256 = hash.digest('hex')
  if (actualSha256 !== expectedSha256) {
    throw new Error(`${path} SHA-256 mismatch: expected ${expectedSha256}, got ${actualSha256}`)
  }
}

async function prepareSenseVoiceBundle() {
  const hasSenseVoiceLayout = async (base) => (await Promise.all([
    join(base, 'runtime', 'bin', 'sherpa-onnx-offline.exe'),
    join(base, 'model', 'model.int8.onnx'),
    join(base, 'model', 'tokens.txt')
  ].map((path) => isReusableFile(path)))).every(Boolean)
  if (await hasSenseVoiceLayout(senseVoiceBundleRoot)) {
    console.log('Using existing SenseVoiceSmall bundle.')
    return
  }

  if (await hasSenseVoiceLayout(localSenseVoiceRoot)) {
    await rm(senseVoiceBundleRoot, { recursive: true, force: true })
    await mkdir(dirname(senseVoiceBundleRoot), { recursive: true })
    await cp(join(localSenseVoiceRoot, 'runtime'), join(senseVoiceBundleRoot, 'runtime'), { recursive: true })
    await cp(join(localSenseVoiceRoot, 'model'), join(senseVoiceBundleRoot, 'model'), { recursive: true })
    console.log(`Using verified local SenseVoiceSmall installation from ${localSenseVoiceRoot}.`)
    return
  }

  const scratchRoot = join(toolDir, 'transcription-models', '.downloads')
  const extractRoot = join(scratchRoot, 'extract')
  await mkdir(scratchRoot, { recursive: true })
  for (const artifact of senseVoiceArtifacts) {
    await downloadFile(artifact)
    await verifySha256(artifact.target, artifact.sha256)
  }
  await rm(extractRoot, { recursive: true, force: true })
  await mkdir(extractRoot, { recursive: true })
  for (const artifact of senseVoiceArtifacts) await expandTarBz2(artifact.target, extractRoot)

  const runtimeSource = join(extractRoot, 'sherpa-onnx-v1.13.4-win-x64-shared-MD-Release-no-tts')
  const modelSource = join(extractRoot, 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09')
  if (!(await isReusableFile(join(runtimeSource, 'bin', 'sherpa-onnx-offline.exe')))
    || !(await isReusableFile(join(modelSource, 'model.int8.onnx')))
    || !(await isReusableFile(join(modelSource, 'tokens.txt')))) {
    throw new Error('SenseVoiceSmall archive layout is missing required files.')
  }

  await rm(senseVoiceBundleRoot, { recursive: true, force: true })
  await mkdir(dirname(senseVoiceBundleRoot), { recursive: true })
  await mkdir(senseVoiceBundleRoot, { recursive: true })
  await cp(runtimeSource, join(senseVoiceBundleRoot, 'runtime'), { recursive: true })
  await cp(modelSource, join(senseVoiceBundleRoot, 'model'), { recursive: true })
  await rm(scratchRoot, { recursive: true, force: true })
  console.log(`SenseVoiceSmall bundle installed in ${senseVoiceBundleRoot}`)
}

async function downloadUrlToFile(url, target) {
  try {
    await pipeline(await downloadWithProgress(url), createWriteStream(target))
  } catch (error) {
    console.warn(`Node download failed, retrying with PowerShell: ${formatError(error)}`)
    await rm(target, { force: true })
    await downloadWithPowerShell(url, target)
  }
}

async function downloadWithProgress(url) {
  const response = await fetch(url)

  if (!response.ok || !response.body) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`)
  }

  const total = Number(response.headers.get('content-length') ?? 0)
  let received = 0
  let lastPercent = -1

  return Readable.fromWeb(response.body).on('data', (chunk) => {
    received += chunk.length

    if (total <= 0) {
      return
    }

    const percent = Math.floor((received / total) * 100)
    if (percent !== lastPercent && percent % 10 === 0) {
      lastPercent = percent
      console.log(`  ${percent}%`)
    }
  })
}

function downloadWithPowerShell(url, target) {
  return new Promise((resolve, reject) => {
    const command = [
      "$ErrorActionPreference = 'Stop'",
      "$ProgressPreference = 'SilentlyContinue'",
      `Invoke-WebRequest -UseBasicParsing -Uri ${quotePowerShell(url)} -OutFile ${quotePowerShell(target)}`
    ].join('; ')
    const child = spawn('powershell.exe', ['-NoProfile', '-Command', command], { windowsHide: true })
    let stderr = ''

    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.on('error', reject)
    child.on('close', (exitCode) => {
      if (exitCode === 0) {
        resolve()
      } else {
        reject(new Error(`PowerShell download failed: ${stderr.trim()}`))
      }
    })
  })
}

function quotePowerShell(value) {
  return `'${String(value).replace(/'/g, "''")}'`
}

function formatError(error) {
  if (!(error instanceof Error)) {
    return String(error)
  }

  const cause = error.cause instanceof Error ? ` (${error.cause.message})` : ''
  return `${error.message}${cause}`
}

function expandArchive(zipPath, destination) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-Command', 'Expand-Archive', '-LiteralPath', zipPath, '-DestinationPath', destination, '-Force'],
      { windowsHide: true }
    )

    let stderr = ''
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.on('error', reject)
    child.on('close', (exitCode) => {
      if (exitCode === 0) {
        resolve()
      } else {
        reject(new Error(`Failed to extract archive: ${stderr.trim()}`))
      }
    })
  })
}

async function listFiles(root) {
  const entries = await readdir(root, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const path = join(root, entry.name)

    if (entry.isDirectory()) {
      files.push(...(await listFiles(path)))
    } else {
      files.push(path)
    }
  }

  return files
}

async function main() {
  const platformDownloads = downloads[platform]

  if (!platformDownloads) {
    throw new Error(`Media tool setup is not automated for ${platform}. See tools/README.md.`)
  }

  await mkdir(toolDir, { recursive: true })

  for (const item of platformDownloads) {
    if ('extract' in item) {
      await downloadAndExtract(item)
    } else {
      if (item.sha1) {
        if (await isReusableFile(item.target)) {
          try {
            await verifySha1(item.target, item.sha1)
            console.log(`Using existing ${item.name}.`)
            continue
          } catch {
            await rm(item.target, { force: true })
          }
        }

        await downloadFile({ ...item, force: true })
        await verifySha1(item.target, item.sha1)
      } else {
        await downloadFile(item)
      }
    }
  }

  if (platform === 'win32') await prepareSenseVoiceBundle()

  await verifyInstalledTools()
  console.log(`Media tools installed in ${toolDir}`)
}

async function verifyInstalledTools() {
  const checks = [
    { command: join(toolDir, 'yt-dlp.exe'), args: ['--version'] },
    { command: join(toolDir, 'ffmpeg.exe'), args: ['-version'] },
    { command: join(toolDir, 'ffprobe.exe'), args: ['-version'] },
    { command: join(whisperDir, 'whisper-cli.exe'), args: ['--version'] }
  ]

  for (const check of checks) {
    await runTool(check.command, check.args)
  }
}

function runTool(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true })
    let stderr = ''

    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.on('error', reject)
    child.on('close', (exitCode) => {
      if (exitCode === 0) {
        resolve()
      } else {
        reject(new Error(`${command} failed to start: ${stderr.trim()}`))
      }
    })
  })
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
