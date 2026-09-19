"""Project CLI. Model decisions and independent outcome checks are reported separately."""

import argparse
import json
import os
import sys
from pathlib import Path
from urllib.parse import urlsplit

from dotenv import load_dotenv

from jev_ultrafast import Agent


def web_url(value):
    try:
        parsed = urlsplit(value)
        valid = parsed.scheme in {"http", "https"} and parsed.hostname and not parsed.username and not parsed.password
        _ = parsed.port
    except ValueError:
        valid = False
    if not valid:
        raise argparse.ArgumentTypeError("Use an http:// or https:// URL without embedded credentials")
    return value


def positive_int(value):
    number = int(value)
    if not 1 <= number <= 60:
        raise argparse.ArgumentTypeError("Choose a step budget from 1 to 60")
    return number


def verify(page, expected_text, expected_url):
    checks = []
    if expected_text:
        checks.append({"check": "visible_text", "passed": expected_text.casefold() in page["text"].casefold()})
    if expected_url:
        checks.append({"check": "exact_url", "passed": page["url"] == expected_url})
    return checks


def run(args):
    if not os.environ.get("AI_GATEWAY_API_KEY", "").strip():
        raise ValueError("Set AI_GATEWAY_API_KEY in .env before running the agent")
    if not args.goal.strip():
        raise ValueError("Supply a nonempty goal")
    # Open before launching Chrome so an unwritable trace cannot discard an entire run.
    trace = None
    if args.trace:
        args.trace.parent.mkdir(parents=True, exist_ok=True)
        trace = args.trace.open("x", encoding="utf-8")
    try:
        with Agent(args.url, args.goal, screenshots=args.screenshots) as agent:
            state = agent.snapshot()
            for _ in range(args.max_steps):
                state = agent.command("tick")
                event = {
                    "status": state["status"], "elapsed_ms": state["elapsed_ms"],
                    "actions": len(state["history"]), "url": state["page"]["url"],
                    "last_action": state["history"][-1] if state["history"] else None,
                }
                print(json.dumps(event), flush=True)
                if trace:
                    trace.write(json.dumps(state) + "\n")
                    trace.flush()
                if state["status"] in {"done", "blocked"}:
                    break
            else:
                state["status"] = "budget_exhausted"
            # A new DOM read, independent of the model's DONE prediction.
            page = agent.browser.observe(screenshot=False)
            checks = verify(page, args.expect_text, args.expect_url)
            verified = all(check["passed"] for check in checks) if checks else None
            result = {
                "status": state["status"], "verified": verified, "checks": checks,
                "url": page["url"], "actions": len(state["history"]), "elapsed_ms": state["elapsed_ms"],
            }
            print(json.dumps(result), flush=True)
            if trace:
                trace.write(json.dumps({"result": result}) + "\n")
            return 0 if state["status"] == "done" and verified is not False else 2
    finally:
        if trace:
            trace.close()


def main(argv=None):
    load_dotenv(Path.cwd() / ".env")
    parser = argparse.ArgumentParser(description="Jev + Browser Use for HackMIT 26")
    commands = parser.add_subparsers(dest="command", required=True)
    task = commands.add_parser("run", help="Run a natural-language browser task")
    task.add_argument("--url", required=True, type=web_url)
    task.add_argument("--goal", required=True)
    task.add_argument("--max-steps", type=positive_int, default=30, help="Decision-cycle budget (1–60)")
    task.add_argument("--trace", type=Path, help="Write JSONL to a new file; includes page content and typed values")
    task.add_argument("--screenshots", action="store_true")
    task.add_argument("--expect-text", help="Check final visible text independently of Jev")
    task.add_argument("--expect-url", type=web_url, help="Check the exact final URL independently of Jev")
    commands.add_parser("demo", help="Open the upstream local visual inspector on port 8766")
    server = commands.add_parser("serve", help="Voice extension backend on 127.0.0.1:8767")
    server.add_argument("--extension-id", required=True, help="ID from chrome://extensions")
    args = parser.parse_args(argv)
    try:
        if args.command == "serve":
            import secrets

            import uvicorn

            from hackmit26.server.app import create_app
            code = secrets.token_urlsafe(12)
            app = create_app("chrome-extension://" + args.extension_id, code)
            print(f"Pairing code (single use, expires in 10 minutes): {code}", flush=True)
            uvicorn.run(app, host="127.0.0.1", port=8767, access_log=False)
            return 0
        if args.command == "demo":
            from jev_ultrafast.demo import main as demo
            demo()
            return 0
        return run(args)
    except KeyboardInterrupt:
        print("Interrupted; browser tab closed.", file=sys.stderr)
        return 130
    except (ValueError, RuntimeError, OSError) as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
