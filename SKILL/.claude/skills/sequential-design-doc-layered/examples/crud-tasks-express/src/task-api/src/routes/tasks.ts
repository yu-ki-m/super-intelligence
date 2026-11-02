import { Router } from 'express';
import { pool } from '../db';
import { NotFoundError } from '../errors';
import { asyncHandler } from '../middleware/asyncHandler';
import { parseTaskId, validateTaskBody } from '../validation/task';

export const tasksRouter = Router();

const COLUMNS = 'id, title, status, due_date, created_at, updated_at';

interface TaskRow {
  id: number;
  title: string;
  status: string;
  due_date: string | null;
  created_at: Date;
  updated_at: Date;
}

function toResponse(row: TaskRow) {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    dueDate: row.due_date,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

// 取得
tasksRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = parseTaskId(req.params.id);
    const { rows } = await pool.query<TaskRow>(
      `SELECT ${COLUMNS} FROM tasks WHERE id = $1 AND tenant_id = $2`,
      [id, res.locals.tenantId],
    );
    if (rows.length === 0) {
      throw new NotFoundError('task', id);
    }
    res.json(toResponse(rows[0]));
  }),
);

// 登録
tasksRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = validateTaskBody(req.body);
    const { rows } = await pool.query<TaskRow>(
      `INSERT INTO tasks (tenant_id, title, status, due_date)
       VALUES ($1, $2, $3, $4)
       RETURNING ${COLUMNS}`,
      [res.locals.tenantId, input.title, input.status, input.dueDate],
    );
    res.status(201).location(`/api/tasks/${rows[0].id}`).json(toResponse(rows[0]));
  }),
);

// 更新
tasksRouter.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = parseTaskId(req.params.id);
    const input = validateTaskBody(req.body);
    const { rows } = await pool.query<TaskRow>(
      `UPDATE tasks
          SET title = $1, status = $2, due_date = $3, updated_at = now()
        WHERE id = $4 AND tenant_id = $5
        RETURNING ${COLUMNS}`,
      [input.title, input.status, input.dueDate, id, res.locals.tenantId],
    );
    if (rows.length === 0) {
      throw new NotFoundError('task', id);
    }
    res.json(toResponse(rows[0]));
  }),
);

// 削除
tasksRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = parseTaskId(req.params.id);
    const result = await pool.query('DELETE FROM tasks WHERE id = $1 AND tenant_id = $2', [id, res.locals.tenantId]);
    if (result.rowCount === 0) {
      throw new NotFoundError('task', id);
    }
    res.status(204).end();
  }),
);
