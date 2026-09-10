(function installSubtitleHelpers(root) {
  function decodeEntities(value) {
    if (typeof document === "undefined") {
      return value
        .replaceAll("&amp;", "&")
        .replaceAll("&lt;", "<")
        .replaceAll("&gt;", ">")
        .replaceAll("&quot;", '"')
        .replaceAll("&#39;", "'");
    }
    const textarea = document.createElement("textarea");
    textarea.innerHTML = value;
    return textarea.value;
  }

  function normalizeText(value) {
    return decodeEntities(String(value || ""))
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/[ \t]+/g, " ")
      .replace(/ *\n */g, "\n")
      .trim();
  }

  function parseClock(value) {
    const parts = String(value || "").trim().replace(",", ".").split(":");
    if (parts.length < 2 || parts.length > 3) return null;
    const seconds = Number(parts.pop());
    const minutes = Number(parts.pop());
    const hours = parts.length ? Number(parts.pop()) : 0;
    if (![hours, minutes, seconds].every(Number.isFinite)) return null;
    return hours * 3600 + minutes * 60 + seconds;
  }

  function parseWebVtt(value) {
    const blocks = String(value || "").replaceAll("\r\n", "\n").split(/\n{2,}/);
    const cues = [];
    for (const block of blocks) {
      const lines = block.split("\n").filter(Boolean);
      const timingIndex = lines.findIndex((line) => line.includes("-->"));
      if (timingIndex < 0) continue;
      const [rawStart, rawEndWithSettings] = lines[timingIndex].split("-->");
      const start = parseClock(rawStart);
      const end = parseClock(rawEndWithSettings?.trim().split(/\s+/)[0]);
      const text = normalizeText(lines.slice(timingIndex + 1).join("\n"));
      if (start !== null && end !== null && end > start && text) {
        cues.push({ start, end, text });
      }
    }
    return cues;
  }

  function parseTtmlTime(value, tickRate = 10_000_000, frameRate = 30) {
    const raw = String(value || "").trim();
    if (!raw) return null;
    if (/^\d+(?:\.\d+)?t$/i.test(raw)) return Number(raw.slice(0, -1)) / tickRate;
    if (/^\d+(?:\.\d+)?ms$/i.test(raw)) return Number(raw.slice(0, -2)) / 1000;
    if (/^\d+(?:\.\d+)?s$/i.test(raw)) return Number(raw.slice(0, -1));
    if (/^\d+(?:\.\d+)?m$/i.test(raw)) return Number(raw.slice(0, -1)) * 60;
    if (/^\d+(?:\.\d+)?h$/i.test(raw)) return Number(raw.slice(0, -1)) * 3600;
    const frameMatch = raw.match(/^(\d+):(\d+):(\d+):(\d+)$/);
    if (frameMatch) {
      return Number(frameMatch[1]) * 3600
        + Number(frameMatch[2]) * 60
        + Number(frameMatch[3])
        + Number(frameMatch[4]) / frameRate;
    }
    return parseClock(raw);
  }

  function parseTtml(value) {
    if (typeof DOMParser === "undefined") return [];
    const documentNode = new DOMParser().parseFromString(String(value || ""), "text/xml");
    if (documentNode.querySelector("parsererror")) return [];
    const rootNode = documentNode.documentElement;
    const tickRate = Number(rootNode.getAttribute("ttp:tickRate") || rootNode.getAttribute("tickRate")) || 10_000_000;
    const frameRate = Number(rootNode.getAttribute("ttp:frameRate") || rootNode.getAttribute("frameRate")) || 30;
    return [...documentNode.querySelectorAll("p")].flatMap((node) => {
      const start = parseTtmlTime(node.getAttribute("begin"), tickRate, frameRate);
      let end = parseTtmlTime(node.getAttribute("end"), tickRate, frameRate);
      if (end === null) {
        const duration = parseTtmlTime(node.getAttribute("dur"), tickRate, frameRate);
        if (start !== null && duration !== null) end = start + duration;
      }
      const text = normalizeText(node.innerHTML || node.textContent);
      return start !== null && end !== null && end > start && text
        ? [{ start, end, text }]
        : [];
    });
  }

  function parseYouTubeJson3(value) {
    let payload = value;
    if (typeof value === "string") {
      try {
        payload = JSON.parse(value);
      } catch {
        return [];
      }
    }
    if (!payload || !Array.isArray(payload.events)) return [];
    return payload.events.flatMap((event) => {
      const start = Number(event.tStartMs) / 1000;
      const duration = Number(event.dDurationMs) / 1000;
      const text = normalizeText(
        Array.isArray(event.segs) ? event.segs.map((segment) => segment.utf8 || "").join("") : "",
      );
      return Number.isFinite(start) && Number.isFinite(duration) && duration > 0 && text
        ? [{ start, end: start + duration, text }]
        : [];
    });
  }

  function activeCue(cues, currentTime) {
    if (!Array.isArray(cues) || !Number.isFinite(currentTime)) return null;
    let low = 0;
    let high = cues.length - 1;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const cue = cues[middle];
      if (currentTime < cue.start) high = middle - 1;
      else if (currentTime > cue.end) low = middle + 1;
      else return cue;
    }
    return null;
  }

  function languageCode(track) {
    return String(track?.languageCode || track?.bcp47 || track?.language || track?.lang || "").toLowerCase();
  }

  function selectLanguageTrack(tracks, language) {
    const prefix = String(language || "").toLowerCase();
    if (!Array.isArray(tracks)) return null;
    return tracks.find((track) => languageCode(track) === prefix)
      || tracks.find((track) => languageCode(track).startsWith(`${prefix}-`))
      || null;
  }

  root.ConvoLabSubtitles = Object.freeze({
    activeCue,
    languageCode,
    normalizeText,
    parseClock,
    parseTtml,
    parseTtmlTime,
    parseWebVtt,
    parseYouTubeJson3,
    selectLanguageTrack,
  });
})(globalThis);
