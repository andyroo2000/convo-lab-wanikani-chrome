(function installScreenshotBuffer(root) {
  const MAX_BYTES = 16 * 1024 * 1024;
  const MAX_AGE_MS = 180_000;

  function selectCandidates(frames, start, end, count = 5) {
    const matching = frames.filter(frame => frame.timeMs >= start && frame.timeMs <= end);
    if (matching.length <= count) return matching;
    return Array.from({ length: count }, (_, index) => matching[Math.round(index * (matching.length - 1) / (count - 1))]);
  }

  function isBlank(pixels) {
    let visible = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if (Math.max(pixels[index], pixels[index + 1], pixels[index + 2]) > 18) visible += 1;
    }
    return visible < pixels.length / 4 * 0.01;
  }

  function frameFromVideo(video) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.min(video.videoWidth, 960);
    canvas.height = Math.round(video.videoHeight * canvas.width / video.videoWidth);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    if (isBlank(context.getImageData(0, 0, canvas.width, canvas.height).data)) return null;
    return canvas.toDataURL("image/jpeg", 0.75);
  }

  async function visibleScreenshot(video, send) {
    const rect = video.getBoundingClientRect();
    document.documentElement.classList.add("convolab-taking-screenshot");
    try {
      const result = await send({
        type: "CAPTURE_SCREENSHOT",
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        viewport: { width: innerWidth, height: innerHeight },
      });
      // Protected playback can produce an all-black image even when capture succeeds.
      const image = new Image();
      image.src = result.dataUrl;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = 64;
      canvas.height = 36;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      context.drawImage(image, 0, 0, 64, 36);
      return isBlank(context.getImageData(0, 0, 64, 36).data) ? null : result;
    } finally {
      document.documentElement.classList.remove("convolab-taking-screenshot");
    }
  }

  function canSample(video) {
    if (document.visibilityState !== "visible") return false;
    if (!video) return false;
    if (video.paused || video.seeking) return false;
    return video.videoWidth > 0 && video.videoHeight > 0;
  }

  class ScreenshotBuffer {
    constructor(send) {
      this.send = send;
      this.items = [];
      this.bytes = 0;
      this.busy = false;
      this.generation = 0;
      this.source = "";
    }

    clear() { this.items = []; this.bytes = 0; this.generation += 1; }
    frames() { return this.items.slice(); }

    overLimit(now) {
      if (!this.items.length) return false;
      return this.bytes > MAX_BYTES || this.items[0].timeMs < now - MAX_AGE_MS;
    }

    append(frame) {
      this.items.push(frame);
      this.bytes += frame.dataUrl.length;
      while (this.overLimit(frame.timeMs)) {
        this.bytes -= this.items.shift().dataUrl.length;
      }
    }

    async capture(video) {
      try {
        const direct = frameFromVideo(video);
        if (direct) return { dataUrl: direct, timeMs: Date.now() };
      } catch { /* Canvas reads can be blocked for cross-origin or protected video. */ }
      return visibleScreenshot(video, this.send);
    }

    syncSource() {
      if (this.source !== location.href) { this.clear(); this.source = location.href; }
    }

    async sample(video) {
      if (this.busy || !canSample(video)) return;
      this.syncSource();
      const requestGeneration = this.generation;
      this.busy = true;
      try {
        const frame = await this.capture(video);
        if (requestGeneration !== this.generation) return;
        if (frame) this.append(frame);
      } catch { /* Audio capture remains usable when screenshots are unavailable. */ }
      finally { this.busy = false; }
    }
  }

  const createBuffer = send => new ScreenshotBuffer(send);
  root.ConvoLabScreenshots = { createBuffer, selectCandidates, isBlank };
})(globalThis);
