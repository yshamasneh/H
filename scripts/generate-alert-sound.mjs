// Generates the JOVO alert sounds:
//
//   apps/mobile/assets/sounds/jovo_delivery.wav        driver: a new delivery is waiting
//   apps/mobile/assets/sounds/jovo_order.wav           store: a new order arrived (played in-app)
//   (+ the Android res/raw copy of the delivery sound, and the admin console's copy of jovo_order.wav)
//
//   node scripts/generate-alert-sound.mjs
//
// The sounds are synthesised, not sampled, so they have no licence attached and can be regenerated
// or retuned. Output: 44.1 kHz, 16-bit, mono PCM WAV. Linear PCM is what iOS accepts for custom
// notification sounds (under 30 s), what Android's res/raw expects, and what every browser decodes.
//
// DELIVERY (driver). Design goals, in order:
//   1. Get through road noise and a phone in a pocket. Engine and tyre noise sits below ~500 Hz and
//      a phone speaker cannot reproduce much under ~600 Hz anyway, so every partial lives between
//      roughly 1 and 6 kHz, and the level is pushed to near full scale with a soft limiter so the
//      average loudness (not just the peak) is high.
//   2. Be unmistakable. Four rising bell notes (one per syllable of "J-O-V-O") ending on a held
//      accent, then repeated three times with a small step up in pitch. No system tone sounds like it.
//   3. Stay short. ~3.6 s: long enough to catch attention, short enough not to be a ringtone.
//
// ORDER (store). A shop floor with customers in it, not a car, so the goals shift:
//   1. Carry across a room without sounding like an alarm. Same bell family as the driver sound (it
//      is recognisably JOVO) but a warmer register — the top fundamental is ~1.3 kHz rather than
//      ~2.4 kHz — fewer inharmonic partials, and far less limiter drive, so it rings rather than
//      shrieks. The peak is still near full scale: quiet is the wrong failure in a busy store.
//   2. Be distinct from the driver sound and from any phone's default chime: a falling-then-rising
//      four-note figure (a doorbell-like "ding-dong" answered by a lift), played twice.
//   3. Be short enough to loop. The clients repeat it every few seconds while an order is still
//      waiting, so a single play is ~2.3 s with a clean tail.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const sampleRate = 44_100;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const semitone = (base, steps) => base * 2 ** (steps / 12);

// A bright bell: a few harmonic and slightly inharmonic partials with a near-instant attack and an
// exponential decay. Higher partials die faster, which is what makes it sound struck rather than
// buzzed.
const brightPartials = [
  { ratio: 1, gain: 1.0, decay: 1.0 },
  { ratio: 2, gain: 0.55, decay: 0.8 },
  { ratio: 3, gain: 0.32, decay: 0.6 },
  { ratio: 4.16, gain: 0.2, decay: 0.45 },
  { ratio: 5.43, gain: 0.1, decay: 0.3 }
];
// A rounder bell for indoors: the fundamental dominates and the metallic inharmonic partial is faint.
const warmPartials = [
  { ratio: 1, gain: 1.0, decay: 1.0 },
  { ratio: 2, gain: 0.42, decay: 0.75 },
  { ratio: 3, gain: 0.16, decay: 0.5 },
  { ratio: 4.2, gain: 0.06, decay: 0.35 }
];

function bell(buffer, startSeconds, frequency, lengthSeconds, level, partials) {
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

function deliverySound() {
  const buffer = new Float64Array(Math.floor(3.7 * sampleRate));
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
      bell(buffer, offset + note.at, semitone(base, note.steps + lift), note.length + 0.25, 1, brightPartials);
    }
  }
  return { buffer, drive: 2.4 };
}

function orderSound() {
  const buffer = new Float64Array(Math.floor(2.3 * sampleRate));
  // Base pitch A5 (880 Hz). "Ding-dong" down a fourth, then up through the fifth to the octave.
  const base = 880;
  const motif = [
    { at: 0.0, steps: 7, length: 0.3 },
    { at: 0.22, steps: 0, length: 0.3 },
    { at: 0.44, steps: 4, length: 0.22 },
    { at: 0.6, steps: 7, length: 0.55 }
  ];
  for (let repeat = 0; repeat < 2; repeat += 1) {
    const offset = repeat * 1.05;
    // The answer is a touch quieter, so the figure reads as one call rather than two alarms.
    const level = repeat === 0 ? 1 : 0.8;
    for (const note of motif) {
      bell(buffer, offset + note.at, semitone(base, note.steps), note.length + 0.3, level, warmPartials);
    }
  }
  return { buffer, drive: 1.3 };
}

function encode({ buffer, drive }) {
  // Push the average level up without letting peaks clip: drive into tanh, then normalise to -1 dBFS.
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
  return {
    file: Buffer.concat([header, pcm]),
    seconds: buffer.length / sampleRate,
    rmsDb: 20 * Math.log10(Math.sqrt(sumSquares / buffer.length))
  };
}

const mobile = path.join(root, "apps", "mobile");
const androidRaw = path.join(mobile, "android", "app", "src", "main", "res", "raw");
const outputs = [
  {
    sound: deliverySound,
    targets: [path.join(mobile, "assets", "sounds", "jovo_delivery.wav"), path.join(androidRaw, "jovo_delivery.wav")]
  },
  {
    sound: orderSound,
    targets: [
      path.join(mobile, "assets", "sounds", "jovo_order.wav"),
      path.join(root, "apps", "admin", "src", "assets", "sounds", "jovo_order.wav")
    ]
  }
];

for (const { sound, targets } of outputs) {
  const { file, seconds, rmsDb } = encode(sound());
  for (const target of targets) {
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, file);
    console.log(
      `${path.relative(root, target)}: ${seconds.toFixed(2)} s, peak -1.0 dBFS, RMS ${rmsDb.toFixed(1)} dBFS, ${file.length / 1000} kB`
    );
  }
}
