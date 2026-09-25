export const DEFAULT_SERVER_PORT = 3000;
export const LOCAL_SERVER_HOSTNAME = '127.0.0.1';
export const PRODUCTION_SERVER_HOSTNAME = '0.0.0.0';

export type ServerEnvironment = Readonly<Record<string, string | undefined>>;

export interface ServerConfig {
  readonly hostname: string;
  readonly port: number;
  readonly production: boolean;
}

export class ServerConfigurationError extends Error {
  constructor() {
    super('La configuration du serveur est invalide.');
    this.name = 'ServerConfigurationError';
  }
}

export function isProductionEnvironment(environment: ServerEnvironment): boolean {
  return environment.NODE_ENV?.trim().toLowerCase() === 'production'
    || environment.RENDER?.trim().toLowerCase() === 'true';
}

function parsePort(rawValue: string | undefined): number {
  const value = rawValue?.trim() ?? '';
  if (value.length === 0) return DEFAULT_SERVER_PORT;
  if (!/^\d+$/u.test(value)) throw new ServerConfigurationError();

  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new ServerConfigurationError();
  }
  return port;
}

export function loadServerConfig(
  environment: ServerEnvironment = process.env,
): ServerConfig {
  const production = isProductionEnvironment(environment);
  return Object.freeze({
    hostname: production ? PRODUCTION_SERVER_HOSTNAME : LOCAL_SERVER_HOSTNAME,
    port: production ? parsePort(environment.PORT) : DEFAULT_SERVER_PORT,
    production,
  });
}
