import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import {
  test,
  expect,
  chromium,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { mkdtemp, cp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createServer, type Server } from "node:http";
import path from "node:path";
let live: ChildProcessWithoutNullStreams | undefined;
const liveRequests = new Map<string, (data: any) => void>();
let backend: Server,
  slow = false,
  modelCalls = 0;
let context: BrowserContext, panel: Page, page: Page, temp: string, tab: number;
async function msg(type: string, data: object = {}) {
  return panel.evaluate(
    async ({ type, data }) =>
      await chrome.runtime.sendMessage({ to: "background", type, ...data }),
    { type, data },
  );
}
async function content(type: string, data: object = {}) {
  return panel.evaluate(
    async ({ type, data, tab }) =>
      await chrome.tabs.sendMessage(tab, { to: "content", type, ...data }),
    { type, data, tab },
  );
}
async function snapshot() {
  return content("snapshot", { generation: Date.now() });
}
async function run(text: string) {
  const r = await msg("command", { text });
  expect(r.ok, r.error).toBe(true);
  return r.value;
}
async function focus(label: string) {
  const s = await content("snapshot");
  const e = s.elements.find((x: any) => x.label === label);
  expect(e).toBeTruthy();
  await run("focus " + e.id);
}
test.beforeAll(async () => {
  if (process.env.VOICE_LIVE === "1") {
    live = spawn("../.venv/bin/python", ["../scripts/voice_live_bridge.py"]);
    createInterface({ input: live.stdout }).on("line", (line) => {
      const data = JSON.parse(line);
      liveRequests.get(data.id)?.(data);
      liveRequests.delete(data.id);
    });
    live.stderr.on("data", () => {});
  }
  backend = createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Authorization, Content-Type",
    );
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    if (req.method === "OPTIONS") {
      res.end();
      return;
    }
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/v1/pair") {
      res.end(
        JSON.stringify({ token: "test-token", sessionId: "test-session" }),
      );
      return;
    }
    if (req.url === "/v1/speech/token") {
      res.end(
        JSON.stringify({
          access_token: "fake-temporary-token",
          expires_in: 30,
        }),
      );
      return;
    }
    if (req.url === "/v1/decide") {
      modelCalls++;
      if (live) {
        const id = crypto.randomUUID();
        const response = await new Promise<any>((resolve) => {
          liveRequests.set(id, resolve);
          live!.stdin.write(JSON.stringify({ id, body }) + "\n");
        });
        res.statusCode = response.status;
        res.end(JSON.stringify(response.body));
        return;
      }
      const history = body.history || [];
      const user = body.transcript.toLowerCase();
      let c: any, text: string | undefined, clarification: string | undefined;
      if (user.includes("dylan")) {
        c = body.candidates.find(
          (c: any) =>
            c.operation === "type" &&
            c.label === "Full name" &&
            c.current_value !== "Dylan Li",
        );
        if (c) text = "Dylan Li";
        else if (user.includes("email")) {
          const email = body.transcript.match(/[\w.+-]+@[\w.-]+\.[a-z]+/i)?.[0];
          if (!email) clarification = "What email address should I enter?";
          else {
            c = body.candidates.find(
              (c: any) =>
                c.operation === "type" &&
                c.label === "Email address" &&
                c.current_value !== email,
            );
            if (c) text = email;
          }
        }
        if (
          !c &&
          !clarification &&
          user.includes("submit") &&
          !history.some((h: any) => h.operation === "click")
        )
          c = body.candidates.find(
            (c: any) =>
              c.operation === "click" && c.label === "Register for workshop",
          );
      } else if (!history.length) {
        c = body.candidates.find((c: any) =>
          user.includes("coding")
            ? c.operation === "select" && c.option === "code"
            : c.operation === "focus" && c.label === "Email address",
        );
      }
      if (slow) await new Promise((r) => setTimeout(r, 350));
      const choice = clarification ? "CLARIFY" : c?.id || "DONE";
      res.end(
        JSON.stringify({
          context: body.context,
          choice,
          confidence: 0.99,
          text,
          ...(clarification
            ? { needs_clarification: true, question: clarification }
            : {}),
          probabilities: Object.fromEntries([
            ...body.candidates.map((x: any) => [x.id, x.id === choice ? 1 : 0]),
            ...["CLARIFY", "UNSUPPORTED", "DONE", "WAIT"].map((x) => [
              x,
              x === choice ? 1 : 0,
            ]),
          ]),
          model_ms: 20,
        }),
      );
      return;
    }
    res.statusCode = 404;
    res.end("{}");
  });
  await new Promise<void>((resolve) => backend.listen(0, "127.0.0.1", resolve));
  const mockPort = (backend.address() as { port: number }).port;
  temp = await mkdtemp(path.join(tmpdir(), "jev-extension-"));
  await cp("dist", temp + "/extension", { recursive: true });
  const background = await readFile(temp + "/extension/background.js", "utf8");
  await writeFile(
    temp + "/extension/background.js",
    background.replaceAll("127.0.0.1:8767", `127.0.0.1:${mockPort}`),
  );
  await cp("tests/fake-speech.js", temp + "/extension/fake-speech.js");
  const offscreen = await readFile(temp + "/extension/offscreen.html", "utf8");
  await writeFile(
    temp + "/extension/offscreen.html",
    offscreen.replace("<head>", '<head><script src="fake-speech.js"></script>'),
  );
  // Fixture-only permission is pregranted for unattended tests. The shipped manifest
  // keeps sites optional and requests them through a user gesture.
  const manifest = JSON.parse(
    await readFile(temp + "/extension/manifest.json", "utf8"),
  );
  manifest.content_security_policy.extension_pages =
    manifest.content_security_policy.extension_pages.replaceAll(
      "127.0.0.1:8767",
      `127.0.0.1:${mockPort}`,
    );
  manifest.host_permissions.push(
    "http://127.0.0.1:8768/*",
    "https://example.com/*",
  );
  await writeFile(temp + "/extension/manifest.json", JSON.stringify(manifest));
  context = await chromium.launchPersistentContext(temp + "/profile", {
    channel: "chromium",
    headless: true,
    viewport: { width: 1280, height: 1400 },
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      `--disable-extensions-except=${temp}/extension`,
      `--load-extension=${temp}/extension`,
    ],
  });
  const worker =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent("serviceworker"));
  const id = worker.url().split("/")[2];
  panel = await context.newPage();
  await panel.goto(`chrome-extension://${id}/panel.html`);
  page = await context.newPage();
  await page.goto("http://127.0.0.1:8768/fixture.html");
  tab = await panel.evaluate(async () => {
    const tabs = await chrome.tabs.query({});
    return tabs.find((t) => t.url?.includes("8768/fixture"))!.id!;
  });
  await expect.poll(async () => (await msg("get"))?.ok).toBe(true);
  expect((await msg("bind", { tabId: tab })).ok).toBe(true);
  expect((await msg("pair", { code: "fixture" })).ok).toBe(true);
});
test.afterAll(async () => {
  await context?.close();
  live?.stdin.end();
  live?.kill();
  await new Promise<void>((resolve) => backend?.close(() => resolve()));
  if (temp) await rm(temp, { recursive: true, force: true });
});
test.beforeEach(async () => {
  await page.goto("http://127.0.0.1:8768/fixture.html");
  await page.waitForLoadState();
  expect((await msg("bind", { tabId: tab })).ok).toBe(true);
});
test("twenty form trials: focus, dictate, correct, select, confirm once", async () => {
  const timings: number[] = [];
  for (let i = 0; i < 20; i++) {
    if (i) {
      await page.reload();
      await msg("bind", { tabId: tab });
    }
    await focus("Full name");
    await run("type: Sam");
    await run("start dictation");
    await run("Lee");
    await run("finish dictation");
    await expect(page.locator("#name")).toHaveValue("Sam Lee");
    await focus("Email address");
    await run("type: wrong@example.com");
    await run("undo last entry");
    await expect(page.locator("#email")).toHaveValue("");
    const result = await run("type: sam@example.com");
    timings.push(result.totalMs);
    await run("Choose Creative coding");
    await expect(page.locator("#workshop")).toHaveValue("code");
    const s = await content("snapshot"),
      submit = s.elements.find((e: any) => e.label === "Register for workshop");
    const awaiting = await run("click " + submit.id);
    expect(awaiting.status).toBe("AWAITING_CONFIRMATION");
    await expect(page.locator("#result")).toBeHidden();
    await run("confirm action");
    await expect(page.locator("#result")).toContainText("Local submissions: 1");
    await run("confirm action");
    await expect(page.locator("#result")).toContainText("Local submissions: 1");
  }
  console.log("LOCAL_COMMAND_TIMINGS_MS", JSON.stringify(timings));
});
test("unchanged execution ID mutates at most once and undo is guarded", async () => {
  await focus("Full name");
  const s = await content("snapshot"),
    id = s.elements.find((x: any) => x.label === "Full name").id;
  // Set a generation explicitly for direct executor failure tests.
  const generation = Date.now() + 1000;
  const current = await content("snapshot", { generation });
  const request = {
    documentId: current.documentId,
    generation,
    guard: current.guard,
    action: { id: "one", operation: "type", target: id, text: "A" },
  };
  expect((await content("execute", { request })).status).toBe("executed");
  expect((await content("execute", { request })).status).toBe("executed");
  await expect(page.locator("#name")).toHaveValue("A");
  await page.locator("#name").fill("manual");
  const fresh = await content("snapshot");
  expect(
    (
      await content("execute", {
        request: {
          ...request,
          guard: fresh.guard,
          action: { id: "undo", operation: "undo" },
        },
      })
    ).status,
  ).toBe("stale");
  await expect(page.locator("#name")).toHaveValue("manual");
});
test("replacement, occlusion, disabled fields and cancelled generations block execution", async () => {
  for (const scenario of ["replace", "cover", "disable", "cancel"]) {
    await page.reload();
    await msg("bind", { tabId: tab });
    const generation = Date.now() + 1000;
    const s = await content("snapshot", { generation });
    const target = s.elements.find((e: any) => e.label === "Full name").id;
    if (scenario === "replace")
      await page.evaluate(() => {
        const n = document.querySelector("#name")!;
        n.replaceWith(n.cloneNode(true));
      });
    if (scenario === "cover")
      await page.evaluate(() => {
        const d = document.createElement("div");
        d.style.cssText =
          "position:fixed;inset:0;z-index:999999;background:white";
        document.body.append(d);
      });
    if (scenario === "disable")
      await page
        .locator("#name")
        .evaluate((e: HTMLInputElement) => (e.disabled = true));
    if (scenario === "cancel")
      await content("cancel", { generation: generation + 1 });
    const r = await content("execute", {
      request: {
        documentId: s.documentId,
        generation,
        guard: s.guard,
        action: { id: scenario, operation: "type", target, text: "blocked" },
      },
    });
    expect(r.status).toBe("stale");
    await expect(page.locator("#name")).toHaveValue("");
  }
});
test("form edits invalidate confirmation; sensitive fields are omitted", async () => {
  await page.locator("#name").fill("Sam");
  await page.locator("#email").fill("sam@example.com");
  const s = await content("snapshot");
  const submit = s.elements.find(
    (x: any) => x.label === "Register for workshop",
  );
  await run("click " + submit.id);
  await page.locator("#name").fill("Changed");
  await run("confirm action");
  await expect(page.locator("#result")).toBeHidden();
  await page.evaluate(() => {
    const input = document.createElement("input");
    input.type = "password";
    input.setAttribute("aria-label", "Secret");
    document.querySelector("main")!.prepend(input);
  });
  const fresh = await content("snapshot");
  expect(fresh.elements.some((e: any) => e.label === "Secret")).toBe(false);
});
test("panel is usable at narrow width and screenshot", async () => {
  await panel.setViewportSize({ width: 380, height: 1000 });
  await expect(
    panel.getByRole("button", { name: "Start listening", exact: true }),
  ).toBeVisible();
  expect(
    await panel.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await panel.screenshot({
    path: "test-results/voice-panel.png",
    fullPage: true,
  });
});

test("React-controlled inputs accept native setters and undo", async () => {
  await page.addScriptTag({ path: "tests/.generated/react-fixture.js" });
  await expect(page.locator("#controlled")).toBeVisible();
  await focus("Controlled field");
  await run("type: React value");
  await expect(page.locator("#mirror")).toHaveText("React value");
  await run("undo last entry");
  await expect(page.locator("#mirror")).toHaveText("");
});

test("semantic selection works and late inference after cancellation does not act", async () => {
  await run("Focus the email address");
  await expect(page.locator("#email")).toBeFocused();
  await page.locator("#name").focus();
  slow = true;
  const before = modelCalls;
  const delayed = msg("command", { text: "Focus the email address" });
  await expect.poll(() => modelCalls).toBeGreaterThan(before);
  await msg("cancel");
  await delayed;
  slow = false;
  await expect(page.locator("#name")).toBeFocused();
});
test("confirmation expiry and document mismatch block mutation", async () => {
  const generation = Date.now() + 1000,
    s = await content("snapshot", { generation });
  const target = s.elements.find(
    (e: any) => e.label === "Register for workshop",
  ).id;
  const request = {
    documentId: s.documentId,
    generation,
    guard: s.guard,
    action: { id: "preview", operation: "click", target },
  };
  const result = await content("execute", { request });
  expect(result.status).toBe("confirmation");
  // Advance the isolated world's Date clock with Chrome's virtual time (no real 20s sleep).
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setVirtualTimePolicy", {
    policy: "advance",
    budget: 21000,
  });
  await new Promise((r) => setTimeout(r, 50));
  expect(
    (
      await content("execute", {
        request: {
          ...request,
          confirmed: result.confirmation,
          action: { ...request.action, id: "expired" },
        },
      })
    ).status,
  ).toBe("stale");
  expect(
    (
      await content("execute", {
        request: {
          ...request,
          documentId: "old-document",
          action: { ...request.action, id: "old" },
        },
      })
    ).status,
  ).toBe("stale");
  await cdp.detach();
  // Virtual time persists across navigation. Dispose this test target so later
  // confirmation tests run against the real clock.
  await page.close();
  page = await context.newPage();
  await page.goto("http://127.0.0.1:8768/fixture.html");
  tab = await panel.evaluate(async () => {
    const tabs = await chrome.tabs.query({});
    return tabs.find((t) => t.url?.includes("8768/fixture"))!.id!;
  });
});
test("audio worklet streams PCM; only final speech turns execute, duplicates do not", async () => {
  const fake = async (event?: object, disconnect = false) =>
    panel.evaluate(
      async ({ event, disconnect }) =>
        chrome.runtime.sendMessage({ to: "test-speech", event, disconnect }),
      { event, disconnect },
    );
  await focus("Full name");
  const start = await msg("start");
  expect(start.ok, start.error).toBe(true);
  await expect.poll(async () => (await fake()).chunks).toBeGreaterThan(0);
  const event = (event: string, transcript: string, turn_index: number) =>
    fake({ type: "TurnInfo", event, transcript, turn_index });
  await event("Update", "type: Sam", 0);
  await new Promise((r) => setTimeout(r, 100));
  await expect(page.locator("#name")).toHaveValue("");
  await event("EndOfTurn", "type: Sam", 0);
  await expect(page.locator("#name")).toHaveValue("Sam");
  await event("EndOfTurn", "type: Sam", 0);
  await new Promise((r) => setTimeout(r, 100));
  await expect(page.locator("#name")).toHaveValue("Sam");
  await event("EndOfTurn", "start dictation", 1);
  await expect
    .poll(async () => (await msg("get")).value.mode)
    .toBe("dictation");
  await event("EndOfTurn", "click 12", 2);
  await expect(page.locator("#name")).toHaveValue("Sam click 12");
  const before = (await fake()).chunks;
  const url = panel.url();
  await panel.close();
  await new Promise((r) => setTimeout(r, 150));
  panel = await context.newPage();
  await panel.goto(url);
  await expect.poll(async () => (await fake()).chunks).toBeGreaterThan(before);
  expect((await msg("get")).value.listening).toBe(true);
  await msg("stop");
  expect((await msg("get")).value.listening).toBe(false);
  const stopped = (await fake()).chunks;
  await new Promise((r) => setTimeout(r, 150));
  expect((await fake()).chunks).toBe(stopped);
  expect((await fake()).open).toBe(false);
});
test("speech reconnect drops the old stream and can be paused", async () => {
  expect((await msg("start")).ok).toBe(true);
  await panel.evaluate(() =>
    chrome.runtime.sendMessage({ to: "test-speech", disconnect: true }),
  );
  await expect.poll(async () => (await msg("get")).value.status).toBe("ERROR");
  await expect
    .poll(async () => (await msg("get")).value.status, { timeout: 5000 })
    .toBe("LISTENING");
  await msg("stop");
  expect((await msg("get")).value.listening).toBe(false);
});

