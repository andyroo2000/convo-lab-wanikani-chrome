(function installAudioHelpers(root) {
  function encodeMonoWav(samples, sampleRate) {
    const length = samples.length;
    const buffer = new ArrayBuffer(44 + length * 2);
    const view = new DataView(buffer);
    const write = (offset, value) => {
      for (let index = 0; index < value.length; index += 1) {
        view.setUint8(offset + index, value.charCodeAt(index));
      }
    };
    write(0, "RIFF");
    view.setUint32(4, 36 + length * 2, true);
    write(8, "WAVE");
    write(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    write(36, "data");
    view.setUint32(40, length * 2, true);
    for (let index = 0; index < length; index += 1) {
      const sample = Math.max(-1, Math.min(1, samples[index]));
      view.setInt16(44 + index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    }
    return buffer;
  }

  function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let output = "";
    const blockSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += blockSize) {
      output += String.fromCharCode(...bytes.subarray(offset, offset + blockSize));
    }
    return btoa(output);
  }

  function base64ToArrayBuffer(value) {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes.buffer;
  }

  function trimAndFade(samples, sampleRate, startSeconds, endSeconds, options = {}) {
    const start = Math.max(0, Math.floor(startSeconds * sampleRate));
    const end = Math.min(samples.length, Math.ceil(endSeconds * sampleRate));
    if (end <= start) throw new Error("The audio selection is empty.");
    const output = samples.slice(start, end);
    const fadeSamples = Math.min(
      Math.floor((options.fadeSeconds ?? 0.025) * sampleRate),
      Math.floor(output.length / 2),
    );
    if (options.fadeIn) {
      for (let index = 0; index < fadeSamples; index += 1) {
        output[index] *= index / fadeSamples;
      }
    }
    if (options.fadeOut) {
      for (let index = 0; index < fadeSamples; index += 1) {
        output[output.length - 1 - index] *= index / fadeSamples;
      }
    }
    return output;
  }

  function waveformPeaks(samples, bins) {
    const count = Math.max(1, Math.floor(bins));
    const peaks = new Array(count).fill(0);
    const stride = samples.length / count;
    for (let bin = 0; bin < count; bin += 1) {
      const start = Math.floor(bin * stride);
      const end = Math.max(start + 1, Math.floor((bin + 1) * stride));
      let peak = 0;
      for (let index = start; index < Math.min(end, samples.length); index += 1) {
        peak = Math.max(peak, Math.abs(samples[index]));
      }
      peaks[bin] = peak;
    }
    return peaks;
  }

  root.ConvoLabAudio = Object.freeze({
    arrayBufferToBase64,
    base64ToArrayBuffer,
    encodeMonoWav,
    trimAndFade,
    waveformPeaks,
  });
})(globalThis);
