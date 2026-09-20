"""What a creator needs to post an X thread the way the panel shows it.

The panel composes thread TEXT server-side and forwards it, but everything
that makes its tweet previews look the way they do — the category, the three
relevant stocks, the smart-money buyers, the price chart with the "bought
here" marker — stays in `chart_data`, and its React panels rebuild the media
cards from that in the browser. This module does the same read here, so the
thread a creator sees is the thread the panel team reviewed: same tweets,
same cards, same order.

Two things this module owns that the panel's forwarding layer does not do:

- The macro thread. The panel's server-side composer only ever emits ONE
  tweet for a macro post, while its own UI renders three (headline + what
  happened, the three stocks with a logo card, the smart money with a faces
  card). Until the panel composes all three, they are composed here — a port
  of macroTweet1/2/3 in breaking-news-tweet-panel.tsx — and replaced the
  moment the panel starts sending three of its own.
- The media plan. Each tweet carries which card goes under it, so the app
  renders a thread without knowing anything about post types.

Everything is derived from the panel item on sync and stored in the payload,
so the feed never recomputes it and a later change here reaches every stored
thread on the next reconcile sweep (which re-upserts thread feeds).
"""
from __future__ import annotations

import re
from typing import Any

# The four Breaking News subtabs are four trade_types. `chart_data.category`
# carries the same thing, but the type is the source of truth in the panel.
_BREAKING_CATEGORY = {
    "breaking_news_post": "macro",
    "breaking_news_stock_post": "stock",
    "fda_approval_post": "fda",
    "gov_contract_post": "gov",
}

# The other X tabs, one category each (Album Trades has two covers).
_OTHER_CATEGORY = {
    "trending_story": "trending",
    "album_trades_post": "caught",
    "album_mover_post": "movers",
    "big_buy_alert": "big_buy",
    "hedge_fund_alert": "hedge_fund",
    "insider_pick_post": "insider_pick",
    "stock_news_post": "stock_news",
}

CATEGORY_LABELS = {
    "macro": "Macro",
    "stock": "Stocks",
    "fda": "FDA",
    "gov": "Gov. contracts",
    "trending": "Trending",
    "caught": "Caught the trade",
    "movers": "Movers",
    "big_buy": "Big buy",
    "hedge_fund": "Hedge fund",
    "insider_pick": "Insider pick",
    "stock_news": "Top mover",
}

# Points kept per chart. The panel forwards every 30-minute bar (3.000+ for a
# six-month window); a 598px-wide tweet card cannot show more than this.
CHART_POINTS = 120

_SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

# Abbreviations that must not end a sentence for one_liner(). The panel's
# own oneLiner() cuts at the first period, which turns "U.S. airline with…"
# into "U" — a creator would post that. Same rule otherwise.
_ABBREVIATIONS = ("U.S", "U.K", "E.U", "Inc", "Corp", "Co", "Ltd", "vs", "e.g", "i.e", "Mr", "Ms", "Dr", "Sr", "Jr", "St")


def category_of(item: dict) -> str | None:
    """macro | stock | fda | gov for a breaking post, trending for a trending
    story, None for anything else."""
    trade_type = item.get("trade_type") or ""
    if trade_type in _BREAKING_CATEGORY:
        return _BREAKING_CATEGORY[trade_type]
    if trade_type in _OTHER_CATEGORY:
        return _OTHER_CATEGORY[trade_type]
    chart = item.get("chart_data") or {}
    category = chart.get("category")
    return category if category in CATEGORY_LABELS else None


# ---- Text helpers (ports of the panel's TS, same truncation lengths) --------


def _collapse(text: Any) -> str:
    return re.sub(r"\s+", " ", str(text or "").strip())


def _first_sentence(text: str) -> str:
    """Up to the first sentence-ending period that is not an abbreviation."""
    i = 0
    while i < len(text):
        ch = text[i]
        if ch in "!?":
            return text[: i + 1]
        if ch == ".":
            before = text[:i]
            if not any(before.endswith(abbr) for abbr in _ABBREVIATIONS) and not (
                i + 1 < len(text) and text[i + 1].isalnum()  # "3.5%" / "U.S.A"
            ):
                return text[: i + 1]
        i += 1
    return text


def one_liner(desc: Any) -> str:
    """First sentence, trimmed to 90 chars. Mirrors oneLiner()."""
    t = _collapse(desc)
    if not t:
        return ""
    first = _first_sentence(t).strip().rstrip(".")
    if len(first) > 90:
        first = first[:87].rstrip() + "…"
    return first


