"""Stock inquiries and replenishment."""
from shared.db import transaction


def available(product_id):
    with transaction() as conn:
        row = conn.execute(
            "SELECT quantity FROM stock WHERE product_id = %s", (product_id,)
        ).fetchone()
        return row[0] if row else 0


def replenish(product_id, quantity):
    with transaction() as conn:
        conn.execute(
            "UPDATE stock SET quantity = quantity + %s WHERE product_id = %s",
            (quantity, product_id),
        )
