(() => {
  function bindTrimInputs(backdrop, duration, change) {
    const start = backdrop.querySelector("[name='trimStart']");
    const end = backdrop.querySelector("[name='trimEnd']");
    for (const [side, input] of [["start", start], ["end", end]]) {
      input.addEventListener("change", () => {
        if (Number.isFinite(input.valueAsNumber)) change(side, input.valueAsNumber);
      });
    }
    return (from, to) => {
      start.value = from.toFixed(2);
      start.min = "0";
      start.max = Math.max(0, to - 0.1).toFixed(2);
      end.value = to.toFixed(2);
      end.min = Math.min(duration, from + 0.1).toFixed(2);
      end.max = duration.toFixed(2);
    };
  }

  function focusable(backdrop) {
    return [...backdrop.querySelectorAll("button, input, textarea, [tabindex='0']")]
      .filter(element => !element.disabled && !element.hidden && element.getClientRects().length);
  }

  function trapTab(event, backdrop) {
    const elements = focusable(backdrop);
    const edge = event.shiftKey ? elements[0] : elements.at(-1);
    if (document.activeElement !== edge && backdrop.contains(document.activeElement)) return;
    event.preventDefault();
    (event.shiftKey ? elements.at(-1) : elements[0])?.focus();
  }

  function bindDialog(backdrop, close, opener = document.activeElement) {
    const keydown = event => {
      if (event.key === "Tab") trapTab(event, backdrop);
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      if (!backdrop.querySelector("[data-create]").disabled) close();
    };
    backdrop.addEventListener("keydown", keydown);
    focusable(backdrop)[0]?.focus();
    return () => {
      backdrop.removeEventListener("keydown", keydown);
      if (opener?.isConnected) opener.focus();
    };
  }

  globalThis.ConvoLabEditorControls = { bindTrimInputs, bindDialog };
})();
