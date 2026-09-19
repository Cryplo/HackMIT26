"""Jev plays the real Google Snake in explicitly paced, canvas-observed mode."""

import hashlib
import json
import os
import time
from pathlib import Path

from .browser import Browser, StalePage, cdp, ensure_daemon
from .model import GATEWAY_URL, gateway_key, post_json, validate_choice

URL = "https://www.google.com/fbx?fbx=snake_arcade"
GOAL = "Collect 3 apples in Google Snake without hitting a wall or the snake. The game pauses between moves."
READ_BOARD = Path(__file__).with_name("snake_board.js").read_text()
DIRECTIONS = {"UP": (0, -1, 38), "RIGHT": (1, 0, 39), "DOWN": (0, 1, 40), "LEFT": (-1, 0, 37)}
OPPOSITE = {"UP": "DOWN", "DOWN": "UP", "LEFT": "RIGHT", "RIGHT": "LEFT"}
MAX_MOVES = 150
MIN_DECISION_INTERVAL = 1.25  # At most 48 Snake decisions/minute, excluding provider retries.


class SnakeBrowser(Browser):
    """An isolated browser context keeps game timing and settings off other tabs."""

    def __init__(self):
        ensure_daemon()
        self.context = cdp("Target.createBrowserContext")["browserContextId"]
        self.target = None
        try:
            self.target = cdp("Target.createTarget", url="about:blank", browserContextId=self.context)["targetId"]
            self.session = cdp("Target.attachToTarget", targetId=self.target, flatten=True)["sessionId"]
            self.call("Emulation.setDeviceMetricsOverride", width=1120, height=780, deviceScaleFactor=1, mobile=False)
            self.call("Emulation.setFocusEmulationEnabled", enabled=True)
            self.call("Page.navigate", url=URL)
            deadline = time.monotonic() + 25
            while time.monotonic() < deadline:
                if self.evaluate("document.readyState") == "complete":
                    return
                time.sleep(.05)
            raise ValueError("Google Snake did not finish loading. Check the connection and start again.")
        except Exception:
            self.close()
            raise

    def close(self):
        try:
            super().close()
        finally:
            if self.context:
                cdp("Target.disposeBrowserContext", browserContextId=self.context)
                self.context = None


