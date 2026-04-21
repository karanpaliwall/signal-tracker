import os
import time
import threading
import psycopg2
import psycopg2.pool
import psycopg2.extras
from contextlib import contextmanager
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / ".env")

# Register UUID adapter so psycopg2 returns UUID columns as uuid.UUID objects
psycopg2.extras.register_uuid()

_pool: psycopg2.pool.ThreadedConnectionPool | None = None
_pool_lock = threading.Lock()

# How long to wait for a free pool slot before giving up (seconds)
_POOL_WAIT_TIMEOUT = 30
_POOL_RETRY_INTERVAL = 0.1  # 100 ms between attempts

# Track the last time each pooled connection was confirmed alive.
# We only ping (SELECT 1) if the connection has been idle longer than
# _PING_THRESHOLD seconds — Neon's PgBouncer drops idle sessions at ~5 min.
# Brand-new connections and recently-used ones skip the ping entirely,
# saving 200–300 ms of round-trip latency per API call on a warm server.
#
# NOTE: Protected by _conn_last_used_lock — multiple worker threads access this dict.
_conn_last_used: dict[int, float] = {}   # id(conn) → monotonic timestamp
_conn_last_used_lock = threading.Lock()
_PING_THRESHOLD = 270        # 4.5 min — ping before Neon's 5-min idle timeout

# Neon and other cloud Postgres instances drop idle connections after ~5 min.
# TCP keepalives prevent that by sending heartbeat packets on idle connections.
_KEEPALIVE_KWARGS = {
    "keepalives": 1,
    "keepalives_idle": 30,     # send first keepalive after 30 s of idle
    "keepalives_interval": 5,  # retry every 5 s
    "keepalives_count": 3,     # give up after 3 failures
}


def _get_pool() -> psycopg2.pool.ThreadedConnectionPool:
    global _pool
    if _pool is None:
        with _pool_lock:
            if _pool is None:
                _pool = psycopg2.pool.ThreadedConnectionPool(
                    minconn=2,
                    maxconn=20,
                    dsn=os.environ["DATABASE_URL"],
                    **_KEEPALIVE_KWARGS,
                )
    return _pool


def _acquire_conn(pool: psycopg2.pool.ThreadedConnectionPool):
    """Acquire a connection from the pool, waiting up to _POOL_WAIT_TIMEOUT seconds."""
    deadline = time.monotonic() + _POOL_WAIT_TIMEOUT
    while True:
        try:
            return pool.getconn()
        except psycopg2.pool.PoolError:
            if time.monotonic() >= deadline:
                raise
            time.sleep(_POOL_RETRY_INTERVAL)


def _discard(pool: psycopg2.pool.ThreadedConnectionPool, conn):
    """Return a broken connection to the pool with close=True so it is discarded."""
    with _conn_last_used_lock:
        _conn_last_used.pop(id(conn), None)
    try:
        pool.putconn(conn, close=True)
    except Exception as exc:
        import logging
        logging.getLogger(__name__).warning("_discard: failed to return conn to pool: %s", exc)


@contextmanager
def get_cursor():
    """
    Yields a RealDictCursor bound to a pooled connection.
    Commits on clean exit, rolls back on exception, always returns the
    connection to the pool.

    Handles two Neon-specific failure modes transparently:
    - Pool exhausted: retries for up to _POOL_WAIT_TIMEOUT seconds.
    - Stale/dropped connection: discards the dead connection and retries
      once with a fresh one (Neon drops idle connections after ~5 min).

    Usage:
        with get_cursor() as cur:
            cur.execute("SELECT * FROM job_signals WHERE id = %s", (id,))
            row = cur.fetchone()          # returns dict | None
            rows = cur.fetchall()         # returns list[dict]
    """
    pool = _get_pool()
    conn = _acquire_conn(pool)

    # Hard-closed connections are always replaced immediately.
    if conn.closed:
        _discard(pool, conn)
        conn = _acquire_conn(pool)
    else:
        conn_key = id(conn)
        with _conn_last_used_lock:
            last_used = _conn_last_used.get(conn_key)
        # Only ping if the connection has been sitting idle long enough that
        # Neon's PgBouncer might have dropped it (>4.5 min).
        # Brand-new connections (not in dict) and recently-used ones are
        # assumed healthy — no ping, no extra round-trip.
        if last_used is not None and (time.monotonic() - last_used) > _PING_THRESHOLD:
            try:
                with conn.cursor() as _ping:
                    _ping.execute("SELECT 1")
            except (psycopg2.OperationalError, psycopg2.InterfaceError):
                _discard(pool, conn)
                with _conn_last_used_lock:
                    _conn_last_used.pop(conn_key, None)
                conn = _acquire_conn(pool)

    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            yield cur
        conn.commit()
        with _conn_last_used_lock:
            _conn_last_used[id(conn)] = time.monotonic()  # mark as recently alive
    except (psycopg2.OperationalError, psycopg2.InterfaceError):
        # SSL dropped mid-query — discard this connection so the pool won't
        # try to reuse it, then re-raise so FastAPI returns a clean 500.
        with _conn_last_used_lock:
            _conn_last_used.pop(id(conn), None)
        _discard(pool, conn)
        conn = None
        raise
    except Exception:
        try:
            conn.rollback()
        except Exception:
            pass  # connection may be broken; rollback is best-effort, don't shadow original
        raise
    finally:
        if conn is not None:
            try:
                pool.putconn(conn)
            except Exception:
                pass
