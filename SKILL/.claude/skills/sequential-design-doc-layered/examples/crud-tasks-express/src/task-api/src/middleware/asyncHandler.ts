import { NextFunction, Request, RequestHandler, Response } from 'express';

/** async のハンドラーで発生した例外を next() に渡す（Express 4 は Promise の reject を捕捉しないため）。 */
export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };
