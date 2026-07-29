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
    return;
  }
  trackingDot.classList.toggle("tracking", status.tracking);
  trackingLabel.textContent = status.tracking
    ? "Recording review time"
    : "Ready for reviews";
  accountLabel.textContent = status.user?.email || "Signed in to ConvoLab";
  pendingLabel.textContent = status.pendingCount
    ? `${status.pendingCount} completed session${status.pendingCount === 1 ? "" : "s"} waiting to sync.`
    : "All completed sessions are synced.";
}

signInForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setBusy(true);
  showError("");
  try {
    const email = document.querySelector("#email").value;
    const password = document.querySelector("#password").value;
    render(await send({ type: "SIGN_IN", email, password }));
    document.querySelector("#password").value = "";
  } catch (error) {
    showError(error.message);
  } finally {
    setBusy(false);
  }
});

syncButton.addEventListener("click", async () => {
  setBusy(true);
  try {
    render(await send({ type: "SYNC_NOW" }));
  } catch (error) {
    showError(error.message);
  } finally {
    setBusy(false);
  }
});

signOutButton.addEventListener("click", async () => {
  setBusy(true);
  try {
    render(await send({ type: "SIGN_OUT" }));
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
