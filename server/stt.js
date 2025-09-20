// server/stt.js
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ffmpeg from 'fluent-ffmpeg'
import ffmpegStatic from 'ffmpeg-static'
import fs from 'node:fs/promises'
import os from 'node:os'
import { Model, KaldiRecognizer } from 'vosk'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

ffmpeg.setFfmpegPath(ffmpegStatic)

// Point to your Vosk model folder:
const MODEL_DIR = path.join(__dirname, 'models', 'vosk', 'vosk-model-small-en-us-0.15')
let model

export async function ensureModel(){
  if (!model) model = new Model(MODEL_DIR)
  return model
}

export async function webmToWav16kMono(inPath){
  const outPath = path.join(os.tmpdir(), `xenya_${Date.now()}.wav`)
  await new Promise((resolve, reject)=>{
    ffmpeg(inPath)
      .audioChannels(1)
      .audioFrequency(16000)
      .format('wav')
      .output(outPath)
      .on('end', resolve)
      .on('error', reject)
      .run()
  })
  return outPath
}

export async function transcribeFile(webmPath){
  await ensureModel()
  const wavPath = await webmToWav16kMono(webmPath)
  const rec = new KaldiRecognizer(model, 16000)
  const data = await fs.readFile(wavPath)
  rec.acceptWaveform(data)
  const res = JSON.parse(rec.finalResult() || '{"text":""}')
  await fs.unlink(wavPath).catch(()=>{})
  return res.text || ''
}
