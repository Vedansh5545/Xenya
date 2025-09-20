import sys, json, os, tempfile, soundfile as sf
from vosk import Model, KaldiRecognizer
from pathlib import Path

# Expect model at: server/models/vosk/vosk-model-small-en-us-0.15
# (this file lives in server/, so go relative from here)
model_dir = Path(__file__).parent / "models" / "vosk" / "vosk-model-small-en-us-0.15"
if not model_dir.exists():
    print(json.dumps({"text":"","error":f"Vosk model not found at {model_dir}"}))
    sys.exit(0)

model = Model(str(model_dir))

# Read 16k mono WAV from stdin and transcribe
data = sys.stdin.buffer.read()
with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
    f.write(data)
    tmp = f.name

audio, sr = sf.read(tmp, dtype='int16')
rec = KaldiRecognizer(model, sr)
rec.AcceptWaveform(audio.tobytes())
res = json.loads(rec.FinalResult())
print(json.dumps({"text": res.get("text","")}))
os.unlink(tmp)
