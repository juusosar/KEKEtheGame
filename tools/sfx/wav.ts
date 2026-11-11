// 16-bit mono PCM WAV encode/decode for the generated sounds. Every browser decodes WAV, and PCM keeps the
// generator free of codec dependencies.

/** Encodes samples in -1..1 as a 16-bit mono WAV file. */
export function encodeWav(samples: Float32Array, sampleRate: number): Buffer {
  const dataBytes = samples.length * 2;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16); // fmt chunk size
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buf.writeUInt16LE(2, 32); // block align
  buf.writeUInt16LE(16, 34); // bits per sample
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] ?? 0));
    buf.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
  }
  return buf;
}

export interface DecodedWav {
  sampleRate: number;
  /** Raw 16-bit sample values. */
  samples: Int16Array;
}

/** Decodes a file written by encodeWav (16-bit mono PCM with the 44-byte header). */
export function decodeWav(buf: Buffer): DecodedWav {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('not a RIFF/WAVE file');
  }
  if (buf.readUInt16LE(20) !== 1 || buf.readUInt16LE(22) !== 1 || buf.readUInt16LE(34) !== 16) {
    throw new Error('expected 16-bit mono PCM');
  }
  if (buf.toString('ascii', 36, 40) !== 'data') throw new Error('data chunk not at byte 36');
  const sampleRate = buf.readUInt32LE(24);
  const count = buf.readUInt32LE(40) / 2;
  const samples = new Int16Array(count);
  for (let i = 0; i < count; i++) samples[i] = buf.readInt16LE(44 + i * 2);
  return { sampleRate, samples };
}
