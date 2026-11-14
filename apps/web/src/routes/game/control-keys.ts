/** Keys the menu can capture without overriding browser shortcuts or modifier navigation. */
export function assignableKey(code: string, reserved: readonly string[] = []): boolean {
  return /^(Key[A-Z]|Digit[0-9]|Arrow(Up|Down|Left|Right)|Space)$/.test(code) && !reserved.includes(code);
}