def clean_desc(desc: Any) -> str:
    """Mirrors cleanDesc(): whitespace collapsed, no trailing period."""
    return _collapse(desc).rstrip(".")


def breaking_headline(head: Any) -> str:
    h = str(head or "").strip()
    return h if re.match(r"^breaking\b", h, re.IGNORECASE) else f"Breaking: {h}"


def short_company_name(name: Any) -> str:
    """"Eli Lilly & Co. - LLY" -> "Eli Lilly". Mirrors shortCompanyName()."""
    s = str(name or "").strip()
    s = re.sub(r"\s+[-–—]\s+.*$", "", s).strip()
    suffix = re.compile(
        r"[,\s]+(?:inc\.?|incorporated|corp\.?|corporation|co\.?|company|plc|lp|l\.p\.|llc|"
        r"l\.l\.c\.|ltd\.?|limited|holdings?|group|sa|s\.a\.|nv|n\.v\.|ag|se|platforms?|"
        r"technolog(?:y|ies)|communications?|systems?)$",
        re.IGNORECASE,
    )
    prev = None
    while s and s != prev:
        prev = s
        s = suffix.sub("", s).strip()
    s = re.sub(r"[\s,]+(?:&|and)$", "", s, flags=re.IGNORECASE).strip()
    return s or str(name or "").strip()


# ---- Structured reads of chart_data ---------------------------------------


def _http_url(value: Any) -> str | None:
    """Only real URLs are carried; the panel strips its inline base64 and a
    creator's browser could not load a panel-relative path anyway."""
    return value if isinstance(value, str) and value.startswith(("http://", "https://")) else None


def stocks_of(item: dict, limit: int = 5) -> list[dict]:
    chart = item.get("chart_data") or {}
    out = []
    for s in chart.get("stocks") or []:
        if not isinstance(s, dict) or not s.get("ticker"):
            continue
        out.append(
            {
                "ticker": str(s["ticker"]).upper(),
                "company_name": str(s.get("company_name") or "").strip(),
                "short_name": short_company_name(s.get("company_name") or s["ticker"]),
                "description": _collapse(s.get("description")),
                "logo_url": _http_url(s.get("companyImageUrl") or s.get("logo_url")),
            }
        )
        if len(out) >= limit:
            break
    return out


def _transaction_detail(p: dict) -> str:
    parts = []
    date = p.get("entry_date")
    if isinstance(date, str) and len(date) >= 7:
        try:
            year, month = int(date[:4]), int(date[5:7])
            parts.append(f"bought {_SHORT_MONTHS[month - 1]} '{str(year)[2:]}")
        except (ValueError, IndexError):
            pass
    amount = p.get("amount_str")
    if isinstance(amount, str) and amount and "%" not in amount:
        parts.append(amount)
    return ", ".join(parts)


def buyers_of(item: dict, limit: int = 5) -> list[dict]:
    """The smart money already in these names. Handles both shapes the panel
    stores: rich ({name, ticker, return_pct, …}) and thin ({ticker: <name>,
    amount: "+45% in TICKER"}). Mirrors smartMoneyBuyers()."""
    chart = item.get("chart_data") or {}
    out = []
    for p in (chart.get("insider_positions") or [])[:limit]:
        if not isinstance(p, dict):
            continue
        rich = bool(p.get("name"))
        name = _collapse(p.get("name") if rich else p.get("ticker"))
        if not name:
            continue
        pct: float | None = None
        ticker = ""
        detail = ""
        if rich:
            rp = p.get("return_pct")
            pct = float(rp) if isinstance(rp, (int, float)) and not isinstance(rp, bool) else None
            t = str(p.get("ticker") or "")
            ticker = t if re.fullmatch(r"[A-Z]{1,6}", t) else ""
            detail = _transaction_detail(p)
        else:
            amount = str(p.get("amount") or "")
            m = re.search(r"([+-]?\d+(?:\.\d+)?)\s*%", amount)
            pct = float(m.group(1)) if m else None
            m2 = re.search(r"\bin\s+([A-Z]{1,6})\b", amount)
            ticker = m2.group(1) if m2 else ""
        out.append({"name": name, "ticker": ticker, "return_pct": pct, "detail": detail, "photo_url": _http_url(p.get("person_photo_url"))})
    return out


