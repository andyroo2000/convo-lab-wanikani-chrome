(() => {
  const MAX_BUFFER_SECONDS = 180;
  let mediaStream = null;
  let audioContext = null;
  let sourceNode = null;
  let processorNode = null;
  let chunks = [];
  let sampleRate = 48_000;
  let contextWallOrigin = 0;
  let captureTabId = null;

  function stopCapture() {
    processorNode?.disconnect();
    sourceNode?.disconnect();
    mediaStream?.getTracks().forEach((track) => track.stop());
    audioContext?.close().catch(() => {});
    mediaStream = null;
    audioContext = null;
    sourceNode = null;
    processorNode = null;
    chunks = [];
    captureTabId = null;
  }

  function rememberAudio(event) {
    const input = event.inputBuffer;
    const output = event.outputBuffer;
    const length = input.length;
    const mono = new Float32Array(length);
    const channels = input.numberOfChannels;
    for (let channel = 0; channel < channels; channel += 1) {
      const values = input.getChannelData(channel);
      for (let index = 0; index < length; index += 1) mono[index] += values[index] / channels;
      if (channel < output.numberOfChannels) output.copyToChannel(values, channel);
    }
    if (channels === 1 && output.numberOfChannels > 1) output.copyToChannel(input.getChannelData(0), 1);
    const startTimeMs = contextWallOrigin + event.playbackTime * 1000;
    chunks.push({ startTimeMs, samples: mono });
    const cutoff = startTimeMs - MAX_BUFFER_SECONDS * 1000;
    while (chunks.length && chunks[0].startTimeMs + chunks[0].samples.length / sampleRate * 1000 < cutoff) {
      chunks.shift();
    }
  }

  async function startCapture(streamId, tabId) {
    stopCapture();
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: "tab",
          chromeMediaSourceId: streamId,
        },
      },
      video: false,
    });
    audioContext = new AudioContext();
    await audioContext.resume();
    sampleRate = audioContext.sampleRate;
    contextWallOrigin = Date.now() - audioContext.currentTime * 1000;
    sourceNode = audioContext.createMediaStreamSource(mediaStream);
    processorNode = audioContext.createScriptProcessor(4096, 2, 2);
    processorNode.onaudioprocess = rememberAudio;
    sourceNode.connect(processorNode);
    processorNode.connect(audioContext.destination);
    captureTabId = tabId;
    mediaStream.getAudioTracks()[0]?.addEventListener("ended", () => {
      chrome.runtime.sendMessage({ type: "MEDIA_CAPTURE_ENDED", tabId: captureTabId }).catch(() => {});
      stopCapture();
    }, { once: true });
  }

  function audioWindow(startTimeMs, endTimeMs) {
    if (!audioContext || chunks.length === 0) throw new Error("No captured audio is available yet.");
    const requestedStart = Math.max(startTimeMs, chunks[0].startTimeMs);
    const last = chunks[chunks.length - 1];
    const bufferedEnd = last.startTimeMs + last.samples.length / sampleRate * 1000;
    const requestedEnd = Math.min(endTimeMs, bufferedEnd);
    if (requestedEnd <= requestedStart) throw new Error("That dialogue is outside the rolling audio buffer.");
    const length = Math.ceil((requestedEnd - requestedStart) / 1000 * sampleRate);
    const samples = new Float32Array(length);
    copyWindowSamples(samples, requestedStart, requestedEnd);
    return {
      audioBase64: ConvoLabAudio.arrayBufferToBase64(ConvoLabAudio.encodeMonoWav(samples, sampleRate)),
      sampleRate,
      startTimeMs: requestedStart,
      endTimeMs: requestedEnd,
    };
  }

  function copyWindowSamples(samples, requestedStart, requestedEnd) {
    for (const chunk of chunks) {
      const chunkEnd = chunk.startTimeMs + chunk.samples.length / sampleRate * 1000;
      if (chunkEnd <= requestedStart || chunk.startTimeMs >= requestedEnd) continue;
      const sourceStart = Math.max(0, Math.floor((requestedStart - chunk.startTimeMs) / 1000 * sampleRate));
      const destinationStart = Math.max(0, Math.round((chunk.startTimeMs - requestedStart) / 1000 * sampleRate));
      const count = Math.min(chunk.samples.length - sourceStart, samples.length - destinationStart);
      if (count > 0) samples.set(chunk.samples.subarray(sourceStart, sourceStart + count), destinationStart);
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.target !== "offscreen") return false;
    const operation = async () => {
      switch (message.type) {
        case "START_MEDIA_CAPTURE":
          await startCapture(message.streamId, message.tabId);
          return { tabId: captureTabId };
        case "STOP_MEDIA_CAPTURE":
          stopCapture();
          return { stopped: true };
        case "GET_AUDIO_WINDOW":
          return audioWindow(message.startTimeMs, message.endTimeMs);
        case "GET_MEDIA_CAPTURE_STATE":
          return { tabId: captureTabId, capturing: Boolean(mediaStream) };
        default:
          throw new Error("Unsupported offscreen operation.");
      }
    };
    operation()
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  });
})();
