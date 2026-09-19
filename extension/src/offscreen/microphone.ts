import "../panel/style.css";
const status = document.getElementById("status")!;
const button = document.getElementById("grant") as HTMLButtonElement;
button.onclick = async () => {
  button.disabled = true;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    const result = await chrome.runtime.sendMessage({
      to: "background",
      type: "start",
    });
    if (!result?.ok) throw Error(result?.error || "Could not start listening.");
    status.textContent =
      "Listening. Return to your selected page to give a command.";
    const back = document.createElement("button");
    back.textContent = "Return to selected page";
    back.onclick = async () => {
      if (result.value?.tabId !== undefined)
        await chrome.tabs.update(result.value.tabId, { active: true });
      const current = await chrome.tabs.getCurrent();
      if (current?.id !== undefined) await chrome.tabs.remove(current.id);
    };
    status.after(back);
  } catch (error) {
    const denied =
      error instanceof DOMException && error.name === "NotAllowedError";
    status.textContent = denied
      ? "Microphone permission was dismissed or blocked. Click Allow microphone again and choose Allow in Chrome. If no prompt appears, allow microphone access in Chrome site settings and macOS System Settings → Privacy & Security → Microphone → Google Chrome."
      : error instanceof Error
        ? error.message
        : "Microphone setup failed.";
    button.disabled = false;
  }
};
