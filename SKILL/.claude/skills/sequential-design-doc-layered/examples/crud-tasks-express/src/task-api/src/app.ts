import express from 'express';
import { errorHandler } from './errors';
import { apiKeyAuth } from './middleware/apiKeyAuth';
import { tasksRouter } from './routes/tasks';

export const app = express();

app.use(express.json({ limit: '100kb' }));
app.use('/api', apiKeyAuth);
app.use('/api/tasks', tasksRouter);
app.use(errorHandler);

const port = Number(process.env.PORT ?? 3000);
if (require.main === module) {
  app.listen(port, () => console.log(`listening on ${port}`));
}
