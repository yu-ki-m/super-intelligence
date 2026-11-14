# Desktop Excel side of verify_excel_paste.py (Windows, PowerShell 7, Excel installed).
#   native : build the sheet natively in Excel from the workbook JSON, dump it, let Excel copy it and paste
#            Excel's own HTML back (what an Excel-to-Excel HTML paste gives)
#   paste  : put the given HTML on the clipboard exactly as Chrome/Edge do and paste it at the range origin
# Dumps every cell of the range (value, type, formula, format, font, fill, alignment, borders, merge, link).
param(
  [Parameter(Mandatory)][ValidateSet('native', 'paste')][string]$Mode,
  [Parameter(Mandatory)][string]$Out, [Parameter(Mandatory)][int]$R1, [Parameter(Mandatory)][int]$C1,
  [Parameter(Mandatory)][int]$R2, [Parameter(Mandatory)][int]$C2,
  [string]$Workbook, [string]$Sheet, [string]$Html, [string]$Text, [string]$CfHtml, [switch]$Pdf)
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\clip.ps1"
$enc = New-Object System.Text.UTF8Encoding($false)

function Dump-Range($xl, $ws) {
  $cells = @()
  for ($r = $R1; $r -le $R2; $r++) { for ($c = $C1; $c -le $C2; $c++) {
    $x = $ws.Cells.Item($r, $c); $b = $x.Borders
    $bd = { param($i) $e = $b.Item($i); if ($e.LineStyle -eq -4142) { 'none' } else { "$($e.LineStyle)/$($e.Weight)/$([int]$e.Color)" } }
    $cells += [ordered]@{
      addr = $x.Address(0,0); text = $x.Text; value2 = $x.Value2; hasFormula = $x.HasFormula; formula = $x.Formula
      prefix = $x.PrefixCharacter; numfmt = $x.NumberFormat
      font = $x.Font.Name; size = $x.Font.Size; bold = $x.Font.Bold; italic = $x.Font.Italic
      underline = $x.Font.Underline; strike = $x.Font.Strikethrough; color = [int]$x.Font.Color
      fill = if ($x.Interior.Pattern -eq -4142) { 'none' } else { [int]$x.Interior.Color }
      halign = $x.HorizontalAlignment; valign = $x.VerticalAlignment; wrap = $x.WrapText; indent = $x.IndentLevel
      mergeArea = if ($x.MergeCells) { $x.MergeArea.Address(0,0) } else { '' }
      hyperlink = if ($x.Hyperlinks.Count) { $x.Hyperlinks.Item(1).Address } else { '' }
      bTop = & $bd 8; bBottom = & $bd 9; bLeft = & $bd 7; bRight = & $bd 10
    }
  } }
  $cols = @(); for ($c = $C1; $c -le $C2; $c++) { $cols += [ordered]@{ chars = $ws.Columns.Item($c).ColumnWidth; pt = $ws.Columns.Item($c).Width } }
  $rowsInfo = @(); for ($r = $R1; $r -le $R2; $r++) { $rowsInfo += $ws.Rows.Item($r).RowHeight }
  return [ordered]@{ excel = $xl.Version; cells = $cells; columns = $cols; rowHeights = $rowsInfo }
}
function Save-Dump($xl, $ws, $path) {
  [IO.File]::WriteAllText($path, ((Dump-Range $xl $ws) | ConvertTo-Json -Depth 6), $enc)
  if ($Pdf) {
    $ws.PageSetup.Orientation = 2; $ws.PageSetup.Zoom = $false; $ws.PageSetup.FitToPagesWide = 1; $ws.PageSetup.FitToPagesTall = 1
    $ws.PageSetup.PrintGridlines = $true; $ws.PageSetup.PrintHeadings = $true
    $ws.PageSetup.PrintArea = $ws.Range($ws.Cells.Item(1, 1), $ws.Cells.Item($R2, $C2)).Address()
    $ws.ExportAsFixedFormat(0, [IO.Path]::ChangeExtension($path, '.pdf'))
  }
}
function Paste-At($xl, $path) {
  $wb = $xl.Workbooks.Add(); $ws = $wb.Worksheets.Item(1)
  $ws.Activate(); $ws.Cells.Item($R1, $C1).Select() | Out-Null
  $ws.Paste()
  Save-Dump $xl $ws $path
}

