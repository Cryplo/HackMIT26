"""Parallel Jev operation/target heads for website-independent action selection."""
from jev_ultrafast.model import validate_choice
from jev_ultrafast.questions import NEXT_ACTION

DESCRIPTIONS = {
    'type': 'TYPE_TEXT: enter or replace a value or search query in a field. The value is supplied by a text helper.',
    'focus': 'FOCUS: only put the cursor in a field, without typing. Use when explicitly asked to focus or dictate.',
    'press_enter': 'PRESS_ENTER: submit an already filled search or form field, or accept its highlighted suggestion.',
    'click': 'CLICK: activate a link, button, tab, menu option, autocomplete suggestion, or checkbox.',
    'select': 'SELECT: choose an option in a native dropdown.',
    'scroll_up': 'Scroll up to find controls or content not currently visible.',
    'scroll_down': 'Scroll down to find controls or content not currently visible.',
    'back': 'Go back to the previous page.',
    'play': 'Start or resume a visible media player.',
    'pause': 'Pause a visible media player.',
}
TERMINAL = {
    'DONE': 'All requested actions are completed. Filling a search field is NOT completion: submit it first.',
    'CLARIFY': 'Essential information is missing or the request has multiple plausible meanings. Ask the user.',
    'WAIT': 'The page or submitted results are still loading. Wait briefly.',
    'UNSUPPORTED': 'No supported operation can make progress on this goal.',
}


def goal_questions(body):
    groups = {}
    for candidate in body.candidates:
        groups.setdefault(candidate.operation, {})[candidate.id] = candidate.model_dump(exclude_none=True)
    rules = NEXT_ACTION.replace('BLOCKED', 'UNSUPPORTED') + (
        ' If a popup covers the needed controls, first CLICK its Close, Dismiss or Minimize control. '
        'FOCUS only positions the cursor when explicitly requested; TYPE enters the actual value. '
        'CLARIFY asks for missing personal details. Do not invent them. A bare fill request does not imply submission.'
    )
    questions = {'operation': {'type': 'choice',
        'criteria': {**{op: DESCRIPTIONS[op] for op in groups}, **TERMINAL},
        'instructions': {'goal': body.transcript, 'rules': rules}}}
    # A small control set can be scored directly, avoiding operation-level ties.
    # Larger pages use the factored operation/target heads to bound competition.
    if len(body.candidates) <= 32:
        questions['action'] = {'type': 'choice',
            'criteria': {**{c.id: c.model_dump(exclude_none=True) for c in body.candidates}, **TERMINAL},
            'instructions': {'goal': body.transcript, 'rules': rules}}
    for operation, candidates in groups.items():
        if len(candidates) > 1:
            questions[operation + '_target'] = {'type': 'choice', 'criteria': candidates,
                'instructions': {'goal': body.transcript, 'operation': DESCRIPTIONS[operation],
                    'rules': rules + ' Select the best offered target IF this operation is chosen. '
                    'A different head chooses the operation. Do not select an already-satisfied field.'}}
    return questions, groups


def margin(answer):
    ranked = sorted(answer['probabilities'].values(), reverse=True)
    return ranked[0] - ranked[1] if len(ranked) > 1 else 1.0


def goal_answer(result, questions, groups):
    operation = validate_choice(result['answers']['operation'], questions['operation']['criteria'])
    if 'action' in questions and 'action' in result['answers']:
        direct = validate_choice(result['answers']['action'], questions['action']['criteria'])
        return {**direct, 'margin': margin(direct)}
    name = operation['choice']
    if name not in groups:
        return {**operation, 'margin': margin(operation)}
    candidates = groups[name]
    if len(candidates) == 1:
        target = {'choice': next(iter(candidates)), 'confidence': 1.0,
                  'probabilities': {next(iter(candidates)): 1.0}}
    else:
        target = validate_choice(result['answers'][name + '_target'], candidates)
    return {**target, 'confidence': min(operation['confidence'], target['confidence']),
            'margin': min(margin(operation), margin(target))}
