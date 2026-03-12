// api/warmup.js — Vercel serverless function
// Called by Vercel cron every 10 minutes to keep Render API warm
export default async function handler(req, res) {
  const RENDER_URL = 'https://metrocrowd.onrender.com';

  try {
    const start = Date.now();
    const r = await fetch(`${RENDER_URL}/health`, {
      method: 'GET',
      headers: { 'User-Agent': 'MetroCrowd-WarmupCron/1.0' },
      signal: AbortSignal.timeout(8000),
    });
    const ms = Date.now() - start;
    const ok = r.ok;
    console.log(`[warmup] ${ok ? 'OK' : 'FAIL'} ${r.status} in ${ms}ms`);
    res.status(200).json({ ok, status: r.status, ms, ts: new Date().toISOString() });
  } catch (e) {
    console.error(`[warmup] ERROR: ${e.message}`);
    res.status(200).json({ ok: false, error: e.message, ts: new Date().toISOString() });
  }
}
