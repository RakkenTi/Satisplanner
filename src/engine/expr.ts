/**
 * Safe, zero-eval arithmetic expression parser supporting +, -, *, /, parentheses,
 * and decimals so players can type "480/2", "3*60", "(120+45)/3" directly into
 * rate, machine count, and clock inputs, like Satisfactory's in-game quick calc.
 */
export function evaluateMathExpr(input: string): number | null {
  const s = input.replace(/,/g, '').replace(/\s+/g, '');
  if (!s) return null;
  if (!/^[0-9.+\-*/()]+$/.test(s)) return null;

  let pos = 0;

  function parseExpression(): number {
    let val = parseTerm();
    while (pos < s.length && (s[pos] === '+' || s[pos] === '-')) {
      const op = s[pos++];
      const rhs = parseTerm();
      val = op === '+' ? val + rhs : val - rhs;
    }
    return val;
  }

  function parseTerm(): number {
    let val = parseFactor();
    while (pos < s.length && (s[pos] === '*' || s[pos] === '/')) {
      const op = s[pos++];
      const rhs = parseFactor();
      if (op === '/') {
        if (Math.abs(rhs) < 1e-12) return Number.NaN;
        val /= rhs;
      } else {
        val *= rhs;
      }
    }
    return val;
  }

  function parseFactor(): number {
    if (pos < s.length && s[pos] === '+') {
      pos++;
      return parseFactor();
    }
    if (pos < s.length && s[pos] === '-') {
      pos++;
      return -parseFactor();
    }
    if (pos < s.length && s[pos] === '(') {
      pos++;
      const val = parseExpression();
      if (s[pos] !== ')') return Number.NaN;
      pos++;
      return val;
    }
    const start = pos;
    let hasDot = false;
    while (pos < s.length && ((s[pos] >= '0' && s[pos] <= '9') || s[pos] === '.')) {
      if (s[pos] === '.') {
        if (hasDot) return Number.NaN;
        hasDot = true;
      }
      pos++;
    }
    if (start === pos) return Number.NaN;
    return Number.parseFloat(s.slice(start, pos));
  }

  const result = parseExpression();
  if (pos !== s.length || !Number.isFinite(result)) return null;
  return result;
}
