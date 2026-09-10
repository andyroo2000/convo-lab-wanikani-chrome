import { base64ToBlob, buildAudioRecognitionCardPayload, isSupportedMediaURL } from "./card.js";

function boundedBase64(value, limit, label) {
  if (typeof value !== "string") throw new Error(`${label} is missing.`);
  if (value.length < 60) throw new Error(`${label} is empty.`);
  if (value.length > limit) throw new Error(`${label} is too large.`);
  return value;
}

export function captureForm(message) {
  if (!/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/i.test(message.cardId)) throw new Error("Invalid capture ID.");
  if (!isSupportedMediaURL(message.sourceUrl)) throw new Error("Unsupported card source.");
  const payload = buildAudioRecognitionCardPayload({ ...message, id: message.cardId });
  const form = new FormData();
  form.set("id", message.cardId);
  form.set("japanese", payload.answer.expression);
  form.set("english", payload.answer.meaning);
  form.set("notes", payload.answer.notes || "");
  form.set("audio", base64ToBlob(boundedBase64(message.audioBase64, 14 * 1024 * 1024, "Audio")), "dialogue.wav");
  if (message.imageBase64) {
    form.set("image", base64ToBlob(boundedBase64(message.imageBase64, 2 * 1024 * 1024, "Screenshot"), "image/jpeg"), "scene.jpg");
  }
  return form;
}

function errorMessage(payload, status) {
  const errors = Object.values(payload?.errors || {}).flat();
  return errors.find((value) => typeof value === "string")
    || payload?.message || `Card creation failed (${status}).`;
}

async function captureToken(expectedAccountId) {
  const values = await chrome.storage.local.get(["convoLabAccessToken", "convoLabUser"]);
  const token = values.convoLabAccessToken;
  if (!token) throw new Error("Sign in to ConvoLab before creating a card.");
  if (!expectedAccountId || String(values.convoLabUser?.id) !== String(expectedAccountId)) {
    throw new Error("This draft belongs to a different ConvoLab account. Capture the dialogue again.");
  }
  return token;
}

export async function createCapturedAudioCard(message, expectedAccountId) {
  const token = await captureToken(expectedAccountId);
  const response = await fetch("https://convo-lab.com/api/study/cards/capture", {
    method: "POST",
    headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
    body: captureForm(message),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(errorMessage(payload, response.status));
  return { card: payload };
}
