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
    # X threads: a list of {text, order}; only `text` is prose.
    "tweets",
)

# X's own limit. The prompt asks for it; the check below is what enforces it,
# because a translation that runs long would be posted anyway and cut off.
TWEET_MAX_CHARS = 280


def _valid_tweets(translated, source) -> bool:
    """A translated thread has to keep its shape and stay postable: same
    number of tweets, every one a non-empty string within the limit.
    Anything else and the English thread is served instead — a creator can
    post that; they cannot post a tweet with half its text missing."""
    if not isinstance(translated, list) or len(translated) != len(source):
        return False
    return all(
        isinstance(t, dict)
        and isinstance(t.get("text"), str)
        and t["text"].strip()
        and len(t["text"]) <= TWEET_MAX_CHARS
        for t in translated
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
    is_thread = "tweets" in source
    prompt = (
        f"Translate the JSON values below into {target} for "
        + ("an X (Twitter) thread. " if is_thread else "a social-media video script. ")
        + "Keep the same JSON structure and keys exactly. Keep tone punchy and natural for "
        + ("posts in that language. In `tweets`, translate each `text` and keep `order` "
           f"unchanged; every translated text MUST stay under {TWEET_MAX_CHARS} characters "
           "(shorten if needed), and keep cashtags like $NVDA exactly. "
           if is_thread else "short-form video in that language. ")
        + "Do NOT translate: ticker symbols, people's names, "
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
        if key not in _TRANSLATABLE_KEYS:
            continue
        if key == "tweets" and not _valid_tweets(value, source["tweets"]):
            logger.warning("Translation to %s returned an unusable thread; serving English", language)
            continue
        merged[key] = value
    return merged
