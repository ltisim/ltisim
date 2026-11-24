// AudioWorklet: capture-rate Float32 mono → 16kHz Int16 PCM in 100ms frames.
//
// Feeds the voice-input WebSocket (Amazon Transcribe streaming expects
// 16kHz little-endian PCM). Downsampling uses a box-filter average over each
// decimation window — a crude but effective low-pass that avoids the
// aliasing a nearest-sample pick folds into the speech band (it audibly
// costs consonant accuracy). `sampleRate` is the AudioWorkletGlobalScope's
// context rate (48000 on almost every device, 44100 on some).
//
// Served from / (Vite public dir) and loaded by audioWorklet.addModule in
// transcribe-client.js.

class PcmDownsampler extends AudioWorkletProcessor {
  constructor() {
    super()
    this.ratio = sampleRate / 16000
    this.readPos = 0 // fractional read position within the current block
    this.out = new Int16Array(1600) // 100ms at 16kHz
    this.outLen = 0
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0]
    if (!ch) return true
    let pos = this.readPos
    while (pos < ch.length) {
      // Average the samples in [pos, pos + ratio) that fall inside this block.
      const start = Math.floor(pos)
      const end = Math.min(ch.length, Math.max(start + 1, Math.floor(pos + this.ratio)))
      let sum = 0
      for (let i = start; i < end; i++) sum += ch[i]
      let s = sum / (end - start)
      if (s > 1) s = 1
      else if (s < -1) s = -1
      this.out[this.outLen++] = s < 0 ? s * 0x8000 : s * 0x7fff
      if (this.outLen === this.out.length) {
        const frame = this.out
        this.port.postMessage(frame.buffer, [frame.buffer])
        this.out = new Int16Array(1600)
        this.outLen = 0
      }
      pos += this.ratio
    }
    this.readPos = pos - ch.length
    return true
  }
}

registerProcessor('pcm-downsampler', PcmDownsampler)
