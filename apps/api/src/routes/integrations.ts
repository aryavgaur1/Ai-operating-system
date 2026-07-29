import { Router } from 'express';
import { allTools, getConnector } from '@enterprise-ai-os/connectors';
import { listConnections } from '../auth/oauth';

export const integrationsRouter = Router();

integrationsRouter.get('/', (req, res) => {
  const connections = listConnections(req.user!.organizationId);
  const tools = allTools().map((tool) => {
    const connector = getConnector(tool);
    const connection = connections.find((c) => c.tool === tool);
    return {
      tool,
      status: connection?.status ?? 'not_connected',
      mode: process.env.CONNECTORS_MODE ?? 'mock',
      availableActions: connector.listActions(),
    };
  });
  res.json({ tools });
});