def _downsample(points: list, keep: int) -> tuple[list[float], list[int], list[int | None]]:
    """Every k-th close, always keeping the last. Returns (closes, source
    indexes, timestamps) so an entry index into the original series can be
    remapped and the square card can draw its month ticks."""
    closes: list[tuple[int, float, int | None]] = []
    for i, p in enumerate(points):
        c = p.get("c") if isinstance(p, dict) else p
        t = p.get("t") if isinstance(p, dict) else None
        if isinstance(c, (int, float)) and not isinstance(c, bool):
            closes.append((i, float(c), int(t) if isinstance(t, (int, float)) and not isinstance(t, bool) else None))
    n = len(closes)
    if n <= keep:
        picked = list(range(n))
    else:
        step = (n - 1) / (keep - 1)
        picked = sorted({round(j * step) for j in range(keep)} | {n - 1})
    return [closes[i][1] for i in picked], [closes[i][0] for i in picked], [closes[i][2] for i in picked]


def _remap_index(entry_index: Any, source_indexes: list[int]) -> int | None:
    if not isinstance(entry_index, (int, float)) or isinstance(entry_index, bool) or not source_indexes:
        return None
    target = int(entry_index)
    # nearest kept source index
    best = min(range(len(source_indexes)), key=lambda j: abs(source_indexes[j] - target))
    return best


def _since_buy(end: float, pct: float) -> float:
    """$ move implied by a % return since the buy. Mirrors the panels' entry math."""
    return abs(end - end / (1 + pct / 100)) if pct > -100 else 0.0


def chart_of(item: dict, points: list | None = None) -> dict | None:
    """The price chart under a tweet: breaking posts carry it as
    chart_data.featured_chart, every other type flattens it into chart_data.
    Pass `points` to chart a slice of the series (the movers month view)."""
    chart = item.get("chart_data") or {}
    src = chart.get("featured_chart") if isinstance(chart.get("featured_chart"), dict) else chart
    sliced = points is not None
    points = points if sliced else src.get("points")
    if not isinstance(points, list) or len(points) < 2:
        return None
    closes, kept, times = _downsample(points, CHART_POINTS)
    if len(closes) < 2:
        return None
    if sliced:
        # A slice has its own start/end; never trust the whole-window figures.
        src = {"ticker": src.get("ticker")}
    start = src.get("start_price") if isinstance(src.get("start_price"), (int, float)) else closes[0]
    end = src.get("end_price") if isinstance(src.get("end_price"), (int, float)) else closes[-1]
    pct = src.get("pct_change")
    if not isinstance(pct, (int, float)) or isinstance(pct, bool):
        pct = ((end - start) / start * 100) if start else 0.0
    featured = chart.get("featured_buyer") if isinstance(chart.get("featured_buyer"), dict) else {}
    entry_source = featured.get("entry_index", chart.get("entry_index"))
    change_abs = abs(float(end) - float(start))
    range_label = _range_label(src.get("from_date"), src.get("to_date"))
    # A trending story's card shows the insider's return SINCE THE BUY, not
    # the window's — the same number its tweet quotes.
    insider_pct = chart.get("insider_return_pct", chart.get("return_pct"))
    trade_type = item.get("trade_type")
    if trade_type == "trending_story" and isinstance(insider_pct, (int, float)) and not isinstance(insider_pct, bool) and insider_pct > -100:
        pct = float(insider_pct)
        change_abs = _since_buy(float(end), pct)
        range_label = "since the buy"
    # Album Trades: the box shows the return since the filing, like the tweet.
    if trade_type in ("album_trades_post", "album_mover_post") and not sliced:
        pct = _caught_return_pct(item)
        change_abs = _since_buy(float(end), pct)
        range_label = "since the buy"
    if sliced:
        range_label = "past month"
    if sliced and times and times[0] and times[-1]:
        src = {**src, "from_date": _iso_day(times[0]), "to_date": _iso_day(times[-1])}
    return {
        "ticker": str(src.get("ticker") or item.get("ticker") or "").upper(),
        "price": round(float(end), 2),
        "start_price": round(float(start), 2),
        "change_abs": round(change_abs, 2),
        "change_pct": round(float(pct), 2),
        "range_label": range_label,
        "from_date": src.get("from_date"),
        "to_date": src.get("to_date"),
        "points": [round(c, 4) for c in closes],
        # Epoch ms per point when the panel had them — the square card's
        # month ticks need dates, not just closes.
        "times": times if all(t is not None for t in times) else None,
        "entry_index": None if sliced else _remap_index(entry_source, kept),
    }


