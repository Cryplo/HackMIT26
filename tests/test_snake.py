"""Snake decisions stay bounded to observed cells and safe arrow keys."""

from copy import deepcopy
from unittest.mock import Mock

import pytest

from jev_ultrafast import demo, snake


def board():
    return {"width": 17, "height": 15, "body": [[2, 7], [3, 7]], "apples": [[12, 7]],
            "eye": [153, 290], "origin": [28, 28], "cell_size": 35, "score": 0,
            "game_over": False, "image": "test-image", "canvas_width": 650, "canvas_height": 580}


def test_moves_exclude_reverse_wall_and_body():
    b = board()
    b["body"] = [[0, 0], [0, 1]]
    assert set(snake.legal_moves(b, [0, 0], "UP")) == {"RIGHT"}
    b["body"].append([1, 0])
    assert snake.legal_moves(b, [0, 0], "UP") == {}


def test_eye_reader_rejects_unknown_head():
    b = board()
    assert snake.head_cell(b, "RIGHT") == [3, 7]
    b["eye"] = None
    with pytest.raises(ValueError, match="without guessing"):
        snake.head_cell(b, "RIGHT")


def test_jev_request_uses_canvas_state_and_only_offered_directions(monkeypatch):
    monkeypatch.setenv("AI_GATEWAY_API_KEY", "test")

    def post(url, key, body):
        assert url.endswith("/typesafe/v1/systemone")
        assert body["state"]["head"] == [3, 7]
        assert "image" not in body["state"]
        criteria = body["questions"]["direction"]["criteria"]
        assert set(criteria) == {"UP", "RIGHT", "DOWN"}
        return {"answers": {"direction": {"choice": "RIGHT", "confidence": 1,
                "probabilities": {k: float(k == "RIGHT") for k in criteria}}}}

    monkeypatch.setattr(snake, "post_json", post)
    assert snake.choose_direction(board(), [3, 7], "RIGHT", snake.GOAL, [])["choice"] == "RIGHT"


def test_invented_direction_rejected(monkeypatch):
    monkeypatch.setenv("AI_GATEWAY_API_KEY", "test")
    monkeypatch.setattr(snake, "post_json", Mock(return_value={"answers": {"direction": {
        "choice": "javascript", "confidence": 1, "probabilities": {"javascript": 1},
    }}}))
    with pytest.raises(ValueError, match="Invalid TypeSafe"):
        snake.choose_direction(board(), [3, 7], "RIGHT", snake.GOAL, [])


def test_no_legal_move_does_not_call_model(monkeypatch):
    b = board()
    b["body"] = [[0, 0], [1, 0], [0, 1]]
    post = Mock()
    monkeypatch.setattr(snake, "post_json", post)
    assert snake.choose_direction(b, [0, 0], "UP", snake.GOAL, []) is None
    post.assert_not_called()


@pytest.fixture
def agent(monkeypatch):
    a = snake.SnakeAgent.__new__(snake.SnakeAgent)
    a.browser = Mock()
    a.board = board()
    a.head = [3, 7]
    a.direction = "RIGHT"
    a.started = snake.time.perf_counter()
    a.state = {"status": "ready", "history": [], "decisions": [], "decision": None,
               "goal": snake.GOAL, "plan_index": 0}
    a.refresh()
    monkeypatch.setattr(a, "read_board", lambda: deepcopy(a.board))
    return a


def test_success_is_observed_score_not_model_done(agent, monkeypatch):
    agent.board["score"] = 3
    choose = Mock()
    monkeypatch.setattr(snake, "choose_direction", choose)
    assert agent.command("tick")["status"] == "done"
    choose.assert_not_called()
    agent.browser.call.assert_not_called()


def test_budget_stops_without_another_paid_call(agent, monkeypatch):
    agent.state["decisions"] = [{}] * snake.MAX_MOVES
    choose = Mock()
    monkeypatch.setattr(snake, "choose_direction", choose)
    assert agent.command("tick")["status"] == "blocked"
    choose.assert_not_called()


def test_wrong_fingerprint_consumes_decision_without_input(agent):
    agent.state["decision"] = {"choice": "RIGHT"}
    with pytest.raises(ValueError, match="Choose a Snake move"):
        agent.command("act", {"fingerprint": "old"})
    assert agent.state["decision"] is None
    agent.browser.call.assert_not_called()


def test_demo_dispatches_snake_to_specialized_agent(monkeypatch):
    monkeypatch.setenv("AI_GATEWAY_API_KEY", "test")
    monkeypatch.setattr(demo, "AGENT", None)
    instance = Mock()
    instance.snapshot.return_value = {"status": "ready", "scenario": "snake"}
    factory = Mock(return_value=instance)
    monkeypatch.setattr(demo, "SnakeAgent", factory)
    assert demo.command("reset", {"scenario": "snake", "goal": snake.GOAL})["scenario"] == "snake"
    factory.assert_called_once_with(snake.GOAL)
