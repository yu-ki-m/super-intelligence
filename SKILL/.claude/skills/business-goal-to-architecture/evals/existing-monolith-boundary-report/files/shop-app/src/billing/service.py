"""Invoice and payment handling."""
from shared.db import transaction


def record_payment(invoice_id, amount, received_at):
    """入金を記録し、全額入金なら請求書と注文の状態を更新する。"""
    with transaction() as conn:
        conn.execute(
            "INSERT INTO payments (invoice_id, amount, received_at) VALUES (%s, %s, %s)",
            (invoice_id, amount, received_at),
        )
        invoice_amount, paid, order_id = conn.execute(
            "SELECT i.amount, COALESCE(SUM(p.amount), 0), i.order_id"
            " FROM invoices i LEFT JOIN payments p ON p.invoice_id = i.id"
            " WHERE i.id = %s GROUP BY i.id",
            (invoice_id,),
        ).fetchone()
        if paid >= invoice_amount:
            conn.execute("UPDATE invoices SET status = 'paid' WHERE id = %s", (invoice_id,))
            # 注文の状態も請求側から直接更新している（出荷の判断に使われる）
            conn.execute("UPDATE orders SET status = 'paid' WHERE id = %s", (order_id,))


def monthly_closing(month_start, month_end):
    """月末の請求締め。期日を過ぎた未入金の請求書を延滞にし、請求先ごとに集計する。"""
    with transaction() as conn:
        conn.execute(
            "UPDATE invoices SET status = 'overdue'"
            " WHERE status = 'issued' AND due_date < %s",
            (month_end,),
        )
        return conn.execute(
            "SELECT c.billing_name, SUM(i.amount)"
            " FROM invoices i JOIN customers c ON c.id = i.customer_id"
            " JOIN orders o ON o.id = i.order_id"
            " WHERE o.placed_at BETWEEN %s AND %s GROUP BY c.billing_name",
            (month_start, month_end),
        ).fetchall()
