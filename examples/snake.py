"""Run the real Google Snake with Jev choosing moves, in explicitly paced mode.

uv run --env-file .env python examples/snake.py
"""

from jev_ultrafast.snake import SnakeAgent


def main():
    with SnakeAgent() as agent:
        for state in agent.run():
            print(f"{state['status']:>9}  moves={len(state['history'])}  score={state['snake']['score']}", flush=True)
        return 0 if state["status"] == "done" else 2


if __name__ == "__main__":
    raise SystemExit(main())
