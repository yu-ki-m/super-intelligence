import { ValidationError } from '../errors';

export const TASK_STATUSES = ['TODO', 'DOING', 'DONE'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export interface TaskInput {
  title: string;
  status: TaskStatus;
  dueDate: string | null;
}

/** パスの :id を正の整数に変換する。 */
export function parseTaskId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw new ValidationError('id', 'id は正の整数で指定してください');
  }
  return id;
}

/** 登録・更新のボディを検証して TaskInput にする（POST・PUT で共通）。 */
export function validateTaskBody(body: unknown): TaskInput {
  const b = (body ?? {}) as Record<string, unknown>;

  if (typeof b.title !== 'string' || b.title.trim() === '') {
    throw new ValidationError('title', 'title は必須です');
  }
  const title = b.title.trim();
  if (title.length > 100) {
    throw new ValidationError('title', 'title は 100 文字以内で指定してください');
  }

  let status: TaskStatus = 'TODO';
  if (b.status !== undefined) {
    if (!TASK_STATUSES.includes(b.status as TaskStatus)) {
      throw new ValidationError('status', 'status は TODO・DOING・DONE のいずれかです');
    }
    status = b.status as TaskStatus;
  }

  let dueDate: string | null = null;
  if (b.dueDate !== undefined && b.dueDate !== null) {
    if (typeof b.dueDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(b.dueDate)) {
      throw new ValidationError('dueDate', 'dueDate は YYYY-MM-DD 形式で指定してください');
    }
    dueDate = b.dueDate;
  }

  return { title, status, dueDate };
}
