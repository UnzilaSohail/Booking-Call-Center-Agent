// Audio bridge helpers (plan.md §6 "Audio format mismatch"): Twilio Media Streams send/
// expect 8kHz 8-bit G.711 mu-law; Gemini Live's native audio session expects 16-bit PCM
// at 16kHz in and produces 16-bit PCM at 24kHz out. Every hop here is intentionally a
// plain, dependency-free implementation so the bridge has no native-addon build step.

const MULAW_BIAS = 0x84;
const MULAW_CLIP = 32635;

function muLawDecodeByte(byte) {
  byte = ~byte & 0xff;
  const sign = byte & 0x80;
  const exponent = (byte >> 4) & 0x07;
  const mantissa = byte & 0x0f;
  let sample = ((mantissa << 3) + MULAW_BIAS) << exponent;
  sample -= MULAW_BIAS;
  return sign ? -sample : sample;
}

function muLawEncodeSample(sample) {
  let sign = (sample >> 8) & 0x80;
  if (sign) sample = -sample;
  if (sample > MULAW_CLIP) sample = MULAW_CLIP;
  sample += MULAW_BIAS;
  let exponent = 7;
  for (let mask = 0x4000; (sample & mask) === 0 && exponent > 0; exponent--, mask >>= 1);
  const mantissa = (sample >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

// mu-law bytes -> Int16Array PCM samples (same sample rate, just codec conversion).
export function muLawToPCM16(buffer) {
  const out = new Int16Array(buffer.length);
  for (let i = 0; i < buffer.length; i++) out[i] = muLawDecodeByte(buffer[i]);
  return out;
}

// Int16Array PCM samples -> mu-law bytes.
export function pcm16ToMuLaw(samples) {
  const out = Buffer.alloc(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = muLawEncodeSample(samples[i]);
  return out;
}

// Linear-interpolation resample. Good enough for phone-quality voice (8kHz source is
// already band-limited to ~3.4kHz); a polyphase/FIR resampler would be overkill here.
export function resamplePCM16(samples, fromRate, toRate) {
  if (fromRate === toRate) return samples;
  const ratio = fromRate / toRate;
  const outLength = Math.round(samples.length / ratio);
  const out = new Int16Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const srcPos = i * ratio;
    const idx = Math.floor(srcPos);
    const frac = srcPos - idx;
    const s0 = samples[idx] ?? 0;
    const s1 = samples[idx + 1] ?? s0;
    out[i] = Math.round(s0 + (s1 - s0) * frac);
  }
  return out;
}

// Twilio media payload (base64 mu-law @ 8kHz) -> base64 PCM16 @ 16kHz for Gemini Live input.
export function twilioPayloadToGeminiPCM(base64Payload) {
  const muLawBuffer = Buffer.from(base64Payload, 'base64');
  const pcm8k = muLawToPCM16(muLawBuffer);
  const pcm16k = resamplePCM16(pcm8k, 8000, 16000);
  return Buffer.from(pcm16k.buffer, pcm16k.byteOffset, pcm16k.byteLength).toString('base64');
}

// Gemini Live output (base64 PCM16 @ 24kHz) -> base64 mu-law @ 8kHz for a Twilio media event.
export function geminiPCMToTwilioPayload(base64Pcm24k) {
  const buf = Buffer.from(base64Pcm24k, 'base64');
  const pcm24k = new Int16Array(buf.buffer, buf.byteOffset, buf.length / 2);
  const pcm8k = resamplePCM16(pcm24k, 24000, 8000);
  return pcm16ToMuLaw(pcm8k).toString('base64');
}
