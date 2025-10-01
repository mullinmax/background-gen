"""In-memory telemetry collection with basic rate limiting."""
from __future__ import annotations

import time
from collections import deque
from typing import Deque, Dict, Iterable, Tuple

from pydantic import BaseModel, Field


class TelemetryEvent(BaseModel):
    """Schema for telemetry submissions."""

    timestamp: float = Field(default_factory=lambda: time.time())
    category: str = Field(..., max_length=64)
    payload: dict = Field(default_factory=dict)


class TelemetryStore:
    """A bounded in-memory telemetry queue with naive IP-based rate limiting."""

    def __init__(self, max_events: int, rate_limit_seconds: float) -> None:
        self._max_events = max_events
        self._rate_limit_seconds = rate_limit_seconds
        self._events: Deque[TelemetryEvent] = deque(maxlen=max_events)
        self._last_event_by_ip: Dict[str, float] = {}

    def record(self, event: TelemetryEvent, client_ip: str) -> bool:
        """Store an event if it passes the rate limit.

        Returns ``True`` when the event is accepted, ``False`` otherwise.
        """

        now = time.time()
        last = self._last_event_by_ip.get(client_ip)
        if last is not None and (now - last) < self._rate_limit_seconds:
            return False
        self._last_event_by_ip[client_ip] = now
        self._events.append(event)
        return True

    def snapshot(self) -> Iterable[TelemetryEvent]:
        """Return a copy of stored events for inspection/testing."""

        return tuple(self._events)


__all__ = ["TelemetryEvent", "TelemetryStore"]
