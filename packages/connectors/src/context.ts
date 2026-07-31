import { AsyncLocalStorage } from 'async_hooks';

export interface ConnectorContext {
  organizationId?: string;
  userId?: string;
}

export const connectorContext = new AsyncLocalStorage<ConnectorContext>();

export function runWithConnectorContext<T>(ctx: ConnectorContext, fn: () => T): T {
  return connectorContext.run(ctx, fn);
}

export function getConnectorContext(): ConnectorContext {
  return connectorContext.getStore() ?? {};
}