function Build-Native($xl) {
  $w = Get-Content -Raw -Encoding utf8 $Workbook | ConvertFrom-Json -AsHashtable
  $s = $w.sheets | Where-Object { $_.id -eq $Sheet } | Select-Object -First 1
  if (-not $s) { throw "sheet not found: $Sheet" }
  $DEFAULT = [ordered]@{font='Yu Gothic';size=11;bold=$false;italic=$false;underline=$false;strike=$false;color='#000000';fill='none';align='general';valign='middle';wrap=$false;numFmt='General';borderTop='none';borderRight='none';borderBottom='none';borderLeft='none';indent=0}
  $ALIGN = @{general=1; left=-4131; center=-4108; right=-4152}; $VALIGN = @{top=-4160; middle=-4108; bottom=-4107}
  $LINE = @{solid=1; dashed=-4115; dotted=-4118; double=-4119}; $WEIGHT = @{'0.5'=1; '1'=2; '2'=-4138; '3'=4}
  $styleOf = { param($cell) $st = [ordered]@{}; foreach ($k in $DEFAULT.Keys) { $st[$k] = $DEFAULT[$k] }
    foreach ($src in @($w.defaultStyle, $s.defaultStyle, $cell.s)) { if ($src) { foreach ($k in $src.Keys) { $st[$k] = $src[$k] } } }; $st }
  $bgr = { param($hex) $h = $hex.TrimStart('#'); [int]("0x" + $h.Substring(4,2) + $h.Substring(2,2) + $h.Substring(0,2)) }
  $coord = { param($a) $m = [regex]::Match($a, '^([A-Z]+)(\d+)$'); $c = 0; foreach ($ch in $m.Groups[1].Value.ToCharArray()) { $c = $c * 26 + [int]$ch - 64 }; @([int]$m.Groups[2].Value, $c) }

  $wb = $xl.Workbooks.Add(); $ws = $wb.Worksheets.Item(1)
  $scratch = $ws.Cells.Item(1048000, 16000)
  $probe = $ws.Columns.Item(16001); $probe.ColumnWidth = 10; $p10 = $probe.Width; $probe.ColumnWidth = 20; $p20 = $probe.Width
  $slope = ($p20 - $p10) / 10; $icpt = $p10 - 10 * $slope
  for ($c = 0; $c -lt $s.colWidths.Count; $c++) { $px = $s.colWidths[$c]; if ($null -ne $px) { $ws.Columns.Item($c + 1).ColumnWidth = [math]::Max(0, ($px * 0.75 - $icpt) / $slope) } }
  for ($r = 0; $r -lt $s.rowHeights.Count; $r++) { $px = $s.rowHeights[$r]; if ($null -ne $px) { $ws.Rows.Item($r + 1).RowHeight = $px * 0.75 } }
  $mergeOf = @{}; $hidden = @{}
  foreach ($m in $s.merges) {
    $rg = $ws.Range($ws.Cells.Item([int]$m.r1 + 1, [int]$m.c1 + 1), $ws.Cells.Item([int]$m.r2 + 1, [int]$m.c2 + 1)); $rg.Merge()
    $mergeOf[$rg.Cells.Item(1, 1).Address(0, 0)] = $rg
    # The page draws a merged range with its top-left cell's format only, so the other cells' formats are not built.
    foreach ($hc in $rg.Cells) { $ha = $hc.Address(0, 0); if ($ha -ne $rg.Cells.Item(1, 1).Address(0, 0)) { $hidden[$ha] = $true } }
  }
  foreach ($key in $s.cells.Keys) {
    if ($hidden.ContainsKey($key)) { continue }
    $cell = $s.cells[$key]; $rc = & $coord $key; $x = $ws.Cells.Item($rc[0], $rc[1]); $st = & $styleOf $cell
    $fx = $x; if ($mergeOf.ContainsKey($key)) { $fx = $mergeOf[$key] }
    if ($st.numFmt -ne 'General') { $fx.NumberFormat = $st.numFmt }
    switch ($cell.t) {
      's' {
        $v = [string]$cell.v; $needPrefix = $false
        if ($v -ne '' -and $st.numFmt -ne '@') { $scratch.Value2 = $v; $needPrefix = $scratch.HasFormula -or -not ($scratch.Value2 -is [string]) -or [string]$scratch.Value2 -ne $v; $scratch.Clear() | Out-Null }
        $x.Value2 = $(if ($needPrefix) { "'" + $v } else { $v })
      }
      'n' { $x.Value2 = [double]$cell.v }
      'b' { $x.Value2 = [bool]$cell.v }
      'f' { $x.Formula = $cell.f }
    }
    $f = $fx.Font; $f.Name = $st.font; $f.Size = [double]$st.size; $f.Bold = $st.bold; $f.Italic = $st.italic
    $f.Underline = $(if ($st.underline) { 2 } else { -4142 }); $f.Strikethrough = $st.strike; $f.Color = & $bgr $st.color
    if ($st.fill -ne 'none') { $fx.Interior.Color = & $bgr $st.fill }
    $fx.HorizontalAlignment = $ALIGN[$st.align]; $fx.VerticalAlignment = $VALIGN[$st.valign]; $fx.WrapText = $st.wrap
    if ($st.indent -gt 0) { $fx.IndentLevel = [int]$st.indent }
    foreach ($pair in @(@('borderTop', 8), @('borderBottom', 9), @('borderLeft', 7), @('borderRight', 10))) {
      $v = $st[$pair[0]]
      if ($v -ne 'none') { $m = [regex]::Match($v, '^([\d.]+)px (\w+) (#[0-9a-fA-F]{6})$'); $e = $fx.Borders.Item($pair[1])
        $e.LineStyle = $LINE[$m.Groups[2].Value]; if ($m.Groups[2].Value -ne 'double') { $e.Weight = $WEIGHT[$m.Groups[1].Value] }; $e.Color = & $bgr $m.Groups[3].Value }
    }
    if ($cell.link) { [void]$ws.Hyperlinks.Add($x, $cell.link, '', '', [string]$cell.v); $x.Font.Name = $st.font; $x.Font.Size = [double]$st.size }
  }
  return $ws
}

