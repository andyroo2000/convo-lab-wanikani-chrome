const loading = document.querySelector("#loading");
const signInForm = document.querySelector("#sign-in-form");
const signedIn = document.querySelector("#signed-in");
const errorElement = document.querySelector("#error");
const trackingDot = document.querySelector("#tracking-dot");
const trackingLabel = document.querySelector("#tracking-label");
const accountLabel = document.querySelector("#account-label");
const pendingLabel = document.querySelector("#pending-label");
const syncButton = document.querySelector("#sync");
const signOutButton = document.querySelector("#sign-out");
const mediaTools = document.querySelector("#media-tools");
const mediaHelp = document.querySelector("#media-help");
const toggleMediaButton = document.querySelector("#toggle-media");
let mediaCaptureActive = false;

async function send(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) {
    throw new Error(response?.error || "The extension did not respond.");
  }
  return response.result;
}

function setBusy(busy) {
  for (const button of document.querySelectorAll("button")) {
    button.disabled = busy;
  }
}

function showError(message) {
  errorElement.textContent = message || "";
  errorElement.hidden = !message;
}

function render(status) {
  loading.hidden = true;
  signInForm.hidden = status.signedIn;
  signedIn.hidden = !status.signedIn;
  showError(status.error);

  if (!status.signedIn) {
    requestAnimationFrame(() => document.querySelector("#email").focus());
    return;
  }
  trackingDot.classList.toggle("tracking", status.tracking);
  trackingLabel.textContent = status.tracking
    ? `Recording ${status.trackingLabel || "study time"}`
    : "Ready to track study time";
  accountLabel.textContent = status.user?.email || "Signed in to ConvoLab";
  pendingLabel.textContent = status.pendingCount
    ? `${status.pendingCount} completed session${status.pendingCount === 1 ? "" : "s"} waiting to sync.`
    : "All completed sessions are synced.";
  if (status.failedCount) {
    pendingLabel.textContent += ` ${status.failedCount} session${status.failedCount === 1 ? "" : "s"} could not be synced.`;
  }
  renderMediaTools(status);
}

function renderMediaTools(status) {
  mediaCaptureActive = status.mediaCaptureActive;
  mediaTools.hidden = !status.mediaSupported;
  toggleMediaButton.textContent = mediaCaptureActive
    ? "Stop dialogue capture"
    : "Enable on this tab";
  toggleMediaButton.classList.toggle("secondary", mediaCaptureActive);
  mediaHelp.textContent = mediaCaptureActive
    ? "Dual subtitles are on. Use + Card beside a Japanese subtitle to trim and save its audio."
    : "Show dual subtitles and temporarily keep audio and video stills for cards. Only your selected clip and optional image are uploaded.";
}

signInForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setBusy(true);
  showError("");
  const passwordInput = document.querySelector("#password");
  try {
    const email = document.querySelector("#email").value;
    const password = passwordInput.value;
    render(await send({ type: "SIGN_IN", email, password }));
  } catch (error) {
    showError(error.message);
  } finally {
    passwordInput.value = "";
    setBusy(false);
  }
});

async function runCommand(type) {
  setBusy(true);
  try {
    render(await send({ type }));
  } catch (error) {
    showError(error.message);
  } finally {
    setBusy(false);
  }
}

syncButton.addEventListener("click", () => runCommand("SYNC_NOW"));
signOutButton.addEventListener("click", () => runCommand("SIGN_OUT"));

toggleMediaButton.addEventListener("click", async () => {
  setBusy(true);
  showError("");
  try {
    render(await send({ type: mediaCaptureActive ? "STOP_MEDIA_MODE" : "START_MEDIA_MODE" }));
  } catch (error) {
    showError(error.message);
  } finally {
    setBusy(false);
  }
});

send({ type: "GET_STATUS" }).then(render).catch((error) => {
  loading.hidden = true;
  signInForm.hidden = false;
  showError(error.message);
});
