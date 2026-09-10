(function installScreenshotPicker(root) {
  function createPicker(container, frames, originMs) {
    const heading = document.createElement("h3");
    heading.textContent = "Screenshot on the front (optional)";
    const help = document.createElement("p");
    help.className = "convolab-screenshot-help";
    const choices = document.createElement("div");
    choices.className = "convolab-screenshot-choices";
    choices.setAttribute("role", "group");
    choices.setAttribute("aria-label", "Screenshot selection");
    container.append(heading, help, choices);
    let selected = null;
    let currentKey = "";

    function option(frame) {
      const label = document.createElement("label");
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = "convolab-screenshot";
      radio.checked = selected === frame;
      radio.addEventListener("change", () => { selected = frame; });
      label.append(radio);
      if (frame) {
        const image = document.createElement("img");
        image.src = frame.dataUrl;
        image.alt = `Video at ${((frame.timeMs - originMs) / 1000).toFixed(1)} seconds into the clip`;
        label.append(image);
      } else {
        label.append(document.createTextNode("No image"));
      }
      return label;
    }

    function update(start, end) {
      const candidates = ConvoLabScreenshots.selectCandidates(frames, originMs + start * 1000, originMs + end * 1000);
      const key = candidates.map(frame => frame.timeMs).join(",");
      if (currentKey === key && choices.childElementCount) return;
      currentKey = key;
      if (!candidates.includes(selected)) selected = null;
      choices.replaceChildren(option(null), ...candidates.map(option));
      help.textContent = candidates.length
        ? "Choose a frame from the selected audio. Only your chosen image will be uploaded."
        : "No screenshots are available for this selection. The player may block capture, or the clip is too short. You can still save the audio card.";
    }

    return { update, imageBase64: () => selected ? selected.dataUrl.split(",")[1] : null };
  }
  root.ConvoLabScreenshotPicker = { createPicker };
})(globalThis);
