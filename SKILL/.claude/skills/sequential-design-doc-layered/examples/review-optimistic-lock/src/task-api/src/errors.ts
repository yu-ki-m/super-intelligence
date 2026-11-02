import { NextFunction, Request, Response } from 'express';

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
  }
}

export class UnauthorizedError extends HttpError {
  constructor(code: string) {
    super(401, code);
  }
}

export class ValidationError extends HttpError {
  constructor(
    public readonly field: string,
    message: string,
  ) {
    super(400, 'VALIDATION_ERROR', message);
  }
}

export class NotFoundError extends HttpError {
  constructor(resource: string, id: number) {
    super(404, 'NOT_FOUND', `${resource} ${id} not found`);
  }
}

export class VersionConflictError extends HttpError {
  constructor() {
    super(409, 'VERSION_CONFLICT', '他の更新と競合しました');
  }
}

/** エラーを JSON の応答に変換する（app.ts で最後に登録）。 */
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ValidationError) {
    res.status(400).json({ code: err.code, field: err.field, message: err.message });
    return;
  }
  if (err instanceof HttpError) {
    res.status(err.status).json({ code: err.code, message: err.message });
    return;
  }
  const pgCode = (err as { code?: string }).code;
  if (pgCode === '23505') {
    res.status(409).json({ code: 'DUPLICATE_TITLE', message: '同じタイトルのタスクが既にあります' });
    return;
  }
  if ((err as { type?: string }).type === 'entity.parse.failed') {
    res.status(400).json({ code: 'INVALID_JSON', message: 'リクエストボディが JSON ではありません' });
    return;
  }
  console.error(err);
  res.status(500).json({ code: 'INTERNAL_ERROR', message: '内部エラーが発生しました' });
}
