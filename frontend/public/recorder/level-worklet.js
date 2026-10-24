// The call recorder's level meter (lib/recorder/browserEngine.ts).
//
// Runs on the audio thread, so it keeps measuring while The Same Page is a
// background tab behind the video call (requestAnimationFrame stops there and
// timers are throttled). It never sees anything but loudness: it posts the
// loudest RMS it measured roughly four times a second, and the audio itself
// goes nowhere. Served from /public so the CSP's script-src 'self' covers it.

class LevelProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.peak = 0;
    this.frames = 0;
    // sampleRate is a global in AudioWorkletGlobalScope.
    this.every = Math.round(sampleRate / 4);
  }

  process(inputs) {
    const input = inputs[0];
    if (input && input.length) {
      const block = input[0].length;
      for (let c = 0; c < input.length; c++) {
        const data = input[c];
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
        const rms = Math.sqrt(sum / (data.length || 1));
        if (rms > this.peak) this.peak = rms;
      }
      this.frames += block;
    } else {
      this.frames += 128;
    }
    if (this.frames >= this.every) {
      this.port.postMessage(this.peak);
      this.peak = 0;
      this.frames = 0;
    }
    return true;
  }
}

registerProcessor("tsp-level", LevelProcessor);
