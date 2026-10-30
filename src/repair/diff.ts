// Minimal unified diff (LCS-based) for previewing edits. Good enough for source files of a few thousand lines;
// larger inputs fall back to a single whole-file hunk.

export function unifiedDiff(file: string, before: string, after: string, context = 3): string {
  if (before === after) return '';
  const a = before.split('\n');
  const b = after.split('\n');
  const ops: { t: ' ' | '-' | '+'; line: string }[] = [];
  if (a.length * b.length > 4_000_000) {
    for (const l of a) ops.push({ t: '-', line: l });
    for (const l of b) ops.push({ t: '+', line: l });
  } else {
    const n = a.length;
    const m = b.length;
    const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--)
        dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (a[i] === b[j]) {
        ops.push({ t: ' ', line: a[i]! });
        i++;
        j++;
      } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) ops.push({ t: '-', line: a[i++]! });
      else ops.push({ t: '+', line: b[j++]! });
    }
    while (i < n) ops.push({ t: '-', line: a[i++]! });
    while (j < m) ops.push({ t: '+', line: b[j++]! });
  }
  // Group into hunks with context.
  const out = [`--- a/${file}`, `+++ b/${file}`];
  let k = 0;
  let aLine = 1;
  let bLine = 1;
  while (k < ops.length) {
    if (ops[k]!.t === ' ') {
      k++;
      aLine++;
      bLine++;
      continue;
    }
    const start = Math.max(0, k - context);
    let end = k;
    let lastChange = k;
    while (end < ops.length && (ops[end]!.t !== ' ' || end - lastChange <= context * 2)) {
      if (ops[end]!.t !== ' ') lastChange = end;
      end++;
    }
    end = Math.min(ops.length, lastChange + context + 1);
    const back = k - start;
    const hunk = ops.slice(start, end);
    const aStart = aLine - back;
    const bStart = bLine - back;
    const aCount = hunk.filter((o) => o.t !== '+').length;
    const bCount = hunk.filter((o) => o.t !== '-').length;
    out.push(`@@ -${aStart},${aCount} +${bStart},${bCount} @@`);
    for (const o of hunk) out.push(`${o.t}${o.line}`);
    for (let x = k; x < end; x++) {
      if (ops[x]!.t !== '+') aLine++;
      if (ops[x]!.t !== '-') bLine++;
    }
    k = end;
  }
  return `${out.join('\n')}\n`;
}