$xl = New-Object -ComObject Excel.Application
$xl.Visible = $false; $xl.DisplayAlerts = $false
try {
  if ($Mode -eq 'native') {
    $ws = Build-Native $xl
    Save-Dump $xl $ws "$Out.native.json"
    $ws.Range($ws.Cells.Item($R1, $C1), $ws.Cells.Item($R2, $C2)).Copy() | Out-Null
    $h = [RawClip]::GetHtml(); $t = [RawClip]::GetText()
    [IO.File]::WriteAllText("$Out.excelcopy.html", $h, $enc)
    [RawClip]::SetHtml($h.Substring($h.IndexOf('<html')), $t)
    Paste-At $xl "$Out.excelcopy.json"
  } else {
    $t = [IO.File]::ReadAllText($Text, $enc)
    if ($CfHtml) { [RawClip]::SetRaw([IO.File]::ReadAllBytes($CfHtml), $t) }  # bytes captured from a real browser copy
    else {
      $h = [IO.File]::ReadAllText($Html, $enc)
      # Chrome and Edge wrap text/html this way when they write CF_HTML.
      [RawClip]::SetHtml("<html>`r`n<body>`r`n<!--StartFragment-->" + $h + "<!--EndFragment-->`r`n</body>`r`n</html>", $t)
    }
    Paste-At $xl "$Out.json"
  }
  'OK'
} finally {
  foreach ($wbk in @($xl.Workbooks)) { $wbk.Close($false) }
  $xl.Quit(); [void][Runtime.InteropServices.Marshal]::ReleaseComObject($xl)
}