def _iso_day(ms: int) -> str:
    from datetime import datetime, timezone

    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).date().isoformat()


def _caught_return_pct(item: dict) -> float:
    """Return since the filing for an Album Trades post. Mirrors
    caughtReturnPct(): chart_data.pct_change_since, else "up X%" in the
    headline, else the chart's own move."""
    chart = item.get("chart_data") or {}
    since = chart.get("pct_change_since")
    if isinstance(since, (int, float)) and not isinstance(since, bool):
        return float(since)
    m = re.search(r"up\s+([\d,.]+)\s*%", chart.get("slide1_headline") or item.get("title") or "", re.IGNORECASE)
    if m:
        try:
            return float(m.group(1).replace(",", ""))
        except ValueError:
            pass
    pct = chart.get("pct_change")
    return float(pct) if isinstance(pct, (int, float)) and not isinstance(pct, bool) else 0.0


def month_chart_of(item: dict) -> dict | None:
    """The last ~31 days of the series — the movers "up this month" view.
    Mirrors toMonthChart()."""
    chart = item.get("chart_data") or {}
    points = chart.get("points")
    if not isinstance(points, list) or len(points) < 2:
        return None
    last = points[-1].get("t") if isinstance(points[-1], dict) else None
    if not isinstance(last, (int, float)):
        return None
    cutoff = last - 31 * 24 * 60 * 60 * 1000
    sliced = [p for p in points if isinstance(p, dict) and isinstance(p.get("t"), (int, float)) and p["t"] >= cutoff]
    return chart_of(item, sliced if len(sliced) > 1 else points)


def holdings_of(item: dict, limit: int = 10) -> list[dict]:
    """Top holdings for the 13F positions table. Mirrors topHoldings()."""
    chart = item.get("chart_data") or {}
    out = []
    for h in (chart.get("top_holdings") or [])[:limit]:
        if not isinstance(h, dict):
            continue
        value = h.get("value")
        shares = h.get("shares")
        cls = h.get("class_type") or h.get("put_call")
        if not cls:
            title = str(h.get("title_of_class") or "").upper()
            cls = "Common" if (not title or title == "COM" or title.startswith("COMMON")) else h.get("title_of_class")
        out.append(
            {
                "issuer": str(h.get("issuer") or h.get("issuer_name") or h.get("ticker") or ""),
                "class_type": str(cls),
                "value": float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else float(value or 0) if str(value or "").replace(".", "", 1).isdigit() else 0.0,
                "shares": float(shares) if isinstance(shares, (int, float)) and not isinstance(shares, bool) else None,
            }
        )
    return out


def _ranked(rows: Any, limit: int = 5) -> list[dict]:
    return [
        {"ticker": str(r["ticker"]).upper(), "amount": str(r.get("amount") or ""), "icon_url": _http_url(r.get("iconUrl"))}
        for r in (rows or [])[:limit]
        if isinstance(r, dict) and r.get("ticker")
    ]


def _source_label(url: Any) -> str:
    """The article's domain for the card footer, else Polygon.io. Mirrors sourceLabel()."""
    if not isinstance(url, str) or not url:
        return "Polygon.io"
    m = re.match(r"^https?://(?:www\.)?([^/]+)", url)
    return m.group(1) if m else "Polygon.io"


def _range_label(from_date: Any, to_date: Any) -> str:
    """"past 3 months" from the chart's own dates. Mirrors the panel's range
    caption, which names the window rather than the dates."""
    try:
        y1, m1 = int(str(from_date)[:4]), int(str(from_date)[5:7])
        y2, m2 = int(str(to_date)[:4]), int(str(to_date)[5:7])
    except (TypeError, ValueError):
        return ""
    months = max((y2 - y1) * 12 + (m2 - m1), 1)
    if months >= 12:
        years = round(months / 12)
        return f"past {years} year{'s' if years > 1 else ''}"
    return f"past {months} months" if months > 1 else "past month"


