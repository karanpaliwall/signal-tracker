from collections import deque
from datetime import datetime, timezone
import threading

_buffer: deque[dict[str, str]] = deque(maxlen=600)
_lock = threading.Lock()
_write_pos: int = 0  # monotonic absolute counter — never decrements

# Stop flags — checked by pipeline, intelligence, and scheduler loops to cancel mid-run
_stop_flags: dict[str, bool] = {"live": False, "weekly": False, "intelligence": False}


def log(source: str, msg: str, level: str = "info") -> None:
    global _write_pos
    entry = {
        "ts": datetime.now(timezone.utc).strftime("%H:%M:%S"),
        "source": source,
        "msg": msg,
        "level": level,
    }
    with _lock:
        _buffer.append(entry)
        _write_pos += 1


def get_lines(since: int = 0) -> tuple[list[dict], int]:
    """
    Return log lines starting from absolute position `since`.
    `total` is the absolute write position — always increasing, never capped at 600.
    This prevents the frontend cursor from freezing when the buffer wraps.
    """
    with _lock:
        items = list(_buffer)
        pos = _write_pos

    # items[0] is at absolute position (pos - len(items))
    start_abs = pos - len(items)
    rel_since = max(0, since - start_abs)
    return items[rel_since:], pos


def request_stop(job: str) -> None:
    with _lock:
        _stop_flags[job] = True


def should_stop(job: str) -> bool:
    with _lock:
        return _stop_flags.get(job, False)


def clear_stop(job: str) -> None:
    with _lock:
        _stop_flags[job] = False
