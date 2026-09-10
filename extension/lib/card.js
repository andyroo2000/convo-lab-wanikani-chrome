const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

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

export function createULID(now = Date.now(), randomValues = null) {
  const bytes = randomValues || crypto.getRandomValues(new Uint8Array(10));
  if (!(bytes instanceof Uint8Array) || bytes.length !== 10) {
    throw new Error("ULID randomness must contain 10 bytes.");
  }
  let timestamp = BigInt(Math.max(0, Math.floor(now)));
  let timePart = "";
  for (let index = 0; index < 10; index += 1) {
    timePart = CROCKFORD[Number(timestamp % 32n)] + timePart;
    timestamp /= 32n;
  }
  let random = 0n;
  for (const byte of bytes) random = (random << 8n) | BigInt(byte);
  let randomPart = "";
  for (let index = 0; index < 16; index += 1) {
    randomPart = CROCKFORD[Number(random % 32n)] + randomPart;
    random /= 32n;
  }
  return timePart + randomPart;
}

export function buildAudioRecognitionCardPayload({ id, japanese, english, sourceUrl, sourceTitle }) {
  const expression = String(japanese || "").trim();
  const meaning = String(english || "").trim();
  if (!expression || !meaning) throw new Error("Japanese dialogue and English meaning are required.");
  const source = [String(sourceTitle || "").trim().slice(0, 500), String(sourceUrl || "").trim().slice(0, 2048)]
    .filter(Boolean)
    .join(" — ");
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

export function base64ToBlob(value, type = "audio/wav") {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type });
}
