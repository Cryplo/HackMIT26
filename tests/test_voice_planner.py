import pytest

from hackmit26.server.planner import goal_answer, goal_questions
from hackmit26.server.schemas import DecisionRequest


def request():
    return DecisionRequest.model_validate({
        'context': {'sessionId': 's', 'turnId': 't', 'generation': 1, 'tabId': 1,
                    'documentId': 'd', 'snapshotVersion': 1},
        'transcript': 'Search for cats', 'mode': 'goal',
        'candidates': [
            {'id': 'name', 'operation': 'type', 'label': 'Name'},
            {'id': 'query', 'operation': 'type', 'label': 'Search'},
            {'id': 'submit', 'operation': 'click', 'label': 'Search'},
        ]})


def answer(choice, ids):
    return {'choice': choice, 'confidence': 1, 'probabilities': {k: int(k == choice) for k in ids}}


def test_operation_selects_only_its_own_valid_target():
    questions, groups = goal_questions(request())
    result = {'answers': {
        'operation': answer('type', questions['operation']['criteria']),
        'type_target': answer('query', groups['type']),
    }}
    assert goal_answer(result, questions, groups)['choice'] == 'query'
    result['answers']['type_target'] = answer('submit', groups['click'])
    with pytest.raises(ValueError):
        goal_answer(result, questions, groups)


def test_low_operation_margin_is_preserved_even_for_a_certain_target():
    questions, groups = goal_questions(request())
    op = answer('type', questions['operation']['criteria'])
    op.update(confidence=.55, probabilities={k: .55 if k == 'type' else .45 if k == 'click' else 0
                                           for k in op['probabilities']})
    result = goal_answer({'answers': {'operation': op, 'type_target': answer('query', groups['type'])}},
                         questions, groups)
    assert result['choice'] == 'query'
    assert result['confidence'] == .55
    assert result['margin'] == pytest.approx(.1)


def test_terminal_choice_does_not_require_or_execute_an_unused_target():
    questions, groups = goal_questions(request())
    result = {'answers': {'operation': answer('DONE', questions['operation']['criteria']),
                          'type_target': {'choice': 'invented'}}}
    assert goal_answer(result, questions, groups)['choice'] == 'DONE'


def test_small_page_direct_head_still_accepts_only_observed_choices():
    questions, groups = goal_questions(request())
    result = {'answers': {'operation': answer('click', questions['operation']['criteria']),
                          'action': answer('query', questions['action']['criteria'])}}
    assert goal_answer(result, questions, groups)['choice'] == 'query'
    result['answers']['action'] = answer('invented', ['invented'])
    with pytest.raises(ValueError):
        goal_answer(result, questions, groups)
