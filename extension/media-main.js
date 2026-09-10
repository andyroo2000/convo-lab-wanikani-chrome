(() => {
  const helpers = globalThis.ConvoLabSubtitles;
  const UPDATE_EVENT = "convolab-subtitle-update";
  const COMMAND_EVENT = "convolab-media-command";
  const MANIFEST_URL_PATTERN = /manifest|timedtext|subtitle/i;
  const state = {
    enabled: false,
    sourceKey: null,
    japanese: [],
    english: [],
    loading: false,
    lastPublishedKey: null,
    netflixTracks: [],
  };

  function dispatch(detail) {
    window.dispatchEvent(new CustomEvent(UPDATE_EVENT, { detail }));
  }

  function title() {
    if (location.hostname.endsWith("youtube.com")) {
      return document.querySelector("h1.ytd-watch-metadata yt-formatted-string")?.textContent?.trim()
        || document.title.replace(/\s+- YouTube$/, "");
    }
    return document.querySelector("[data-uia='video-title']")?.textContent?.trim()
      || document.title.replace(/\s+- Netflix$/, "");
  }

  function videoElement() {
    return [...document.querySelectorAll("video")].find((video) => video.duration > 0)
      || document.querySelector("video");
  }

  function playerResponse() {
    const player = document.querySelector("#movie_player");
    try {
      return player?.getPlayerResponse?.() || globalThis.ytInitialPlayerResponse || null;
    } catch {
      return globalThis.ytInitialPlayerResponse || null;
    }
  }

  function trackName(track) {
    return track?.name?.simpleText
      || track?.name?.runs?.map((run) => run.text).join("")
      || track?.languageDescription
      || track?.language
      || track?.bcp47
      || "Subtitle";
  }

  async function fetchYouTubeTrack(track, translatedLanguage = null) {
    const url = new URL(track.baseUrl);
    url.searchParams.set("fmt", "json3");
    if (translatedLanguage) url.searchParams.set("tlang", translatedLanguage);
    const response = await fetch(url.toString(), { credentials: "include" });
    if (!response.ok) throw new Error(`Subtitle request failed (${response.status})`);
    return helpers.parseYouTubeJson3(await response.text());
  }

  async function loadYouTube() {
    if (state.loading) return;
    const response = playerResponse();
    const details = response?.videoDetails;
    const tracks = response?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    const sourceKey = details?.videoId || new URL(location.href).searchParams.get("v");
    if (!sourceKey || !Array.isArray(tracks) || tracks.length === 0) return;
    if (state.sourceKey === sourceKey && state.japanese.length) return;

    state.loading = true;
    try {
      const japaneseTrack = helpers.selectLanguageTrack(tracks, "ja")
        || tracks.find((track) => String(track.vssId || "").includes(".ja"));
      if (!japaneseTrack) {
        dispatch({ kind: "availability", available: false, message: "This video has no Japanese subtitle track." });
        return;
      }
      const englishTrack = helpers.selectLanguageTrack(tracks, "en");
      const [japanese, english] = await Promise.all([
        fetchYouTubeTrack(japaneseTrack),
        englishTrack
          ? fetchYouTubeTrack(englishTrack)
          : japaneseTrack.isTranslatable !== false
            ? fetchYouTubeTrack(japaneseTrack, "en")
            : Promise.resolve([]),
      ]);
      state.sourceKey = sourceKey;
      state.japanese = japanese;
      state.english = english;
      state.lastPublishedKey = null;
      dispatch({
        kind: "availability",
        available: japanese.length > 0,
        message: english.length
          ? `${trackName(japaneseTrack)} + ${englishTrack ? trackName(englishTrack) : "English translation"}`
          : "Japanese subtitles found; English subtitles are unavailable.",
      });
    } catch (error) {
      dispatch({ kind: "availability", available: false, message: error.message });
    } finally {
      state.loading = false;
    }
  }

  function walkForNetflixTracks(value, found = []) {
    if (!value || typeof value !== "object") return found;
    if (Array.isArray(value)) {
      for (const item of value) walkForNetflixTracks(item, found);
      return found;
    }
    for (const [key, child] of Object.entries(value)) {
      if (key.toLowerCase() === "timedtexttracks" && Array.isArray(child)) {
        found.push(...child);
      } else if (child && typeof child === "object") {
        walkForNetflixTracks(child, found);
      }
    }
    return found;
  }

  function downloadUrls(value, output = []) {
    if (typeof value === "string" && /^https?:/i.test(value)) output.push(value);
    else if (Array.isArray(value)) value.forEach((item) => downloadUrls(item, output));
    else if (value && typeof value === "object") Object.values(value).forEach((item) => downloadUrls(item, output));
    return output;
  }

  function normalizeNetflixTracks(payload) {
    return walkForNetflixTracks(payload).flatMap((track) => {
      if (track?.isNoneTrack) return [];
      const urls = [...new Set(downloadUrls(track?.ttDownloadables || track?.downloadUrls || track?.urls))];
      if (!urls.length) return [];
      return [{
        ...track,
        languageCode: track.bcp47 || track.language || track.lang,
        subtitleUrl: urls.find((url) => /webvtt|\.vtt(?:\?|$)/i.test(url)) || urls[0],
      }];
    });
  }

  async function inspectNetflixPayload(payload) {
    const tracks = normalizeNetflixTracks(payload);
    if (!tracks.length) return;
    state.netflixTracks = tracks;
    if (state.enabled) await loadNetflix();
  }

  function parseSubtitleDocument(text) {
    const trimmed = text.trimStart();
    if (trimmed.startsWith("WEBVTT") || trimmed.includes(" --> ")) {
      return helpers.parseWebVtt(text);
    }
    return helpers.parseTtml(text);
  }

  async function fetchNetflixTrack(track) {
    const response = await fetch(track.subtitleUrl, { credentials: "include" });
    if (!response.ok) throw new Error(`Subtitle request failed (${response.status})`);
    return parseSubtitleDocument(await response.text());
  }

  async function loadNetflix() {
    if (state.loading || !state.netflixTracks.length) return;
    const japaneseTrack = helpers.selectLanguageTrack(state.netflixTracks, "ja");
    const englishTrack = helpers.selectLanguageTrack(state.netflixTracks, "en");
    if (!japaneseTrack) {
      dispatch({ kind: "availability", available: false, message: "This title has no Japanese subtitle track." });
      return;
    }
    const sourceKey = `${japaneseTrack.subtitleUrl}|${englishTrack?.subtitleUrl || ""}`;
    if (state.sourceKey === sourceKey && state.japanese.length) return;
    state.loading = true;
    try {
      const [japanese, english] = await Promise.all([
        fetchNetflixTrack(japaneseTrack),
        englishTrack ? fetchNetflixTrack(englishTrack) : Promise.resolve([]),
      ]);
      state.sourceKey = sourceKey;
      state.japanese = japanese;
      state.english = english;
      state.lastPublishedKey = null;
      dispatch({
        kind: "availability",
        available: japanese.length > 0,
        message: english.length
          ? `${trackName(japaneseTrack)} + ${trackName(englishTrack)}`
          : "Japanese subtitles found; English subtitles are unavailable.",
      });
    } catch (error) {
      dispatch({ kind: "availability", available: false, message: error.message });
    } finally {
      state.loading = false;
    }
  }

  function inspectResponse(url, response) {
    if (!location.hostname.endsWith("netflix.com") || !MANIFEST_URL_PATTERN.test(String(url))) return;
    response.clone().json().then(inspectNetflixPayload).catch(() => {});
  }

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async function convoLabFetch(...args) {
    const response = await originalFetch.apply(this, args);
    inspectResponse(typeof args[0] === "string" ? args[0] : args[0]?.url, response);
    return response;
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function convoLabOpen(method, url, ...rest) {
    this.addEventListener("load", () => {
      if (!MANIFEST_URL_PATTERN.test(String(url))) return;
      try {
        if (typeof this.responseText === "string") inspectNetflixPayload(JSON.parse(this.responseText));
      } catch {
        // Netflix may deliver a binary or non-JSON response on similarly named URLs.
      }
    }, { once: true });
    return originalOpen.call(this, method, url, ...rest);
  };

  function publishCurrentCue() {
    if (!state.enabled) return;
    const video = videoElement();
    if (!video) return;
    const japanese = helpers.activeCue(state.japanese, video.currentTime);
    const english = helpers.activeCue(state.english, video.currentTime);
    const key = `${state.sourceKey}|${japanese?.start ?? ""}|${english?.start ?? ""}`;
    if (key === state.lastPublishedKey) return;
    state.lastPublishedKey = key;
    dispatch({
      kind: "cue",
      japanese,
      english,
      currentTime: video.currentTime,
      playbackRate: video.playbackRate,
      paused: video.paused,
      title: title(),
      sourceUrl: location.href,
    });
  }

  window.addEventListener(COMMAND_EVENT, (event) => {
    state.enabled = event.detail?.enabled === true;
    if (!state.enabled) {
      state.lastPublishedKey = null;
      return;
    }
    if (location.hostname.endsWith("youtube.com")) loadYouTube();
    else loadNetflix();
  });

  document.addEventListener("yt-navigate-finish", () => {
    state.sourceKey = null;
    state.japanese = [];
    state.english = [];
    if (state.enabled) loadYouTube();
  });

  setInterval(() => {
    if (!state.enabled) return;
    if (location.hostname.endsWith("youtube.com")) loadYouTube();
    else if (!state.japanese.length) loadNetflix();
    publishCurrentCue();
  }, 250);
})();
