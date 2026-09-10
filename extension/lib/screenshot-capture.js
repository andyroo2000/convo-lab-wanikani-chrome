let lastCaptureAt = 0;

function validViewport(viewport) {
  if (!viewport) return false;
  return [viewport.width, viewport.height].every(value => Number.isFinite(value) && value > 0);
}

function cropBounds(rect, viewport, bitmap) {
  validateBounds(rect, viewport);
  return scaledBounds(rect, viewport, bitmap);
}

function validateBounds(rect, viewport) {
  if (!validViewport(viewport)) throw new Error("Video viewport is unavailable.");
  if (!rect) throw new Error("Video bounds are unavailable.");
  if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)) throw new Error("Invalid video bounds.");
}

function scaledBounds(rect, viewport, bitmap) {
  const x = Math.max(0, rect.x);
  const y = Math.max(0, rect.y);
  const right = Math.min(viewport.width, rect.x + rect.width);
  const bottom = Math.min(viewport.height, rect.y + rect.height);
  if (right <= x || bottom <= y) throw new Error("The video is outside the visible tab.");
  const sx = bitmap.width / viewport.width;
  const sy = bitmap.height / viewport.height;
  return { x: x * sx, y: y * sy, width: (right - x) * sx, height: (bottom - y) * sy };
}

export async function captureScreenshot(tab, message) {
  await assertVisibleTab(tab);
  if (Date.now() - lastCaptureAt < 1000) throw new Error("Screenshot capture is busy.");
  lastCaptureAt = Date.now();
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 75 });
  const timeMs = (lastCaptureAt + Date.now()) / 2;
  await assertVisibleTab(tab);
  const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
  try {
    return { ...await cropScreenshot(bitmap, message), timeMs };
  } finally {
    bitmap.close();
  }
}

async function assertVisibleTab(tab) {
  const current = await chrome.tabs.get(tab.id);
  if (!current.active || current.url !== tab.url) throw new Error("Keep the video tab visible for screenshots.");
}

async function cropScreenshot(bitmap, message) {
  const rect = cropBounds(message.rect, message.viewport, bitmap);
  const width = Math.max(1, Math.min(960, Math.round(rect.width)));
  const height = Math.max(1, Math.round(rect.height * width / rect.width));
  const canvas = new OffscreenCanvas(width, height);
  canvas.getContext("2d").drawImage(bitmap, rect.x, rect.y, rect.width, rect.height, 0, 0, width, height);
  const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: "image/jpeg", quality: 0.75 })).arrayBuffer());
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return { dataUrl: `data:image/jpeg;base64,${btoa(binary)}` };
}
