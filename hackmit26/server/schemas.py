from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

Short = Annotated[str, Field(min_length=1, max_length=200)]
Operation = Literal[
    'type', 'press_enter', 'click', 'focus', 'select', 'scroll_up', 'scroll_down', 'back', 'play', 'pause'
]


class Strict(BaseModel):
    model_config = ConfigDict(extra='forbid')


class Candidate(Strict):
    id: Short
    operation: Operation
    label: Annotated[str, Field(max_length=300)]
    target: Short | None = None
    option: Annotated[str, Field(max_length=300)] | None = None
    focused: bool = False
    required: bool = False
    current_value: Annotated[str, Field(max_length=2000)] | None = None


class Context(Strict):
    sessionId: Short
    turnId: Short
    generation: Annotated[int, Field(ge=0)]
    tabId: Annotated[int, Field(ge=0)]
    documentId: Short
    snapshotVersion: Annotated[int, Field(ge=0)]


class GoalStep(Strict):
    url: Annotated[str, Field(max_length=3000)] = ''
    operation: Annotated[str, Field(max_length=30)]
    label: Annotated[str, Field(max_length=300)] = ''
    text: Annotated[str, Field(max_length=2000)] | None = None
    verified: bool = False


class DecisionRequest(Strict):
    url: Annotated[str, Field(max_length=3000)] = ''
    context: Context
    transcript: Annotated[str, Field(min_length=1, max_length=2000)]
    title: Annotated[str, Field(max_length=300)] = ''
    mode: Literal['command', 'goal'] = 'command'
    page_text: Annotated[str, Field(max_length=6000)] = ''
    history: Annotated[list[GoalStep], Field(max_length=20)] = Field(default_factory=list)
    candidates: Annotated[list[Candidate], Field(max_length=198)]

    @model_validator(mode='after')
    def unique(self):
        ids = [c.id for c in self.candidates]
        if len(set(ids)) != len(ids) or {'CLARIFY', 'UNSUPPORTED', 'DONE', 'WAIT'} & set(ids):
            raise ValueError('Candidate IDs must be unique and nonreserved')
        if self.mode == 'goal' and len(ids) > 196:
            raise ValueError('At most 196 goal candidates')
        return self


class PairRequest(Strict):
    code: Annotated[str, Field(min_length=1, max_length=200)]