test("worker restart clears pending approval and stops existing audio", async () => {
  await page.locator("#name").fill("Sam");
  await page.locator("#email").fill("sam@example.com");
  expect((await msg("start")).ok).toBe(true);
  const s = await content("snapshot");
  const submit = s.elements.find(
    (e: any) => e.label === "Register for workshop",
  );
  await run("click " + submit.id);
  const cdp = await context.newCDPSession(panel);
  await cdp.send("ServiceWorker.enable");
  await cdp.send("ServiceWorker.stopAllWorkers");
  await expect
    .poll(async () => (await msg("get")).value?.listening)
    .toBe(false);
  expect((await msg("get")).value.pending).toBeUndefined();
  await run("confirm action");
  await expect(page.locator("#result")).toBeHidden();
});

test("public website uses the same numbered-link executor", async () => {
  test.skip(
    process.env.VOICE_PUBLIC_SMOKE !== "1",
    "Opt-in network smoke test",
  );
  await page.goto("https://example.com");
  expect((await msg("bind", { tabId: tab })).ok).toBe(true);
  const s = await content("snapshot");
  const link = s.candidates.find((c: any) => c.operation === "click");
  expect(link).toBeTruthy();
  await run("click " + link.target);
  await expect(page).toHaveURL(/iana.org/);
});

