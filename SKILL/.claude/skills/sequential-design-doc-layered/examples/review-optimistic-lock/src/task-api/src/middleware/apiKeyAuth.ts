import { createHash } from 'crypto';
import { pool } from '../db';
import { UnauthorizedError } from '../errors';
import { asyncHandler } from './asyncHandler';

/** X-API-Key ヘッダーのキーで API クライアントを認証し、テナント ID を res.locals に設定する。 */
export const apiKeyAuth = asyncHandler(async (req, res, next) => {
  const apiKey = req.header('X-API-Key');
  if (!apiKey) {
    throw new UnauthorizedError('API_KEY_REQUIRED');
  }
  const keyHash = createHash('sha256').update(apiKey).digest('hex');
  const { rows } = await pool.query<{ id: number; tenant_id: number }>(
    `SELECT id, tenant_id
       FROM api_clients
      WHERE key_hash = $1
        AND revoked_at IS NULL`,
    [keyHash],
  );
  if (rows.length === 0) {
    throw new UnauthorizedError('API_KEY_INVALID');
  }
  res.locals.clientId = rows[0].id;
  res.locals.tenantId = rows[0].tenant_id;
  next();
});
