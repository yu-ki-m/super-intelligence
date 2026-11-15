"""Shipping instructions."""
from shared.db import transaction


def ship_order(order_id):
    """入金済みの注文だけを出荷する（支払期日が30日後の取引先も、現状は入金後に出荷している）。"""
    with transaction() as conn:
        status = conn.execute(
            "SELECT status FROM orders WHERE id = %s", (order_id,)
        ).fetchone()[0]
        if status != "paid":
            raise ValueError("入金前の注文は出荷できない")
        conn.execute("UPDATE orders SET status = 'shipped' WHERE id = %s", (order_id,))
