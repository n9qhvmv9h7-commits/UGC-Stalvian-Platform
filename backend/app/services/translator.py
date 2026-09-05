"""Localize panel content into the creator's language.

The stories themselves always come from the Marketing Panel (English).
Translation is a presentation step done here with Claude Haiku and cached on
the Story row, so each (story, language) pair is translated exactly once.
"""
import json
import logging

import anthropic

from app.config import settings

logger = logging.getLogger(__name__)

LANGUAGE_NAMES = {
    "en": "English",
    "es": "Spanish",
    "fr": "French",
    "de": "German",
    "it": "Italian",
    "pt": "Portuguese",
    "nl": "Dutch",
    "pl": "Polish",
}

SUPPORTED_LANGUAGES = list(LANGUAGE_NAMES.keys())

_TRANSLATABLE_KEYS = (
    "title", "hook", "script_body", "scenes", "alternative_hooks",
    "call_to_action", "caption", "headline", "company_description", "summary",
)


def _client() -> anthropic.Anthropic:
    return anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)


def translate_payload(payload: dict, language: str) -> dict | None:
    """Translate the human-readable fields of a story payload.

    Sync (call via executor). Returns None when translation is unavailable or
    fails — callers must NOT cache in that case, so a broken run doesn't lock
    English in as the "translation" forever.
    """
    if language == "en":
        return payload
    if not settings.ANTHROPIC_API_KEY:
        return None

    source = {k: payload[k] for k in _TRANSLATABLE_KEYS if payload.get(k)}
    if not source:
        return payload

    target = LANGUAGE_NAMES.get(language, language)
    prompt = (
        f"Translate the JSON values below into {target} for a social-media video script. "
        "Keep the same JSON structure and keys exactly. Keep tone punchy and natural for "
        "short-form video in that language. Do NOT translate: ticker symbols, people's names, "
        "fund names, 'Stalvian', hashtags starting with #, URLs, or numbers. "
        "Reply with ONLY the translated JSON.\n\n"
        + json.dumps(source, ensure_ascii=False)
    )
    try:
        resp = _client().messages.create(
            model=settings.TRANSLATION_MODEL,
            max_tokens=4096,
            messages=[{"role": "user", "content": prompt}],
        )
        text = resp.content[0].text.strip()
        if text.startswith("```"):
            text = text.split("```")[1].lstrip("json\n")
        translated = json.loads(text)
    except Exception as exc:  # translation must never break content delivery
        logger.warning("Translation to %s failed: %s", language, exc)
        return None

    merged = dict(payload)
    for key, value in translated.items():
        if key in _TRANSLATABLE_KEYS:
            merged[key] = value
    return merged
