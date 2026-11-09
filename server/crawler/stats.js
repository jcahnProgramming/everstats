/** Blizzard request counts per UTC hour (crawler_hours, kept forever). */
export async function countRequests(q, { requests = 0, errors = 0, throttled = 0 }, at = Date.now()) {
  if (!requests && !errors && !throttled) return;
  const hour = new Date(Math.floor(at / 3_600_000) * 3_600_000);
  await q.query(
    `INSERT INTO crawler_hours (hour, requests, errors, throttled) VALUES ($1, $2, $3, $4)
     ON CONFLICT (hour) DO UPDATE SET requests = crawler_hours.requests + EXCLUDED.requests,
       errors = crawler_hours.errors + EXCLUDED.errors, throttled = crawler_hours.throttled + EXCLUDED.throttled`,
    [hour, requests, errors, throttled],
  );
}
