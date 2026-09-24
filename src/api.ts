export async function checkHealth(): Promise<void> {
  const response = await fetch('/api/health', { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const body: unknown = await response.json();
  if (typeof body !== 'object' || body === null || !('status' in body) || body.status !== 'ok') {
    throw new Error('Réponse de santé invalide');
  }
}
