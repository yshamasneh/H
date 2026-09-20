// Generates the JOVO delivery-alert sound: apps/mobile/assets/sounds/jovo_delivery.wav
//
//   node scripts/generate-alert-sound.mjs
//
// The sound is synthesised, not sampled, so it has no licence attached and can be regenerated or
// retuned. Design goals, in order:
//   1. Get through road noise and a phone in a pocket. Engine and tyre noise sits below ~500 Hz and
//      a phone speaker cannot reproduce much under ~600 Hz anyway, so every partial lives between
//      roughly 1 and 6 kHz, and the level is pushed to near full scale with a soft limiter so the
//      average loudness (not just the peak) is high.
//   2. Be unmistakable. Four rising bell notes (one per syllable of "J-O-V-O") ending on a held
//      accent, then repeated three times with a small step up in pitch. No system tone sounds like it.
//   3. Stay short. ~3.6 s: long enough to catch attention, short enough not to be a ringtone.
//
// Output: 44.1 kHz, 16-bit, mono PCM WAV. Linear PCM is what iOS accepts for custom notification
// sounds (under 30 s) and what Android's res/raw expects.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const sampleRate = 44_100;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = path.join(root, "apps", "mobile", "assets", "sounds", "jovo_delivery.wav");

const semitone = (base, steps) => base * 2 ** (steps / 12);

// A bright bell: a few harmonic and slightly inharmonic partials with a near-instant attack and an
// exponential decay. Higher partials die faster, which is what makes it sound struck rather than
// buzzed.
function bell(buffer, startSeconds, frequency, lengthSeconds, level) {
  const partials = [
    { ratio: 1, gain: 1.0, decay: 1.0 },
    { ratio: 2, gain: 0.55, decay: 0.8 },
    { ratio: 3, gain: 0.32, decay: 0.6 },
    { ratio: 4.16, gain: 0.2, decay: 0.45 },
    { ratio: 5.43, gain: 0.1, decay: 0.3 }
  ];
  const start = Math.floor(startSeconds * sampleRate);
  const length = Math.floor(lengthSeconds * sampleRate);
  for (let index = 0; index < length && start + index < buffer.length; index += 1) {
    const time = index / sampleRate;
    const attack = Math.min(1, time / 0.004);
    let sample = 0;
    for (const partial of partials) {
      const envelope = Math.exp((-time * 5.5) / (lengthSeconds * partial.decay));
      sample += partial.gain * envelope * Math.sin(2 * Math.PI * frequency * partial.ratio * time);
    }
    buffer[start + index] += level * attack * sample;
  }
}

const totalSeconds = 3.7;
const buffer = new Float64Array(Math.floor(totalSeconds * sampleRate));

// Base pitch C6 (1046 Hz); the fundamental of the top note is ~2.1 kHz.
const base = 1046.5;
const motif = [
  { at: 0.0, steps: 0, length: 0.16 },
  { at: 0.15, steps: 4, length: 0.16 },
  { at: 0.3, steps: 7, length: 0.16 },
  { at: 0.5, steps: 12, length: 0.6 }
];
for (let repeat = 0; repeat < 3; repeat += 1) {
  const offset = repeat * 1.2;
  const lift = repeat * 2; // each repeat is a whole tone higher, so it sounds like it is climbing
  for (const note of motif) {
    bell(buffer, offset + note.at, semitone(base, note.steps + lift), note.length + 0.25, 1);
  }
}

// Push the average level up without letting peaks clip: drive into tanh, then normalise to -1 dBFS.
const drive = 2.4;
let peak = 0;
for (let index = 0; index < buffer.length; index += 1) {
  buffer[index] = Math.tanh(buffer[index] * drive);
  peak = Math.max(peak, Math.abs(buffer[index]));
}
const targetPeak = 10 ** (-1 / 20);
const fadeSamples = Math.floor(0.02 * sampleRate);
const pcm = Buffer.alloc(buffer.length * 2);
let sumSquares = 0;
for (let index = 0; index < buffer.length; index += 1) {
  const tail = buffer.length - index;
  const fade = tail < fadeSamples ? tail / fadeSamples : 1;
  const value = (buffer[index] / peak) * targetPeak * fade;
  sumSquares += value * value;
  pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, value)) * 32767), index * 2);
}

const header = Buffer.alloc(44);
header.write("RIFF", 0);
header.writeUInt32LE(36 + pcm.length, 4);
header.write("WAVE", 8);
header.write("fmt ", 12);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20); // PCM
header.writeUInt16LE(1, 22); // mono
header.writeUInt32LE(sampleRate, 24);
header.writeUInt32LE(sampleRate * 2, 28);
header.writeUInt16LE(2, 32);
header.writeUInt16LE(16, 34);
header.write("data", 36);
header.writeUInt32LE(pcm.length, 40);

mkdirSync(path.dirname(target), { recursive: true });
writeFileSync(target, Buffer.concat([header, pcm]));
const rmsDb = 20 * Math.log10(Math.sqrt(sumSquares / buffer.length));
console.log(
  `${path.relative(root, target)}: ${(buffer.length / sampleRate).toFixed(2)} s, ` +
    `peak -1.0 dBFS, RMS ${rmsDb.toFixed(1)} dBFS, ${(pcm.length + 44) / 1000} kB`
);
