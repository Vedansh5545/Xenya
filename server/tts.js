import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const __filename = fileURLToPath(import.meta.url)
const __dirname  = path.dirname(__filename)

const PIPER = path.join(__dirname, '..', '.venv', 'bin', 'piper') // venv CLI
const VOICES_DIR = path.join(__dirname, 'piper', 'voices')

export function synthesizeWithPiper({ text, voice='en_GB-jenny_dioco-medium.onnx' }) {
  return new Promise((resolve, reject) => {
    const model = path.join(VOICES_DIR, voice)
    const args = ['--model', model, '--output_file', '-']  // write WAV to stdout
    const child = spawn(PIPER, args, { stdio: ['pipe','pipe','pipe'] })
    const chunks = []
    child.stdout.on('data', d => chunks.push(d))
    child.stderr.on('data', () => {}) // quiet
    child.on('error', reject)
    child.on('close', code => code===0 ? resolve(Buffer.concat(chunks))
                                       : reject(new Error('piper exited '+code)))
    child.stdin.write((text ?? '').toString()); child.stdin.end()
  })
}
