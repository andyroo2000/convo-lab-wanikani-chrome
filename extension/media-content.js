(() => {
  const COMMAND_EVENT = "convolab-media-command";
  const UPDATE_EVENT = "convolab-subtitle-update";
  let enabled = false;
  let current = null;
  let host = null;
  let subtitleBox = null;
  let japaneseLine = null;
  let englishLine = null;
  let cardButton = null;
  let toastTimer = null;
  let closeEditor = null;
  const screenshots = ConvoLabScreenshots.createBuffer(send);

  async function send(message) {
    const response = await chrome.runtime.sendMessage(message);
    if (!response?.ok) throw new Error(response?.error || "The extension did not respond.");
    return response.result;
  }

  function mountTarget() {
    return document.fullscreenElement || document.documentElement;
  }

  function ensureHost() {
    if (!host) {
      host = document.createElement("div");
      host.id = "convolab-media-root";
      subtitleBox = document.createElement("section");
      subtitleBox.className = "convolab-subtitles";
      subtitleBox.hidden = true;
      japaneseLine = document.createElement("p");
      japaneseLine.className = "convolab-subtitle-ja";
      englishLine = document.createElement("p");
      englishLine.className = "convolab-subtitle-en";
      cardButton = document.createElement("button");
      cardButton.className = "convolab-card-button";
      cardButton.type = "button";
      cardButton.textContent = "+ Card";
      cardButton.setAttribute("aria-label", "Create an audio recognition card from this dialogue");
      cardButton.addEventListener("click", openEditor);
      subtitleBox.append(japaneseLine, englishLine, cardButton);
      host.append(subtitleBox);
    }
    const target = mountTarget();
    if (host.parentElement !== target) target.append(host);
  }

  function showToast(message, timeout = 3500) {
    ensureHost();
    host.querySelector(".convolab-toast")?.remove();
    const toast = document.createElement("div");
    toast.className = "convolab-toast";
    toast.textContent = message;
    host.append(toast);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.remove(), timeout);
  }

  function setEnabled(value) {
    enabled = value;
    ensureHost();
    document.body?.classList.toggle("convolab-media-enabled", enabled);
    if (!enabled) {
      screenshots.clear();
      subtitleBox.hidden = true;
      closeEditor?.(false);
    }
    window.dispatchEvent(new CustomEvent(COMMAND_EVENT, { detail: { enabled } }));
  }

  function videoElement() {
    return [...document.querySelectorAll("video")].find((video) => video.duration > 0)
      || document.querySelector("video");
  }

  function renderCue(detail) {
    current = detail;
    ensureHost();
    const japanese = detail.japanese?.text || "";
    const english = detail.english?.text || "";
    japaneseLine.textContent = japanese;
    englishLine.textContent = english;
    englishLine.hidden = !english;
    cardButton.hidden = !japanese;
    subtitleBox.hidden = !japanese && !english;
  }

  function drawWaveform(canvas, peaks, start, end) {
    const scale = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.floor(canvas.clientWidth * scale));
    const height = Math.max(1, Math.floor(canvas.clientHeight * scale));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const context = canvas.getContext("2d");
    context.clearRect(0, 0, width, height);
    const startX = start * width;
    const endX = end * width;
    context.fillStyle = "#c4d1db";
    context.fillRect(0, 0, startX, height);
    context.fillRect(endX, 0, width - endX, height);
    context.strokeStyle = "#245985";
    context.lineWidth = Math.max(1, scale);
    context.beginPath();
    peaks.forEach((peak, index) => {
      const x = index / Math.max(1, peaks.length - 1) * width;
      const amplitude = Math.max(1, peak * height * 0.46);
      context.moveTo(x, height / 2 - amplitude);
      context.lineTo(x, height / 2 + amplitude);
    });
    context.stroke();
    context.strokeStyle = "#ef7b2d";
    context.lineWidth = 3 * scale;
    for (const x of [startX, endX]) {
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, height);
      context.stroke();
    }
  }

  function wavBlob(base64) {
    return new Blob([ConvoLabAudio.base64ToArrayBuffer(base64)], { type: "audio/wav" });
  }

  async function openEditor(event) {
    if (!event.isTrusted) return;
    if (!current?.japanese) return;
    const video = videoElement();
    if (!video) return;
    const snapshot = current;
    const now = Date.now();
    const rate = video.playbackRate || 1;
    const cueStartMs = now - (video.currentTime - snapshot.japanese.start) / rate * 1000;
    const cueEndMs = now + (snapshot.japanese.end - video.currentTime) / rate * 1000;
    cardButton.disabled = true;
    try {
      await finishCue(video, cueEndMs - now);
      video.pause();
      const windowAudio = await send({
        type: "GET_AUDIO_WINDOW",
        startTimeMs: cueStartMs - 1000,
        endTimeMs: cueEndMs + 1000,
      });
      await renderEditor(snapshot, windowAudio, cueStartMs, cueEndMs, video);
    } catch (error) {
      showToast(error.message, 6000);
      video.play().catch(() => {});
    } finally {
      cardButton.disabled = false;
    }
  }

  async function finishCue(video, milliseconds) {
    const remainingMs = Math.max(0, Math.min(15_000, milliseconds + 150));
    if (remainingMs <= 150) return;
    showToast("Finishing this line before opening the audio editor…", remainingMs + 1000);
    if (video.paused) await video.play();
    await new Promise(resolve => setTimeout(resolve, remainingMs));
  }

  async function renderEditor(snapshot, windowAudio, cueStartMs, cueEndMs, video) {
    ensureHost();
    const decodeContext = new AudioContext();
    let audioBuffer;
    try {
      audioBuffer = await decodeContext.decodeAudioData(
        ConvoLabAudio.base64ToArrayBuffer(windowAudio.audioBase64).slice(0),
      );
    } finally {
      await decodeContext.close();
    }
    const samples = audioBuffer.getChannelData(0).slice();
    const duration = audioBuffer.duration;
    let trimStart = Math.max(0, (cueStartMs - windowAudio.startTimeMs) / 1000);
    let trimEnd = Math.min(duration, (cueEndMs - windowAudio.startTimeMs) / 1000);
    if (trimEnd - trimStart < 0.15) {
      trimStart = Math.max(0, duration / 2 - 1.5);
      trimEnd = Math.min(duration, duration / 2 + 1.5);
    }

    const cardId = captureId();
    const backdrop = document.createElement("div");
    backdrop.className = "convolab-editor-backdrop";
    backdrop.innerHTML = `
      <section class="convolab-editor" role="dialog" aria-modal="true" aria-labelledby="convolab-editor-title">
        <h2 id="convolab-editor-title">New audio recognition card</h2>
        <label>Japanese dialogue<textarea name="japanese" required></textarea></label>
        <label>English meaning<textarea name="english" required></textarea></label>
        <p>Drag the orange handles or edit the start and end times to trim the audio.</p>
        <canvas class="convolab-waveform" aria-label="Audio waveform with draggable start and end handles"></canvas>
        <div class="convolab-trim-inputs">
          <label>Start (seconds)<input name="trimStart" type="number" step="0.01"></label>
          <label>End (seconds)<input name="trimEnd" type="number" step="0.01"></label>
        </div>
        <div class="convolab-trim-values"><span data-start></span><span data-duration></span><span data-end></span></div>
        <div class="convolab-fades">
          <label><input type="checkbox" name="fadeIn" checked> Fast fade-in</label>
          <label><input type="checkbox" name="fadeOut" checked> Fast fade-out</label>
        </div>
        <section class="convolab-screenshot-picker"></section>
        <p class="convolab-editor-error" role="alert" hidden></p>
        <div class="convolab-editor-actions">
          <button type="button" class="secondary" data-preview>Play selection</button>
          <button type="button" class="secondary" data-cancel>Cancel</button>
          <button type="button" data-create>Create at front of queue</button>
        </div>
      </section>`;
    const japaneseInput = backdrop.querySelector("[name='japanese']");
    const englishInput = backdrop.querySelector("[name='english']");
    const canvas = backdrop.querySelector("canvas");
    const errorElement = backdrop.querySelector(".convolab-editor-error");
    japaneseInput.value = snapshot.japanese.text;
    englishInput.value = snapshot.english?.text || "";
    host.append(backdrop);
    const picker = ConvoLabScreenshotPicker.createPicker(backdrop.querySelector(".convolab-screenshot-picker"), screenshots.frames(), windowAudio.startTimeMs);

    const playbackUrl = URL.createObjectURL(wavBlob(windowAudio.audioBase64));
    const audio = new Audio(playbackUrl);
    let playbackTimer = null;
    const peaks = ConvoLabAudio.waveformPeaks(samples, 480);
    const syncTrimInputs = ConvoLabEditorControls.bindTrimInputs(backdrop, duration, changeTrim);
    const update = () => {
      syncTrimInputs(trimStart, trimEnd);
      drawWaveform(canvas, peaks, trimStart / duration, trimEnd / duration);
      picker.update(trimStart, trimEnd);
      backdrop.querySelector("[data-start]").textContent = `Start ${trimStart.toFixed(2)}s`;
      backdrop.querySelector("[data-duration]").textContent = `${(trimEnd - trimStart).toFixed(2)}s selected`;
      backdrop.querySelector("[data-end]").textContent = `End ${trimEnd.toFixed(2)}s`;
    };
    update();

    function changeTrim(side, value) {
      const bounded = Math.max(0, Math.min(duration, value));
      if (side === "start") trimStart = Math.min(bounded, trimEnd - 0.1);
      else trimEnd = Math.max(bounded, trimStart + 0.1);
      update();
    }

    let dragging = null;
    canvas.addEventListener("pointerdown", (event) => {
      const ratio = (event.clientX - canvas.getBoundingClientRect().left) / canvas.clientWidth;
      dragging = Math.abs(ratio - trimStart / duration) < Math.abs(ratio - trimEnd / duration) ? "start" : "end";
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener("pointermove", (event) => {
      if (!dragging) return;
      const ratio = Math.max(0, Math.min(1, (event.clientX - canvas.getBoundingClientRect().left) / canvas.clientWidth));
      const value = ratio * duration;
      changeTrim(dragging, value);
    });
    canvas.addEventListener("pointerup", () => { dragging = null; });
    window.addEventListener("resize", update, { once: true });

    const close = (resume = true) => {
      clearInterval(playbackTimer);
      audio.pause();
      URL.revokeObjectURL(playbackUrl);
      backdrop.remove();
      window.removeEventListener("resize", update);
      restoreFocus();
      closeEditor = null;
      if (resume) video.play().catch(() => {});
    };
    const restoreFocus = ConvoLabEditorControls.bindDialog(backdrop, close, cardButton);
    closeEditor = close;
    backdrop.querySelector("[data-cancel]").addEventListener("click", () => close());
    backdrop.querySelector("[data-preview]").addEventListener("click", async () => {
      clearInterval(playbackTimer);
      audio.currentTime = trimStart;
      await audio.play();
      playbackTimer = setInterval(() => {
        if (audio.currentTime >= trimEnd) {
          audio.pause();
          clearInterval(playbackTimer);
        }
      }, 20);
    });
    backdrop.querySelector("[data-create]").addEventListener("click", async (event) => {
      if (!event.isTrusted) return;
      const buttons = [...backdrop.querySelectorAll("button")];
      buttons.forEach((button) => { button.disabled = true; });
      errorElement.hidden = true;
      try {
        const japanese = japaneseInput.value.trim();
        const english = englishInput.value.trim();
        if (!japanese || !english) throw new Error("Japanese dialogue and English meaning are required.");
        const trimmed = ConvoLabAudio.trimAndFade(
          samples,
          audioBuffer.sampleRate,
          { start: trimStart, end: trimEnd },
          {
            fadeIn: backdrop.querySelector("[name='fadeIn']").checked,
            fadeOut: backdrop.querySelector("[name='fadeOut']").checked,
          },
        );
        const audioBase64 = ConvoLabAudio.arrayBufferToBase64(
          ConvoLabAudio.encodeMonoWav(trimmed, audioBuffer.sampleRate),
        );
        const result = await send({
          type: "CREATE_MEDIA_CARD",
          cardId,
          imageBase64: picker.imageBase64(),
          japanese,
          english,
          audioBase64,
          sourceUrl: snapshot.sourceUrl,
          sourceTitle: snapshot.title,
        });
        close();
        showToast(
          result.promoted
            ? "Audio recognition card created at the front of your queue."
            : "Card created, but ConvoLab could not move it to the front of the queue.",
          6000,
        );
      } catch (error) {
        errorElement.textContent = error.message;
        errorElement.hidden = false;
        buttons.forEach((button) => { button.disabled = false; });
      }
    });
  }

  function captureId() {
    const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
    let value = BigInt(Date.now());
    for (const byte of crypto.getRandomValues(new Uint8Array(10))) value = (value << 8n) | BigInt(byte);
    let id = "";
    for (let i = 0; i < 26; i += 1) { id = alphabet[Number(value & 31n)] + id; value >>= 5n; }
    return id;
  }

  setInterval(() => { if (enabled) screenshots.sample(videoElement()); }, 1200);

  window.addEventListener(UPDATE_EVENT, (event) => {
    if (!enabled || !event.detail) return;
    if (event.detail.kind === "cue") renderCue(event.detail);
    else if (event.detail.kind === "availability") showToast(event.detail.message, 5000);
  });
  document.addEventListener("fullscreenchange", ensureHost);
  setInterval(() => {
    if (enabled) {
      ensureHost();
      document.body?.classList.add("convolab-media-enabled");
    }
  }, 1000);

  send({ type: "GET_MEDIA_MODE_STATE" })
    .then((status) => setEnabled(status.enabled))
    .catch(() => {});
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "SET_MEDIA_MODE") setEnabled(message.enabled === true);
  });
})();
