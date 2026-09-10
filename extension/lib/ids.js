(() => {
  const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

  function createULID(now = Date.now(), randomValues = null) {
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

  globalThis.ConvoLabIds = Object.freeze({createULID});
})();
