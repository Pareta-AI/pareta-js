/**
 * Money helpers — port of `_dollars_floored_to_cents` (Python `_models.py` §6).
 *
 * JS has no Decimal, so the billed `run.cost` is surfaced as a formatted
 * fixed-2dp dollar STRING ("1.23", "0.00") computed in integer cents, plus the
 * raw `run.costMicroUsd` integer. We FLOOR to whole cents (never round up) so
 * the SDK never overstates a charge — a 5 µUSD run reads "0.00". Flooring is
 * done in integer (BigInt) math, never float dollars, to avoid fp drift.
 *
 * Only `run.cost` floors. Sub-cent unit rates (EvalResult.meanCostMicroUsd)
 * stay raw integers — flooring them to "$0.00" would erase the
 * open-vs-frontier savings comparison.
 */

const MICRO_PER_CENT = 10_000n;

/**
 * Floor micro-USD to whole cents and format as a fixed-2dp dollar string.
 * `dollarsFlooredToCents(5)` → "0.00"; `(1_234_500)` → "1.23"; `(20_000)` → "0.02".
 */
export function dollarsFlooredToCents(microUsd: number | bigint | null | undefined): string {
  const micro = typeof microUsd === "bigint" ? microUsd : BigInt(Math.trunc(Number(microUsd ?? 0)));
  // BigInt division truncates toward zero; costs are >= 0 so this is a floor.
  const cents = micro / MICRO_PER_CENT;
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  const dollars = abs / 100n;
  const remainder = abs % 100n;
  return `${negative ? "-" : ""}${dollars.toString()}.${remainder.toString().padStart(2, "0")}`;
}
