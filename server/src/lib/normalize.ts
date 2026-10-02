export function normalizeEmail(
  raw: string | null | undefined,
): string | undefined {
  const value = raw?.trim().toLowerCase();
  return value ? value : undefined;
}

/**
 * Normalizes to "+<digits>". Brokerages are German, so a number without a country code
 * is read as German: "0170 1234567" -> "+491701234567". A number with no "+" and no leading
 * zero is assumed to already include its country code. Returns undefined when it can't be a phone number.
 */
export function normalizePhone(
  raw: string | null | undefined,
): string | undefined {
  if (!raw) return undefined;
  const cleaned = raw.trim().replace(/\(0\)/g, ""); // "+49 (0) 170 ..." -> "+49  170 ..."
  let digits = cleaned.replace(/\D/g, "");
  if (!digits) return undefined;

  if (!cleaned.startsWith("+")) {
    if (digits.startsWith("00")) digits = digits.slice(2);
    else if (digits.startsWith("0")) digits = `49${digits.slice(1)}`;
  }
  return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : undefined;
}