test("new ungranted web tab exposes its URL for the site permission prompt", async () => {
  await page.goto("http://localhost:8768/fixture.html");
  await page.bringToFront();
  const current = await panel.evaluate(async () => {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    return {
      url: tab.url,
      allowed: await chrome.permissions.contains({
        origins: ["http://localhost/*"],
      }),
    };
  });
  expect(current.allowed).toBe(false);
  expect(current.url).toBe("http://localhost:8768/fixture.html");
});

test("single-command fill preserves literal value, replaces and supports undo", async () => {
  await page.locator("#name").fill("Previous name");
  await panel
    .getByRole("textbox", { name: "Speak naturally. Or type here." })
    .fill("fill out fullname as Dylan Li");
  await panel.getByRole("button", { name: /^Run command/ }).click();
  await expect(page.locator("#name")).toHaveValue("Dylan Li");
  await run("undo last entry");
  await expect(page.locator("#name")).toHaveValue("Previous name");
});
test("first listening request opens visible permission setup and starts after consent", async () => {
  await panel.evaluate(() => {
    navigator.permissions.query = async () =>
      ({ state: "prompt" }) as PermissionStatus;
  });
  const opened = context.waitForEvent("page");
  await panel
    .getByRole("button", { name: "Start listening", exact: true })
    .click();
  const setup = await opened;
  await setup.waitForLoadState();
  expect(setup.url()).toContain("microphone.html");
  expect((await msg("get")).value.listening).toBe(false);
  await setup
    .getByRole("button", { name: "Allow microphone", exact: true })
    .click();
  await expect(setup.getByRole("status")).toContainText("Listening.");
  expect((await msg("get")).value.listening).toBe(true);
  await msg("stop");
  await setup.close();
});

