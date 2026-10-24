from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse


class OrderNotFound(Exception):
    def __init__(self, order_id: int):
        self.order_id = order_id


class RefundNotAllowed(Exception):
    def __init__(self, order_id: int, status: str):
        self.order_id = order_id
        self.status = status


class RefundFailed(Exception):
    def __init__(self, order_id: int):
        self.order_id = order_id


def register_handlers(app: FastAPI) -> None:
    @app.exception_handler(OrderNotFound)
    async def _not_found(_: Request, e: OrderNotFound) -> JSONResponse:
        return JSONResponse(status_code=404, content={"code": "ORDER_NOT_FOUND"})

    @app.exception_handler(RefundNotAllowed)
    async def _not_allowed(_: Request, e: RefundNotAllowed) -> JSONResponse:
        return JSONResponse(status_code=409, content={"code": "REFUND_NOT_ALLOWED", "status": e.status})

    @app.exception_handler(RefundFailed)
    async def _failed(_: Request, e: RefundFailed) -> JSONResponse:
        return JSONResponse(status_code=502, content={"code": "REFUND_FAILED"})
