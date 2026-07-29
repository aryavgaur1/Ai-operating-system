import { Router } from 'express';
import { runAgentTurn } from '@enterprise-ai-os/agent-core';
import { getStores } from '../ingestion/pipeline';

export const chatRouter = Router();

chatRouter.post('/', async (req, res) => {
  const { message } = req.body ?? {};
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'Request body must include a string `message`.' });
  }

  const user = req.user!;
  const { vectorStore, graphStore } = getStores();

  try {
    const result = await runAgentTurn(message, user.organizationId, vectorStore, graphStore, user.id);
    res.json(result);
  } catch (err) {
    console.error('[chat] agent turn failed:', err);
    res.status(500).json({ error: 'The agent failed to process this message.' });
  }
});
