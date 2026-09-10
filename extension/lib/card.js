import "./ids.js";

export const createULID = globalThis.ConvoLabIds.createULID;

export function isSupportedMediaURL(value) {
  try {
    const url = value instanceof URL ? value : new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:"
      && (host === "youtube.com" || host === "www.youtube.com" || host === "www.netflix.com");
  } catch {
    return false;
  }
}

export function buildAudioRecognitionCardPayload({ id, japanese, english, sourceUrl, sourceTitle }) {
  const expression = String(japanese || "").trim();
  const meaning = String(english || "").trim();
  if (!expression || !meaning) throw new Error("Japanese dialogue and English meaning are required.");
  const source = captureSource(sourceTitle, sourceUrl);
  return {
    id,
    creationKind: "audio-recognition",
    prompt: { cueText: expression },
    answer: {
      expression,
      meaning,
      sentenceJp: expression,
      sentenceEn: meaning,
      ...(source ? { notes: `Captured from ${source}` } : {}),
    },
  };
}

function captureSource(title, url) {
  return [String(title || "").trim().slice(0, 500), String(url || "").trim().slice(0, 2048)]
    .filter(Boolean).join(" — ");
}

export function base64ToBlob(value, type = "audio/wav") {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type });
}
