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

  function cueList(start, end, text) {
    if (start === null || end === null) return [];
    if (!Number.isFinite(start) || !Number.isFinite(end)) return [];
    if (end <= start || !text) return [];
    return [{start, end, text}];
  }

  function vttBlock(block) {
    const lines = block.split("\n").filter(Boolean);
    const timingIndex = lines.findIndex(line => line.includes("-->"));
    if (timingIndex < 0) return [];
    const [rawStart, rawEnd] = lines[timingIndex].split("-->");
    const start = parseClock(rawStart);
    const end = parseClock(rawEnd.trim().split(/\s+/)[0]);
    return cueList(start, end, normalizeText(lines.slice(timingIndex + 1).join("\n")));
  }

  function parseWebVtt(value) {
    return String(value || "").replaceAll("\r\n", "\n").split(/\n{2,}/).flatMap(vttBlock);
  }

  function parseTtmlTime(value, tickRate = 10_000_000, frameRate = 30) {
    const raw = String(value || "").trim();
    if (!raw) return null;
    const offset = raw.match(/^(\d+(?:\.\d+)?)(t|ms|s|m|h)$/i);
    if (offset) {
      const scales = {t: 1 / tickRate, ms: 0.001, s: 1, m: 60, h: 3600};
      return Number(offset[1]) * scales[offset[2].toLowerCase()];
    }
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
    return [...documentNode.querySelectorAll("p")].flatMap(node => ttmlCue(node, tickRate, frameRate));
  }

  function ttmlCue(node, tickRate, frameRate) {
    const start = parseTtmlTime(node.getAttribute("begin"), tickRate, frameRate);
    const end = ttmlEnd(node, {start, tickRate, frameRate});
    return cueList(start, end, normalizeText(node.innerHTML || node.textContent));
  }

  function ttmlEnd(node, timing) {
    const end = parseTtmlTime(node.getAttribute("end"), timing.tickRate, timing.frameRate);
    if (end !== null) return end;
    const duration = parseTtmlTime(node.getAttribute("dur"), timing.tickRate, timing.frameRate);
    if (timing.start === null || duration === null) return null;
    return timing.start + duration;
  }

  function jsonPayload(value) {
    if (typeof value !== "string") return value;
    try { return JSON.parse(value); } catch { return null; }
  }

  function jsonCue(event) {
    const segments = Array.isArray(event.segs) ? event.segs : [];
    const text = normalizeText(segments.map(segment => segment.utf8 || "").join(""));
    const start = Number(event.tStartMs) / 1000;
    const end = start + Number(event.dDurationMs) / 1000;
    return cueList(start, end, text);
  }

  function parseYouTubeJson3(value) {
    const payload = jsonPayload(value);
    if (!Array.isArray(payload?.events)) return [];
    return payload.events.flatMap(jsonCue);
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
    if (!track) return "";
    const value = ["languageCode", "bcp47", "language", "lang"].map(key => track[key]).find(Boolean);
    return String(value || "").toLowerCase();
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
