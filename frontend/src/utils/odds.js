export function americanToDecimal(americanOdds) {
  if (americanOdds === 0 || Number.isNaN(americanOdds)) return null;
  return americanOdds > 0
    ? 1 + americanOdds / 100
    : 1 + 100 / Math.abs(americanOdds);
}

export function centsToAmerican(centsOdds) {
  if (centsOdds <= 0 || centsOdds >= 100 || Number.isNaN(centsOdds)) return null;
  const decimalOdds = centsToDecimal(centsOdds);
  if (decimalOdds === null) return null;
  return decimalToAmerican(decimalOdds);
}

export function centsToDecimal(centsOdds) {
  if (centsOdds <= 0 || centsOdds >= 100 || Number.isNaN(centsOdds)) return null;
  return 100 / centsOdds;
}

export function decimalToAmerican(decimalOdds) {
  if (decimalOdds <= 1 || Number.isNaN(decimalOdds)) return null;
  return decimalOdds >= 2
    ? (decimalOdds - 1) * 100
    : -100 / (decimalOdds - 1);
}

export function americanToCents(americanOdds) {
  const impliedProbability = impliedProbabilityFromAmerican(americanOdds);
  if (impliedProbability === null) return null;
  return impliedProbability * 100;
}

export function decimalToCents(decimalOdds) {
  const impliedProbability = impliedProbabilityFromDecimal(decimalOdds);
  if (impliedProbability === null) return null;
  return impliedProbability * 100;
}

export function impliedProbabilityFromAmerican(americanOdds) {
  if (americanOdds === 0 || Number.isNaN(americanOdds)) return null;
  return americanOdds > 0
    ? 100 / (americanOdds + 100)
    : Math.abs(americanOdds) / (Math.abs(americanOdds) + 100);
}

export function impliedProbabilityFromDecimal(decimalOdds) {
  if (decimalOdds <= 1 || Number.isNaN(decimalOdds)) return null;
  return 1 / decimalOdds;
}

export function formatAmerican(value) {
  if (value === null || Number.isNaN(value)) return '-';
  const rounded = Math.round(value);
  return rounded > 0 ? `+${rounded}` : `${rounded}`;
}

export function formatPercent(value) {
  if (value === null || Number.isNaN(value)) return '-';
  return `${(value * 100).toFixed(2)}%`;
}
