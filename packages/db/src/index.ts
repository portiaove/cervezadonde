import postgres from 'postgres';

export type Sql = ReturnType<typeof postgres>;

let sharedClient: Sql | null = null;

export function getSql(connectionString?: string): Sql {
  if (sharedClient) return sharedClient;

  const url = connectionString ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not set');
  }

  sharedClient = postgres(url, {
    max: 10,
    idle_timeout: 30,
    connect_timeout: 10,
    types: {
      // Return PostGIS geometry as text; we project to lng/lat in SQL.
    },
  });
  return sharedClient;
}

export async function closeSql(): Promise<void> {
  if (sharedClient) {
    await sharedClient.end({ timeout: 5 });
    sharedClient = null;
  }
}