def featured_buyer_of(item: dict) -> dict | None:
    chart = item.get("chart_data") or {}
    f = chart.get("featured_buyer")
    if not isinstance(f, dict) or not f.get("name"):
        return None
    rp = f.get("return_pct")
    return {
        "name": _collapse(f["name"]),
        "kind": "politician" if f.get("type") == "politician" else "investor",
        "return_pct": float(rp) if isinstance(rp, (int, float)) and not isinstance(rp, bool) else None,
        "entry_date": f.get("entry_date") or f.get("disclosed_date") or f.get("transaction_date"),
        "amount": f.get("amount") or f.get("amount_str"),
        "photo_url": _http_url(f.get("person_photo_url")),
    }


# ---- The macro thread (port of macroTweet1/2/3) ----------------------------


def macro_thread(item: dict) -> list[dict]:
    chart = item.get("chart_data") or {}
    headline = chart.get("slide1_headline") or item.get("title") or ""
    stocks = stocks_of(item, limit=3)
    buyers = buyers_of(item)

    t1 = "\n\n".join(
        p for p in (breaking_headline(headline), clean_desc(chart.get("summary")), "Here are 3 relevant stocks:") if p
    )

    lines = []
    for s in stocks:
        why = one_liner(s["description"])
        lines.append(f"${s['ticker']}: {why}" if why else f"${s['ticker']}")
    t2 = "\n\n".join(
        p for p in ("3 stocks in focus:", "\n".join(lines), 'Here is how some "smart" money has positioned:') if p
    )

    smart = []
    for b in buyers:
        pct = b["return_pct"]
        direction = "" if pct is None else f"{'up' if pct >= 0 else 'down'} {abs(round(pct))}%"
        tkr = f"${b['ticker']}" if b["ticker"] else ""
        line = b["name"]
        if direction and tkr:
            line += f" is {direction} on {tkr}"
        elif direction:
            line += f" is {direction}"
        elif tkr:
            line += f" holds {tkr}"
        if b["detail"]:
            line += f" ({b['detail']})"
        smart.append(f"{line}.")
    intro = "Some of the smart money already in these names:"
    t3 = f"{intro}\n\n" + "\n".join(smart) if smart else intro

    thread = [{"text": t1, "order": 1}, {"text": t2, "order": 2}, {"text": t3, "order": 3}]
    # A human edit in the panel wins, when it still matches the thread shape.
    stored = chart.get("tweet_texts")
    if isinstance(stored, list) and len(stored) == 3:
        thread = [
            {"text": str(s), "order": t["order"]} if isinstance(s, str) and s.strip() else t
            for t, s in zip(thread, stored)
        ]
    return thread


def tweets_of(item: dict, category: str | None) -> list[dict]:
    """The panel's tweets, except a macro post that arrived as one tweet:
    that is the panel's composer falling short of its own UI, so the three
    tweets are composed here instead."""
    tweets = [
        {"text": str(t.get("text")).strip(), "order": t.get("order") or i + 1}
        for i, t in enumerate(item.get("tweets") or [])
        if isinstance(t, dict) and str(t.get("text") or "").strip()
    ]
    if category == "macro" and len(tweets) < 3:
        return macro_thread(item)
    return tweets


# ---- Media plan -----------------------------------------------------------
#
# One entry per tweet, in order. Kinds the app knows how to draw:
#   image       — the creator's own picture (news photo, portrait, …)
#   logos       — the three-company logo card (macro tweet 2)
#   faces       — one column per smart-money buyer (macro tweet 3)
#   chart       — creator photo | company price chart (stock tweet 1)
#   chart_entry — same chart with the "bought here" marker (stock tweet 2,
#                 trending tweet 3)
# `hint` is the upload prompt shown on the picture half.


