const port = process.env.PORT || '3013';
try {
  const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
    signal: AbortSignal.timeout(4000),
    cache: 'no-store',
  });
  if (!response.ok) process.exitCode = 1;
} catch {
  process.exitCode = 1;
}
