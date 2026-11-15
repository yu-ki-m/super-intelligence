"""Shared database access. Every module uses the same database and connection settings."""
import contextlib

import psycopg

DSN = "postgresql://shop@db/shop"


@contextlib.contextmanager
def transaction():
    with psycopg.connect(DSN) as conn:
        with conn.transaction():
            yield conn
