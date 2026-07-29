(() => {
  const HEARTBEAT_MS = 15_000;
  const ACTIVITY_THROTTLE_MS = 1_000;
  let lastInteractionAt = null;
  let lastActivityMessageAt = 0;
  let lastURL = window.location.href;
  let lifecyclePort;

  function pageState(kind) {
    return {
      kind,
      url: window.location.href,
      visible: kind !== "pagehide" && document.visibilityState === "visible",
      lastInteractionAt,
    };
  }

  function sendState(kind) {
    chrome.runtime.sendMessage({
      type: "WANIKANI_PAGE_STATE",
      ...pageState(kind),
    }).catch(() => {
      // The service worker may be restarting. The next heartbeat retries.
    });
  }

  function connectLifecyclePort() {
    lifecyclePort = chrome.runtime.connect({ name: "wanikani-page-lifecycle" });
    lifecyclePort.onDisconnect.addListener(() => {
      lifecyclePort = null;
    });
  }

  function noteActivity(event) {
    if (!event.isTrusted) {
      return;
    }
    const now = Date.now();
    lastInteractionAt = now;
    if (now - lastActivityMessageAt < ACTIVITY_THROTTLE_MS) {
      return;
    }
    lastActivityMessageAt = now;
    sendState("activity");
  }

  document.addEventListener("pointerdown", noteActivity, {
    capture: true,
    passive: true,
  });
  document.addEventListener("keydown", noteActivity, { capture: true });
  document.addEventListener("visibilitychange", () => sendState("visibility"));
  window.addEventListener("pageshow", () => sendState("pageshow"));
  window.addEventListener("pagehide", () => sendState("pagehide"));
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "REQUEST_WANIKANI_STATE") {
      return false;
    }
    sendResponse(pageState("requested"));
    return false;
  });

  connectLifecyclePort();
  sendState("initial");
  setInterval(() => {
    if (!lifecyclePort) {
      connectLifecyclePort();
    }
    sendState("heartbeat");
  }, HEARTBEAT_MS);
  setInterval(() => {
    if (window.location.href !== lastURL) {
      lastURL = window.location.href;
      sendState("location");
    }
  }, 1_000);
})();
