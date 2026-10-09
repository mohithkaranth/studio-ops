import "server-only";

export async function checkStripeConnection(): Promise<boolean> {
  const secretKey = process.env.STRIPE_SECRET_KEY?.trim();

  if (!secretKey) return false;

  try {
    const response = await fetch("https://api.stripe.com/v1/balance", {
      method: "GET",
      headers: { Authorization: `Bearer ${secretKey}` },
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) return false;

    const balance: unknown = await response.json();
    return (
      balance !== null &&
      typeof balance === "object" &&
      "object" in balance &&
      balance.object === "balance"
    );
  } catch {
    return false;
  }
}
