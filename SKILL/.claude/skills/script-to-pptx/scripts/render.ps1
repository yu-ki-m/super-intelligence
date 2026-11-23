param(
    [Parameter(Mandatory = $true)][string]$Deck,
    [Parameter(Mandatory = $true)][string]$OutDir,
    [int[]]$Only = @()
)
# 実際の PowerPoint で各スライドを PNG（1600x900）に書き出し、4枚ずつ並べた確認用の画像 grid01.png… も作る。
# -Only 3,7 のように番号を渡すと、そのスライドだけを書き出す（直したスライドの確かめ直しに使う）。
# 利用者が PowerPoint で別の資料を開いていても閉じないよう、自分が開いた資料だけを閉じ、
# 呼び出す前に PowerPoint が動いていなかったときだけ終了する。
$ErrorActionPreference = 'Stop'
$Deck = (Resolve-Path -LiteralPath $Deck).Path
# PowerPoint の書き出しは絶対パスしか受け付けないので、書き出し先を絶対パスに直す
$OutDir = (New-Item -ItemType Directory -Force $OutDir).FullName
if ($Only.Count) { foreach ($i in $Only) { Remove-Item -LiteralPath (Join-Path $OutDir ('s{0:D2}.png' -f $i)) -ErrorAction SilentlyContinue } }
else { Get-ChildItem -LiteralPath $OutDir -Filter *.png | Remove-Item -Confirm:$false }
Get-ChildItem -LiteralPath $OutDir -Filter 'grid*.png' | Remove-Item -Confirm:$false

$wasRunning = [bool](Get-Process -Name POWERPNT -ErrorAction SilentlyContinue)
$pp = New-Object -ComObject PowerPoint.Application
$pres = $null
try {
    # ReadOnly, Untitled なし, WithWindow なし
    $pres = $pp.Presentations.Open($Deck, $true, $false, $false)
    $n = $pres.Slides.Count
    for ($i = 1; $i -le $n; $i++) {
        if ($Only.Count -and -not ($Only -contains $i)) { continue }
        $pres.Slides.Item($i).Export((Join-Path $OutDir ('s{0:D2}.png' -f $i)), 'PNG', 1600, 900)
    }
}
finally {
    if ($pres) { $pres.Close() }
    if (-not $wasRunning -and $pp.Presentations.Count -eq 0) { $pp.Quit() }
    [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($pp)
}

Add-Type -AssemblyName System.Drawing
$files = Get-ChildItem -LiteralPath $OutDir -Filter 's*.png' | Sort-Object Name
for ($g = 0; $g -lt $files.Count; $g += 4) {
    $grid = New-Object System.Drawing.Bitmap 1600, 900
    $gr = [System.Drawing.Graphics]::FromImage($grid)
    $gr.Clear([System.Drawing.Color]::Gray)
    for ($k = 0; $k -lt 4 -and ($g + $k) -lt $files.Count; $k++) {
        $img = [System.Drawing.Image]::FromFile($files[$g + $k].FullName)
        $gr.DrawImage($img, ($k % 2) * 800, [math]::Floor($k / 2) * 450, 798, 448)
        $img.Dispose()
    }
    $grid.Save((Join-Path $OutDir ('grid{0:D2}.png' -f ($g / 4 + 1))), [System.Drawing.Imaging.ImageFormat]::Png)
    $gr.Dispose(); $grid.Dispose()
}
"slides: $($files.Count)"
Get-ChildItem -LiteralPath $OutDir -Filter 'grid*.png' | ForEach-Object FullName
