"""String tripwires for reskinned candidates; they never prove a structural difference."""

from difflib import SequenceMatcher
import re

THRESHOLD = 0.86


def _normalized(text: str, masked: bool) -> str:
    text = re.sub(r"\[\s*[234]\s*점\s*\]", "", text)
    text = re.sub(r"\\(?:left|right|displaystyle|,|;|!)", "", text)
    text = text.replace("\\dfrac", "\\frac")
    text = re.sub(r"\s+", "", text).lower()
    if masked:
        text = re.sub(r"\d+(?:\.\d+)?", "#", text)
    return text


def similarity(left: str, right: str) -> float:
    """The larger of the plain ratio and the ratio with every number masked."""
    if not isinstance(left, str) or not isinstance(right, str):
        raise TypeError("similarity compares two strings")
    return round(max(SequenceMatcher(None, _normalized(left, masked), _normalized(right, masked),
                                     autojunk=False).ratio() for masked in (False, True)), 4)
