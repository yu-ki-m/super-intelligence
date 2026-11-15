// Writes the clipboard HTML/TSV that the workbook HTML produces for a range, plus per-cell notes
// (which strings are protected as text, which formulas are sent as values) used to classify differences.
const fs = require('fs'), path = require('path');
const C = require(path.join(__dirname, '..', '..', 'assets', 'core.js'));
const [wbPath, sheetId, rangeText, outPrefix] = process.argv.slice(2);
const w = C.validate(JSON.parse(fs.readFileSync(wbPath, 'utf8')));
const s = w.sheets.find(x => x.id === sheetId);
const q = C.expanded(s, C.range(rangeText));
const p = C.clipboard(w, s, q);
const notes = {};
C.each(q, (r, c) => {
  const cell = C.get(s, r, c), st = C.style(w, s, cell), a = C.addr(r, c), value = C.calculate(w, s, r, c);
  if (cell.t === 's' && cell.v !== '' && st.numFmt !== '@' && C.excelWouldConvert(cell.v)) notes[a] = 'text-protected';
  if (cell.t === 'f' && !C.blockFormula(cell.f, q)) notes[a] = 'formula-as-value';
  if (cell.t === 'f' && C.isErr(value)) notes[a] = 'formula-error';
});
// Excel keeps one line per cell edge; two different lines on the same edge cannot both survive.
const conflicts = [];
C.each(q, (r, c) => {
  if (C.mergeAt(s, r, c)) return;
  const st = C.style(w, s, C.get(s, r, c));
  for (const [dr, dc, mine, theirs] of [[0, 1, 'borderRight', 'borderLeft'], [1, 0, 'borderBottom', 'borderTop']]) {
    const rr = r + dr, cc = c + dc; if (rr > q.r2 || cc > q.c2 || C.mergeAt(s, rr, cc)) continue;
    const other = C.style(w, s, C.get(s, rr, cc));
    if (st[mine] !== 'none' && other[theirs] !== 'none' && st[mine] !== other[theirs]) {
      conflicts.push({a: C.addr(r, c), b: C.addr(rr, cc), edge: dr ? '下/上' : '右/左', lines: [st[mine], other[theirs]]});
      notes[C.addr(r, c)] = notes[C.addr(r, c)] || 'border-conflict'; notes[C.addr(rr, cc)] = notes[C.addr(rr, cc)] || 'border-conflict';
    }
  }
});
fs.writeFileSync(outPrefix + '.html', p.html, 'utf8');
fs.writeFileSync(outPrefix + '.txt', p.text, 'utf8');
fs.writeFileSync(outPrefix + '.notes.json', JSON.stringify({range: C.addr(q.r1, q.c1) + ':' + C.addr(q.r2, q.c2), r1: q.r1 + 1, c1: q.c1 + 1, r2: q.r2 + 1, c2: q.c2 + 1, notes, conflicts}, null, 2), 'utf8');
console.log(JSON.stringify({range: C.addr(q.r1, q.c1) + ':' + C.addr(q.r2, q.c2), bytes: Buffer.byteLength(p.html)}));
