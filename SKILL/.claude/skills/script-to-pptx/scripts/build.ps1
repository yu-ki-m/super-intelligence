param(
    [Parameter(Mandatory = $true)][string]$Script,
    [string]$Out = 'out.pptx',
    [int[]]$Only = @(),
    [switch]$NoRender
)
# 作業フォルダーの deck.js で組み立て、inspect.js で中身を確かめ、render.ps1 で画像にする。一度で流す。
# 画像は作業フォルダーの png/ に入る。見るのは grid01.png… （4枚ずつ）で足りる。
# -Only 3,7 で、そのスライドだけを書き出し直す（grid は書き出し済みの全スライドから作り直される）。
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$Script = (Resolve-Path -LiteralPath $Script).Path
Push-Location $here
try {
    node deck.js $Script $Out
    if ($LASTEXITCODE) { throw '組み立てに失敗した。上のエラーを見て deck.js を直す' }
    node inspect.js $Out
    if (-not $NoRender) { & (Join-Path $here 'render.ps1') -Deck $Out -OutDir (Join-Path $here 'png') -Only $Only }
}
finally { Pop-Location }
