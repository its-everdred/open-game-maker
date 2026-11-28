/** Only smoke options which actually run gm test against its default dist are allowed. */
export function safePublishTestScript(script: string): boolean {
  const words = script.trim().split(/\s+/u);
  if (words.shift() !== 'gm' || words.shift() !== 'test') return false;
  while (words.length) {
    const word = words.shift()!;
    if (word === '--json') continue;
    const match = /^--(inputs|ticks|deadline|out)(?:=([A-Za-z0-9_./:-]+))?$/u.exec(word);
    if (!match) return false;
    const value = match[2] ?? words.shift();
    if (!value || value.startsWith('-') || !/^[A-Za-z0-9_./:-]+$/u.test(value)) return false;
  }
  return true;
}
