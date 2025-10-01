"""Shader variant catalog served to the front end."""

from __future__ import annotations

from typing import List, TypedDict


class ShaderVariant(TypedDict):
    id: str
    name: str
    description: str
    default_strength: float


SHADER_VARIANTS: List[ShaderVariant] = [
    {
        "id": "classic",
        "name": "Classic Gradient",
        "description": "Baseline renderer that blends the base fill with the configured gradient.",
        "default_strength": 0.0,
    },
    {
        "id": "lumina",
        "name": "Lumina Bloom",
        "description": "Adds a soft, center-weighted bloom that enhances luminous gradients and pastel palettes.",
        "default_strength": 0.55,
    },
    {
        "id": "nocturne",
        "name": "Nocturne Veil",
        "description": "Cools midtones and lifts highlights for moody, night-inspired backgrounds.",
        "default_strength": 0.65,
    },
    {
        "id": "ember",
        "name": "Ember Drift",
        "description": "Warms the outer edge with ember-like glow for dramatic contrast.",
        "default_strength": 0.5,
    },
]
