process.env.PORT ??= '3013';
process.env.HOSTNAME ??= '0.0.0.0';

await import('../.next/standalone/server.js');