def media_plan(category: str | None, tweets: list[dict], has_chart: bool, has_buyers: bool, has_featured: bool) -> list[dict]:
    n = len(tweets)
    if n == 0:
        return []
    if category == "macro":
        plan = [
            {"kind": "image", "hint": "Click to upload an image"},
            {"kind": "logos"},
            {"kind": "faces"} if has_buyers else {"kind": "none"},
        ]
    elif category == "trending":
        plan = [
            {"kind": "image", "hint": "Click to upload a trend image"},
            {"kind": "image", "hint": "Click to upload a photo of the business"},
            {"kind": "chart_entry" if has_chart else "image", "hint": "Click to upload a portrait"},
        ]
    elif category == "caught":
        plan = [{"kind": "chart_entry" if has_chart else "image", "hint": "Click to upload portrait"}]
    elif category == "movers":
        plan = [
            {"kind": "chart_month" if has_chart else "image", "hint": "Click to upload company logo"},
            {"kind": "chart_entry" if has_chart else "image", "hint": "Click to upload portrait"},
        ]
    elif category == "big_buy":
        plan = [
            {"kind": "dual_image", "hint": "Click to upload left image"},
            {"kind": "chart_wide" if has_chart else "image", "hint": "Click to upload an image"},
        ]
    elif category == "hedge_fund":
        plan = [{"kind": "holdings", "hint": "Click to upload fund / manager photo"}] + [
            {"kind": "list_buys"} if i == 1 else {"kind": "list_sells"} for i in range(1, n)
        ]
    elif category == "insider_pick":
        plan = [{"kind": "square_chart" if has_chart else "image", "hint": "Click to upload a person photo"}]
    elif category == "stock_news":
        plan = [{"kind": "square_plain" if has_chart else "image", "hint": "Click to upload an image"}]
    else:  # stock | fda | gov — one company
        plan = [
            {"kind": "chart" if has_chart else "image", "hint": "Click to upload a company picture"},
            {"kind": "chart_entry" if has_chart and has_featured else "image", "hint": "Click to upload an investor picture"},
        ]
    plan = plan[:n] + [{"kind": "image", "hint": "Click to upload an image"}] * max(n - len(plan), 0)
    return plan


def _hedge_fund_plan(item: dict, n: int) -> list[dict]:
    """Tweet 1 is the table; the list tweets follow whichever lists the
    filing has, in the order the panel emits them (buys, then sells)."""
    chart = item.get("chart_data") or {}
    plan = [{"kind": "holdings", "hint": "Click to upload fund / manager photo"}]
    if chart.get("top_buys"):
        plan.append({"kind": "list_buys"})
    if chart.get("top_sells"):
        plan.append({"kind": "list_sells"})
    return plan[:n]


def thread_payload(item: dict) -> dict:
    """The stored payload for an X thread. `tweets` is the whole point; the
    rest is what the app needs to draw the panel's cards and what a creator
    needs to judge and cite the thread. Panel base64 imagery is never carried."""
    category = category_of(item)
    chart = item.get("chart_data") or {}
    tweets = tweets_of(item, category)
    stocks = stocks_of(item)
    buyers = buyers_of(item)
    price_chart = chart_of(item)
    featured = featured_buyer_of(item)
    # Trending headlines are line-broken for the Instagram carousel; a title
    # on a card is one line.
    title = " ".join(str(item.get("title") or chart.get("slide1_headline") or "").split())
    media = (
        _hedge_fund_plan(item, len(tweets)) if category == "hedge_fund"
        else media_plan(category, tweets, price_chart is not None, bool(buyers), featured is not None)
    )
    insider_pct = chart.get("insider_return_pct")
    entry_source = chart.get("entry_index")
    return {
        "title": title,
        "category": category,
        "category_label": CATEGORY_LABELS.get(category or "", None),
        "tweets": tweets,
        "media": media,
        "ticker": (item.get("ticker") or chart.get("ticker") or "").split(",")[0].strip().upper(),
        "company_name": (
            stocks[0]["short_name"] if stocks and category != "macro"
            else short_company_name(chart.get("slide3_company_name") or chart.get("company_name") or "")
        ),
        "headline": " ".join(str(chart.get("slide1_headline") or item.get("title") or "").split()),
        "person_label": chart.get("person_label") or "",
        "amount_str": chart.get("amount_str") or "",
        "filer_name": chart.get("filer_name") or "",
        "stocks": stocks,
        "buyers": buyers,
        "featured_buyer": featured,
        "chart": price_chart,
        "chart_month": month_chart_of(item) if category == "movers" else None,
        "holdings": holdings_of(item) if category == "hedge_fund" else [],
        "top_buys": _ranked(chart.get("top_buys")) if category == "hedge_fund" else [],
        "top_sells": _ranked(chart.get("top_sells")) if category == "hedge_fund" else [],
        "insider_return_pct": float(insider_pct) if isinstance(insider_pct, (int, float)) and not isinstance(insider_pct, bool) else None,
        "source_label": _source_label((item.get("sources") or [None])[0]) if category == "stock_news" else None,
        "hashtags": item.get("hashtags") or [],
        "virality_score": item.get("virality_score"),
        "sources": item.get("sources") or [],
    }
