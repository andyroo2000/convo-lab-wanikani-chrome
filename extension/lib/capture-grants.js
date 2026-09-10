const GRANT_PREFIX = "convoLabCaptureGrant:";

export async function captureAccount() {
  const values = await chrome.storage.local.get(["convoLabAccessToken", "convoLabUser"]);
  if (!values.convoLabAccessToken || !values.convoLabUser?.id) {
    throw new Error("Sign in to ConvoLab before enabling dialogue capture.");
  }
  return String(values.convoLabUser.id);
}

export async function grantCapturedTab(tabId, accountId) {
  await chrome.storage.session.set({[GRANT_PREFIX + tabId]: {accountId}});
}

export async function forgetCapturedTab(tabId) {
  await chrome.storage.session.remove(GRANT_PREFIX + tabId);
}

export async function capturedTabAccount(tabId) {
  const key = GRANT_PREFIX + tabId;
  const values = await chrome.storage.session.get(key);
  const grant = values[key];
  if (!grant) throw new Error("Enable dialogue capture for this tab before creating a card.");
  return grant.accountId;
}

export function accountChanged(changes) {
  const user = changes.convoLabUser;
  return Boolean(user) && String(user.oldValue?.id) !== String(user.newValue?.id);
}
