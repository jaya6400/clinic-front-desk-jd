"""The single contract endpoint used by the take-home evaluation runner."""

from datetime import date

from fastapi import FastAPI
from pydantic import BaseModel, ConfigDict, Field, field_validator

from .agent import run_conversation


class RunRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    conversation_id: str = Field(min_length=1)
    today: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    turns: list[str]

    @field_validator("today")
    @classmethod
    def validate_calendar_date(cls, value: str) -> str:
        try:
            parsed = date.fromisoformat(value)
        except ValueError as error:
            raise ValueError("today must be a real YYYY-MM-DD date") from error
        if parsed.isoformat() != value:
            raise ValueError("today must use YYYY-MM-DD format")
        return value


app = FastAPI(title="Clinic Front Desk Agent", docs_url=None, redoc_url=None, openapi_url=None)


@app.post("/agent/run")
def agent_run(request: RunRequest) -> dict:
    """Run one isolated conversation against a freshly loaded clinic state."""
    return run_conversation(request.conversation_id, request.today, request.turns)