import type {
  Action,
  Candidate,
  Execute,
  Result,
  Snapshot,
} from "../shared/protocol";

// This marker and all references live in Chrome's isolated content-script world.
const scope = globalThis as typeof globalThis & { __jevInstalled?: boolean };
if (!scope.__jevInstalled) {
  scope.__jevInstalled = true;
  install();
}
function install() {
  const newId = () =>
    Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
  const documentId = newId();
  const ids = new WeakMap<Element, string>();
  const nodes = new Map<string, HTMLElement>();
  let next = 1,
    version = 0,
    generation = 0,
    overlayOn = true;
  const ledger = new Map<string, Result>();
  let undo:
    | {
        element: HTMLInputElement | HTMLTextAreaElement;
        before: string;
        after: string;
      }
    | undefined;
  let pending:
    | { token: string; digest: string; action: Action; expires: number }
    | undefined;
  const host = document.createElement("div");
  host.dataset.jevOverlay = "";
  const shadow = host.attachShadow({ mode: "closed" });
  document.documentElement.append(host);
  const selectors =
    'input,textarea,select,button,a[href],[role="button"],[role="link"],[role="checkbox"],[role="radio"],video,audio';
  const sensitive = (e: HTMLElement) =>
    e instanceof HTMLInputElement &&
    (![
      "text",
      "search",
      "email",
      "tel",
      "url",
      "number",
      "checkbox",
      "radio",
      "button",
      "submit",
      "reset",
    ].includes(e.type) ||
      /cc-|password|one-time-code/.test(e.autocomplete) ||
      /password|credit.?card|card.?number|cvc|cvv|social.?security/i.test(
        `${e.name} ${e.id} ${e.getAttribute("aria-label")}`,
      ));
  const editable = (e: HTMLElement) =>
    ((e instanceof HTMLInputElement &&
      ["text", "search", "email", "tel", "url", "number"].includes(e.type)) ||
      e instanceof HTMLTextAreaElement) &&
    !sensitive(e) &&
    !e.hasAttribute("readonly");
  function name(e: HTMLElement) {
    const labelled = (e.getAttribute("aria-labelledby") || "")
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent || "")
      .join(" ")
      .trim();
    const labels =
      "labels" in e
        ? Array.from((e as HTMLInputElement).labels || [])
            .map((x) => x.textContent)
            .join(" ")
        : "";
    return (
      e.getAttribute("aria-label") ||
      labelled ||
      labels ||
      e.getAttribute("placeholder") ||
      e.innerText ||
      e.getAttribute("title") ||
      e.getAttribute("name") ||
      e.tagName.toLowerCase()
    )
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, 300);
  }
  function visible(e: HTMLElement) {
    const r = e.getBoundingClientRect(),
      s = getComputedStyle(e);
    return (
      e.isConnected &&
      r.width > 0 &&
      r.height > 0 &&
      r.bottom > 0 &&
      r.right > 0 &&
      r.top < innerHeight &&
      r.left < innerWidth &&
      s.visibility === "visible" &&
      s.display !== "none" &&
      s.opacity !== "0" &&
      !e.closest("[inert]")
    );
  }
  function enabled(e: HTMLElement) {
    return !e.matches(':disabled,[aria-disabled="true"]') && !sensitive(e);
  }
  function id(e: HTMLElement) {
    let n = ids.get(e);
    if (!n) {
      n = String(next++);
      ids.set(e, n);
      nodes.set(n, e);
    }
    return n;
  }
  function state(e: HTMLElement) {
    const r = e.getBoundingClientRect();
    return [
      name(e),
      e.tagName,
      e.getAttribute("type"),
      e.getAttribute("href"),
      e.getAttribute("formaction"),
      e.getAttribute("onclick"),
      e.getAttribute("role"),
      e.getAttribute("aria-checked"),
      e.getAttribute("aria-expanded"),
      "value" in e ? (e as HTMLInputElement).value : null,
      "checked" in e ? (e as HTMLInputElement).checked : null,
      enabled(e),
      visible(e),
      Math.round(r.x),
      Math.round(r.y),
      Math.round(r.width),
      Math.round(r.height),
      e instanceof HTMLSelectElement
        ? Array.from(e.options).map((o) => [o.value, o.label, o.disabled])
        : null,
    ];
  }
  function digest() {
    return JSON.stringify([
      location.href,
      Array.from(nodes)
        .filter(([, e]) => e.isConnected && !sensitive(e))
        .map(([n, e]) => [n, state(e)]),
      Array.from(document.forms).map((f) => [
        f.action,
        f.method,
        Array.from(f.elements).map((e) =>
          "value" in e ? (e as HTMLInputElement).value : "",
        ),
      ]),
    ]);
  }
  function snapshot(): Snapshot {
    const candidates: Candidate[] = [];
    const elements: Snapshot["elements"] = [];
    let omitted = 0;
    for (const [n, e] of nodes) if (!e.isConnected) nodes.delete(n);
    for (const e of document.querySelectorAll<HTMLElement>(selectors)) {
      if (!visible(e) || !enabled(e)) continue;
      const n = id(e),
        label = name(e);
      const offered: Candidate[] = [];
      if (editable(e))
        offered.push(
          {
            id: `focus:${n}`,
            operation: "focus",
            target: n,
            label,
          },
          {
            id: `type:${n}`,
            operation: "type",
            target: n,
            label,
            current_value: (e as HTMLInputElement).value.slice(0, 2000),
            focused: document.activeElement === e,
            required: e.hasAttribute("required"),
          },
        );
      else if (e instanceof HTMLSelectElement) {
        for (const o of Array.from(e.options).filter(
          (o) => !o.disabled && !o.hidden,
        ))
          offered.push({
            id: `select:${n}:${o.index}`,
            operation: "select",
            target: n,
            option: o.value.slice(0, 300),
            current_value: e.value.slice(0, 2000),
            label: `${label}: ${o.label}`.slice(0, 300),
          });
      } else if (e instanceof HTMLMediaElement)
        for (const op of ["play", "pause"] as const)
          offered.push({
            id: `${op}:${n}`,
            operation: op,
            target: n,
            label: `${op} ${label}`.slice(0, 300),
          });
      else
        offered.push({
          id: `click:${n}`,
          operation: "click",
          target: n,
          label:
            e instanceof HTMLInputElement &&
            ["checkbox", "radio"].includes(e.type)
              ? `${label} (${e.checked ? "checked" : "unchecked"})`.slice(
                  0,
                  300,
                )
              : label,
        });
      if (candidates.length + offered.length > 193) {
        omitted += offered.length;
        continue;
      }
      candidates.push(...offered);
      elements.push({ id: n, label, editable: editable(e) });
    }
    candidates.push(
      { id: "scroll_up", operation: "scroll_up", label: "Scroll page up" },
      {
        id: "scroll_down",
        operation: "scroll_down",
        label: "Scroll page down",
      },
      { id: "back", operation: "back", label: "Go back" },
    );
    render(elements);
    return {
      documentId,
      version,
      title: document.title.slice(0, 300),
      text: (document.body?.innerText || "").slice(0, 6000),
      url: location.href,
      candidates,
      elements,
      omitted,
      guard: digest(),
      active:
        document.activeElement instanceof HTMLElement
          ? ids.get(document.activeElement)
          : undefined,
    };
  }
  function render(elements: Snapshot["elements"]) {
    shadow.replaceChildren();
    if (!overlayOn) return;
    for (const item of elements) {
      const e = nodes.get(item.id)!;
      const r = e.getBoundingClientRect();
      const b = document.createElement("span");
      b.textContent = item.id;
      b.style.cssText = `position:fixed;left:${Math.max(0, r.left)}px;top:${Math.max(0, r.top - 15)}px;background:#123f36;color:white;font:bold 12px monospace;padding:2px 5px;border:1px solid white;border-radius:3px;pointer-events:none;z-index:2147483647;`;
      shadow.append(b);
    }
    host.style.cssText =
      "pointer-events:none;position:fixed;inset:0;z-index:2147483647;";
  }
  const observer = new MutationObserver((records) => {
    if (records.some((r) => r.target !== host && !host.contains(r.target)))
      version++;
  });
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true,
  });
  for (const event of ["input", "change", "scroll", "resize"])
    addEventListener(
      event,
      () => {
        version++;
        if (event === "scroll" || event === "resize") shadow.replaceChildren();
      },
      { capture: true, passive: true },
    );
  function valueSet(e: HTMLInputElement | HTMLTextAreaElement, value: string) {
    const proto =
      e instanceof HTMLInputElement
        ? HTMLInputElement.prototype
        : HTMLTextAreaElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(e, value);
    e.dispatchEvent(new Event("input", { bubbles: true }));
    e.dispatchEvent(new Event("change", { bubbles: true }));
  }
  function risk(e: HTMLElement, action: Action) {
    return (
      action.operation === "clear" ||
      (action.operation === "click" &&
        (e.matches(
          'button:not([type="button"]):not([type="reset"]),input[type="submit"],input[type="reset"]',
        ) ||
          /submit|send|delete|remove|purchase|buy|pay|order|confirm|publish|book|sign.?up|register/i.test(
            name(e),
          )))
    );
  }
  async function execute(req: Execute): Promise<Result> {
    if (ledger.has(req.action.id)) return ledger.get(req.action.id)!;
    if (ledger.size >= 1000)
      return {
        status: "unsupported",
        message: "Document action budget reached. Reload the page.",
      };
    // Consume before any awaited effect; even uncertain results are never replayed.
    const finish = (r: Result) => {
      ledger.set(req.action.id, r);
      return r;
    };
    ledger.set(req.action.id, {
      status: "failed",
      message: "Action was already attempted; it will not be replayed.",
    });
    if (
      req.documentId !== documentId ||
      req.generation !== generation ||
      req.guard !== digest()
    )
      return finish({
        status: "stale",
        message: "Page changed. Repeat the command.",
      });
    const a = req.action,
      e = a.target ? nodes.get(a.target) : undefined;
    if (a.target && (!e || !visible(e) || !enabled(e)))
      return finish({
        status: "stale",
        message: "Target is no longer available.",
      });
    if (e) {
      const r = e.getBoundingClientRect();
      const top = document.elementFromPoint(
        Math.max(0, Math.min(innerWidth - 1, r.left + r.width / 2)),
        Math.max(0, Math.min(innerHeight - 1, r.top + r.height / 2)),
      );
      if (top !== e && !e.contains(top))
        return finish({
          status: "stale",
          message: "Target is covered. Close the covering dialog first.",
        });
    }
    if (e && risk(e, a)) {
      if (!req.confirmed) {
        pending = {
          token: newId(),
          digest: digest(),
          action: a,
          expires: Date.now() + 20000,
        };
        return finish({
          status: "confirmation",
          message: "Review the page, then say “confirm action” or “cancel”.",
          confirmation: pending.token,
          label: name(e),
        });
      }
      const valid =
        pending &&
        pending.token === req.confirmed &&
        pending.expires > Date.now() &&
        pending.digest === digest() &&
        pending.action.operation === a.operation &&
        pending.action.target === a.target;
      pending = undefined;
      if (!valid)
        return finish({
          status: "stale",
          message:
            "Confirmation expired or the form changed. Repeat the original command.",
        });
    }
    try {
      if (a.operation === "type" || a.operation === "clear") {
        if (!e || !editable(e))
          return finish({
            status: "unsupported",
            message: "Focus a supported text field first.",
          });
        const field = e as HTMLInputElement | HTMLTextAreaElement,
          before = field.value;
        const after =
          a.operation === "clear"
            ? ""
            : (a.replace ? "" : before) +
              (a.dictation && before && !/\s$/.test(before) ? " " : "") +
              (a.text || "");
        if (
          after.length > 10000 ||
          (field.maxLength >= 0 && after.length > field.maxLength)
        )
          return finish({
            status: "unsupported",
            message: "Field text limit reached.",
          });
        valueSet(field, after);
        undo = { element: field, before, after };
        await new Promise((r) => setTimeout(r, 0));
        return finish({
          status: field.value === after ? "executed" : "failed",
          message:
            field.value === after
              ? "Field updated."
              : "The page rejected the value.",
          verified: field.value === after,
        });
      }
      if (a.operation === "undo") {
        const previous = undo;
        undo = undefined;
        if (
          !previous ||
          !previous.element.isConnected ||
          previous.element.value !== previous.after ||
          !enabled(previous.element) ||
          !visible(previous.element) ||
          !editable(previous.element)
        )
          return finish({
            status: "stale",
            message: "Cannot undo: the field changed or no entry is available.",
          });
        valueSet(previous.element, previous.before);
        await new Promise((r) => setTimeout(r, 0));
        return finish({
          status: "executed",
          message: "Last entry restored.",
          verified: previous.element.value === previous.before,
        });
      }
      if (a.operation === "focus" && e && editable(e)) {
        e.focus();
        return finish({
          status: "executed",
          message: `Focused ${name(e)}. Say “type” followed by your text.`,
          verified: document.activeElement === e,
        });
      }
      if (a.operation === "select" && e instanceof HTMLSelectElement) {
        if (
          !Array.from(e.options).some(
            (o) => o.value === a.option && !o.disabled,
          )
        )
          throw Error("Option is unavailable.");
        e.value = a.option!;
        e.dispatchEvent(new Event("input", { bubbles: true }));
        e.dispatchEvent(new Event("change", { bubbles: true }));
        await new Promise((r) => setTimeout(r, 0));
        return finish({
          status: "executed",
          message: "Option selected.",
          verified: e.value === a.option,
        });
      }
      if (a.operation === "click" && e) {
        e.click();
        return finish({
          status: "executed",
          message: "Click sent. Check the page for the result.",
          verified: false,
        });
      }
      if (a.operation === "scroll_up" || a.operation === "scroll_down") {
        scrollBy({
          top: innerHeight * 0.65 * (a.operation === "scroll_up" ? -1 : 1),
          behavior: "instant",
        });
        return finish({
          status: "executed",
          message: "Page scrolled.",
          verified: true,
        });
      }
      if (a.operation === "back") {
        history.back();
        return finish({
          status: "executed",
          message: "Back requested.",
          verified: false,
        });
      }
      if (
        (a.operation === "play" || a.operation === "pause") &&
        e instanceof HTMLMediaElement
      ) {
        if (a.operation === "play") await e.play();
        else e.pause();
        return finish({
          status: "executed",
          message: `Media ${a.operation}.`,
          verified: e.paused === (a.operation === "pause"),
        });
      }
      return finish({
        status: "unsupported",
        message: "Unsupported action on this element.",
      });
    } catch (error) {
      return finish({
        status: "failed",
        message: error instanceof Error ? error.message : "Page action failed.",
      });
    }
  }
  chrome.runtime.onMessage.addListener((m, sender, reply) => {
    if (sender.id !== chrome.runtime.id) return;
    if (m.to !== "content") return;
    if (m.type === "snapshot") {
      generation = Math.max(generation, m.generation ?? 0);
      reply(snapshot());
    } else if (m.type === "cancel") {
      generation = Math.max(generation, m.generation);
      pending = undefined;
      reply({ ok: true });
    } else if (m.type === "overlay") {
      overlayOn = m.enabled;
      reply(snapshot());
    } else if (m.type === "execute") {
      execute(m.request)
        .then(reply)
        .catch(() =>
          reply({
            status: "failed",
            message: "Execution failed; do not replay.",
          }),
        );
      return true;
    }
  });
}
