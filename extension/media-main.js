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
    generation: 0,
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
    const name = track?.name || {};
    const runs = Array.isArray(name.runs) ? name.runs.map(run => run.text).join("") : "";
    return [name.simpleText, runs, ...["languageDescription", "language", "bcp47"].map(key => track?.[key])]
      .find(Boolean) || "Subtitle";
  }

  async function fetchYouTubeTrack(track, translatedLanguage = null) {
    const url = new URL(track.baseUrl);
    url.searchParams.set("fmt", "json3");
    if (translatedLanguage) url.searchParams.set("tlang", translatedLanguage);
    const response = await fetch(url.toString(), { credentials: "include" });
    if (!response.ok) throw new Error(`Subtitle request failed (${response.status})`);
    return helpers.parseYouTubeJson3(await response.text());
  }

  function youtubeSource() {
    const response = playerResponse();
    const sourceKey = response?.videoDetails?.videoId || new URL(location.href).searchParams.get("v");
    const tracks = youtubeCaptionTracks(response);
    if (!sourceKey || !Array.isArray(tracks)) return null;
    if (!tracks.length) return null;
    return {sourceKey, tracks};
  }

  function youtubeCaptionTracks(response) {
    return response?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  }

  function japaneseYoutubeTrack(tracks) {
    return helpers.selectLanguageTrack(tracks, "ja")
      || tracks.find(track => String(track.vssId || "").includes(".ja"));
  }

  function englishYoutubeTrack(englishTrack, japaneseTrack) {
    if (englishTrack) return fetchYouTubeTrack(englishTrack);
    if (japaneseTrack.isTranslatable === false) return Promise.resolve([]);
    return fetchYouTubeTrack(japaneseTrack, "en");
  }

  function publishLoadedTracks(sourceKey, japanese, english, label) {
    state.sourceKey = sourceKey;
    state.japanese = japanese;
    state.english = english;
    state.lastPublishedKey = null;
    dispatch({
      kind: "availability",
      available: japanese.length > 0,
      message: english.length ? label : "Japanese subtitles found; English subtitles are unavailable.",
    });
  }

  async function loadYouTubePair(source) {
    const generation = state.generation;
    const japaneseTrack = japaneseYoutubeTrack(source.tracks);
    if (!japaneseTrack) throw new Error("This video has no Japanese subtitle track.");
    const englishTrack = helpers.selectLanguageTrack(source.tracks, "en");
    const [japanese, english] = await Promise.all([
      fetchYouTubeTrack(japaneseTrack),
      englishYoutubeTrack(englishTrack, japaneseTrack).catch(() => []),
    ]);
    if (youtubeSource()?.sourceKey !== source.sourceKey) return;
    if (!captureIsCurrent(generation)) return;
    const englishName = englishTrack ? trackName(englishTrack) : "English translation";
    publishLoadedTracks(source.sourceKey, japanese, english, `${trackName(japaneseTrack)} + ${englishName}`);
  }

  function alreadyLoaded(key) {
    return state.sourceKey === key && state.japanese.length > 0;
  }

  function captureIsCurrent(generation) {
    return state.enabled && generation === state.generation;
  }

  async function loadYouTube() {
    if (state.loading) return;
    const source = youtubeSource();
    if (!source || alreadyLoaded(source.sourceKey)) return;
    state.loading = true;
    try {
      await loadYouTubePair(source);
    } catch (error) {
      dispatch({kind: "availability", available: false, message: error.message});
    } finally {
      state.loading = false;
    }
  }

  function walkForNetflixTracks(value) {
    if (!value || typeof value !== "object") return [];
    return Object.entries(value).flatMap(netflixTrackEntry);
  }

  function netflixTrackEntry([key, value]) {
    if (key.toLowerCase() === "timedtexttracks" && Array.isArray(value)) return value;
    return walkForNetflixTracks(value);
  }

  function downloadUrls(value, output = []) {
    if (typeof value === "string" && /^https?:/i.test(value)) output.push(value);
    else if (Array.isArray(value)) value.forEach((item) => downloadUrls(item, output));
    else if (value && typeof value === "object") Object.values(value).forEach((item) => downloadUrls(item, output));
    return output;
  }

  function normalizeNetflixTracks(payload) {
    return walkForNetflixTracks(payload).flatMap(normalizeNetflixTrack);
  }

  function normalizeNetflixTrack(track) {
    if (track?.isNoneTrack) return [];
    const downloadables = ["ttDownloadables", "downloadUrls", "urls"].map(key => track?.[key]).find(Boolean);
    const urls = [...new Set(downloadUrls(downloadables))];
    if (!urls.length) return [];
    return [{
      ...track,
      languageCode: helpers.languageCode(track),
      subtitleUrl: preferredSubtitleUrl(urls),
    }];
  }

  function preferredSubtitleUrl(urls) {
    return urls.find(url => /webvtt|[.]vtt(?:[?]|$)/i.test(url)) || urls[0];
  }

  async function inspectNetflixPayload(payload) {
    if (!state.enabled) return;
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
    const generation = state.generation;
    const japaneseTrack = helpers.selectLanguageTrack(state.netflixTracks, "ja");
    const englishTrack = helpers.selectLanguageTrack(state.netflixTracks, "en");
    if (!japaneseTrack) {
      dispatch({ kind: "availability", available: false, message: "This title has no Japanese subtitle track." });
      return;
    }
    const sourceKey = `${japaneseTrack.subtitleUrl}|${englishTrack?.subtitleUrl || ""}`;
    if (alreadyLoaded(sourceKey)) return;
    state.loading = true;
    try {
      const [japanese, english] = await Promise.all([
        fetchNetflixTrack(japaneseTrack),
        englishTrack ? fetchNetflixTrack(englishTrack) : Promise.resolve([]),
      ]);
      if (!captureIsCurrent(generation)) return;
      publishLoadedTracks(sourceKey, japanese, english, `${trackName(japaneseTrack)} + ${trackName(englishTrack)}`);
    } catch (error) {
      dispatch({ kind: "availability", available: false, message: error.message });
    } finally {
      state.loading = false;
    }
  }

  function shouldInspectNetflix(url) {
    return state.enabled && location.hostname.endsWith("netflix.com") && MANIFEST_URL_PATTERN.test(String(url));
  }

  function inspectResponse(url, response) {
    if (!shouldInspectNetflix(url)) return;
    const generation = state.generation;
    response.clone().json().then(payload => {
      if (captureIsCurrent(generation)) return inspectNetflixPayload(payload);
    }).catch(() => {});
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
      if (!shouldInspectNetflix(url)) return;
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
      state.generation += 1;
      state.sourceKey = null;
      state.japanese = [];
      state.english = [];
      state.netflixTracks = [];
      state.lastPublishedKey = null;
      return;
    }
    if (location.hostname.endsWith("youtube.com")) loadYouTube();
    else {
      dispatch({kind: "availability", available: false, message: "If subtitles do not appear, reopen this Netflix title now that capture is enabled."});
      loadNetflix();
    }
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
    else loadNetflix();
    publishCurrentCue();
  }, 250);
})();