def head_cell(board, direction):
    if board["eye"] is None:
        raise ValueError("Cannot locate the snake's eyes; stopped without guessing a move.")
    dx, dy, _ = DIRECTIONS[direction]
    x, y = board["eye"]
    size = board["cell_size"]
    ox, oy = board["origin"]
    return [int((x + dx * size * .20 - ox) // size), int((y + dy * size * .20 - oy) // size)]


def legal_moves(board, head, direction):
    occupied = {tuple(cell) for cell in board["body"] if cell != head}
    moves = {}
    for name, (dx, dy, _) in DIRECTIONS.items():
        target = (head[0] + dx, head[1] + dy)
        if (name != OPPOSITE[direction] and 0 <= target[0] < board["width"]
                and 0 <= target[1] < board["height"] and target not in occupied):
            moves[name] = {"next_cell": list(target)}
    return moves


def choose_direction(board, head, direction, goal, history):
    moves = legal_moves(board, head, direction)
    if not moves:
        return None
    body = {
        "model": os.environ.get("JEV_MODEL", "typesafe-ai/jev"),
        "state": {"width": board["width"], "height": board["height"], "head": head,
                  "body": board["body"], "apples": board["apples"], "direction": direction,
                  "score": board["score"], "recent_moves": history[-8:]},
        "questions": {"direction": {
            "type": "choice", "criteria": moves,
            "instructions": {"goal": goal, "rules": (
                "Choose the next direction in classic Snake. x increases right, y increases down. "
                "Reach the apple while preserving open space and avoiding traps. "
                "Only offered directions can execute. The game advances about one cell per choice. "
                "Prefer progress toward the apple unless it would trap the snake."
            )},
        }},
    }
    start = time.perf_counter()
    result = post_json(GATEWAY_URL + "/typesafe/v1/systemone", gateway_key(), body)
    answer = validate_choice(result.get("answers", {}).get("direction", {}), moves)
    return {"choice": answer["choice"], "operation": answer["choice"], "target": None,
            "confidence": answer["confidence"], "probabilities": answer["probabilities"],
            "operation_probabilities": answer["probabilities"], "target_probabilities": {},
            "target_confidence": None, "latency_ms": round((time.perf_counter()-start)*1000),
            "model": result.get("model", body["model"]), "usage": result.get("usage", {}), "request": body}


class SnakeAgent:
    """Inspector-compatible agent. No general DOM action policy or text helper."""

    def __init__(self, goal=GOAL):
        self.browser = SnakeBrowser()
        self.direction = "RIGHT"
        self.started = time.perf_counter()
        self.state = {"goal": goal, "plan": [goal], "plan_index": 0, "scenario": "snake",
                      "status": "ready", "history": [], "decisions": [], "text_calls": [],
                      "decision": None, "elapsed_ms": 0, "record": False}
        try:
            time.sleep(.6)  # Allow Google's opening menu animation to finish.
            page = self.browser.observe(screenshot=False)
            play = next((a for a in page["actions"] if a["label"].strip() == "Play"), None)
            if play is None:
                raise ValueError("Google Snake's Play button was not found. Use classic mode and try again.")
            self.browser.act(play, page)
            time.sleep(.4)
            self.browser.call("Emulation.setVirtualTimePolicy", policy="pause")
            self.board = self.read_board()
            self.head = head_cell(self.board, self.direction)
            self.refresh()
        except Exception:
            self.browser.close()
            raise

    def read_board(self):
        result = self.browser.evaluate("(() => { try { return {board: " + READ_BOARD +
                                       "}; } catch(e) { return {error: e.message}; } })()")
        if not result or result.get("error"):
            raise ValueError((result or {}).get("error", "Snake page changed; start again."))
        return result["board"]

    def refresh(self):
        board = self.board
        semantic = {k: board[k] for k in ("body", "apples", "score", "game_over")}
        semantic["head"] = self.head
        fingerprint = hashlib.sha256(json.dumps(semantic, sort_keys=True).encode()).hexdigest()
        self.state["elapsed_ms"] = round((time.perf_counter()-self.started)*1000)
        self.state["page"] = {
            "url": URL, "title": f"Google Snake · score {board['score']} · paced mode",
            "text": json.dumps(semantic), "actions": [], "fingerprint": fingerprint,
            "screenshot": board["image"], "screenshot_mime": "image/png",
            "w": board["canvas_width"], "h": board["canvas_height"],
        }
        self.state["snake"] = {**semantic, "mode": "paused between moves", "target_score": 3,
                               "move_limit": MAX_MOVES}

    def snapshot(self):
        return {**self.state, "elements": []}

    def command(self, name, body=None):
        if name == "tick":
            self.command("predict")
            if self.state["status"] in {"done", "blocked"}:
                return self.snapshot()
            return self.command("act", {"fingerprint": self.state["page"]["fingerprint"]})
        if self.state["status"] in {"done", "blocked"}:
            raise ValueError("This Snake run has stopped. Start a fresh demo.")
        if name == "predict":
            self.state["decision"] = None
            self.board = self.read_board()
            self.head = head_cell(self.board, self.direction)
            self.refresh()
            if self.board["score"] >= 3:
                self.state.update(status="done", plan_index=1)
                return self.snapshot()
            if self.board["game_over"] or len(self.state["decisions"]) >= MAX_MOVES:
                self.state["status"] = "blocked"
                return self.snapshot()
            delay = MIN_DECISION_INTERVAL - (time.monotonic() - getattr(self, "last_prediction", 0))
            if delay > 0:
                time.sleep(delay)
            self.last_prediction = time.monotonic()
            decision = choose_direction(self.board, self.head, self.direction, self.state["goal"],
                                        [h["operation"] for h in self.state["history"]])
            if decision is None:
                self.state["status"] = "blocked"
                return self.snapshot()
            self.state["decision"] = decision
            self.state["decisions"].append(decision)
            self.state["status"] = "predicted"
        elif name == "act":
            decision = self.state["decision"]
            self.state["decision"] = None
            if not decision or (body or {}).get("fingerprint") != self.state["page"]["fingerprint"]:
                raise ValueError("Choose a Snake move before executing it.")
            before = self.state["page"]["fingerprint"]
            self.board = self.read_board()
            self.head = head_cell(self.board, self.direction)
            self.refresh()
            if before != self.state["page"]["fingerprint"]:
                self.state["status"] = "ready"
                raise StalePage("Snake board changed. Choose again.")
            direction = decision["choice"]
            if direction not in legal_moves(self.board, self.head, self.direction):
                raise ValueError("Selected direction is no longer legal; nothing executed.")
            old_head = self.head[:]
            dx, dy, keycode = DIRECTIONS[direction]
            expected_head = [old_head[0] + dx, old_head[1] + dy]
            key = "Arrow" + direction.title()
            for kind in ("keyDown", "keyUp"):
                self.browser.call("Input.dispatchKeyEvent", type=kind, key=key, code=key,
                                  windowsVirtualKeyCode=keycode)
            self.direction = direction
            # Record dispatched input before advancing/observing. Never replay it.
            self.state["history"].append({
                "step": len(self.state["history"])+1, "action": f"Arrow {direction.lower()}",
                "kind": "key", "choice": direction, "operation": direction, "target": None,
                "probability": decision["probabilities"][direction], "confidence": decision["confidence"],
                "latency_ms": decision["latency_ms"], "usage": decision["usage"], "text": None,
                "text_helper": None, "text_latency_ms": 0, "page_changed": None,
                "elapsed_ms": self.state["elapsed_ms"], "url": URL,
            })
            for _ in range(20):
                self.browser.call("Emulation.setVirtualTimePolicy", policy="advance", budget=20,
                                  maxVirtualTimeTaskStarvationCount=100)
                time.sleep(.025)
                self.board = self.read_board()
                self.head = head_cell(self.board, direction)
                if self.head == expected_head or self.board["game_over"]:
                    break
            self.browser.call("Emulation.setVirtualTimePolicy", policy="pause")
            self.refresh()
            self.state["history"][-1].update(page_changed=self.head != old_head,
                                            elapsed_ms=self.state["elapsed_ms"])
            if self.board["score"] >= 3:
                self.state.update(status="done", plan_index=1)
            else:
                self.state["status"] = (
                    "blocked" if self.head != expected_head or self.board["game_over"] else "ready"
                )
        else:
            raise ValueError("Unknown Snake command")
        return self.snapshot()

    def close(self):
        self.browser.close()

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        self.close()

    def run(self):
        while self.state["status"] not in {"done", "blocked"}:
            yield self.command("tick")