test("free-form multi-field goal pauses for submission, then resumes to completion", async () => {
  const result = await run(
    "Put Dylan Li in the name box and use dylan@example.com for my email, then submit this form",
  );
  await expect(page.locator("#name")).toHaveValue("Dylan Li");
  await expect(page.locator("#email")).toHaveValue("dylan@example.com");
  expect(result.status).toBe("AWAITING_CONFIRMATION");
  await expect(page.locator("#result")).toBeHidden();
  await run("confirm action");
  await expect(page.locator("#result")).toContainText("Local submissions: 1");
  expect((await msg("get")).value.message).toContain("Goal completed");
});
test("missing information is clarified and the reply resumes the original goal", async () => {
  const result = await run("Fill my name as Dylan Li and my email");
  expect(result.status).toBe("CLARIFYING");
  expect(result.message).toContain("email address");
  await expect(page.locator("#email")).toHaveValue("");
  await run("dylan@example.com");
  await expect(page.locator("#email")).toHaveValue("dylan@example.com");
  await expect(page.locator("#result")).toBeHidden();
});

test("speech stays connected between commands and stops its heartbeat when paused", async () => {
  await focus("Full name");
  await panel.evaluate(() => {
    (window as any).speechHeartbeats = 0;
    chrome.runtime.onMessage.addListener((m) => {
      if (m.type === "speech-event" && m.event?.type === "heartbeat")
        (window as any).speechHeartbeats++;
    });
  });
  expect((await msg("start")).ok).toBe(true);
  const speak = (transcript: string, turn_index: number) =>
    panel.evaluate(
      ({ transcript, turn_index }) =>
        chrome.runtime.sendMessage({
          to: "test-speech",
          event: {
            type: "TurnInfo",
            event: "EndOfTurn",
            transcript,
            turn_index,
          },
        }),
      { transcript, turn_index },
    );
  await speak("type: Sam", 0);
  await expect(page.locator("#name")).toHaveValue("Sam");
  await speak("type: Lee", 1);
  await expect(page.locator("#name")).toHaveValue("SamLee");
  // Do not poll the worker: that would itself hide the idle-session bug.
  await expect
    .poll(() => panel.evaluate(() => (window as any).speechHeartbeats), {
      timeout: 24000,
    })
    .toBeGreaterThanOrEqual(2);
  await new Promise((resolve) => setTimeout(resolve, 12000));
  await speak("type: third", 2);
  await expect(page.locator("#name")).toHaveValue("SamLeethird");
  expect((await msg("get")).value.listening).toBe(true);
  await msg("stop");
  const stopped = await panel.evaluate(() => (window as any).speechHeartbeats);
  await new Promise((resolve) => setTimeout(resolve, 11000));
  expect(await panel.evaluate(() => (window as any).speechHeartbeats)).toBe(
    stopped,
  );
});
