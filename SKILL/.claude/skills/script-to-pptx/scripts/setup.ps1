param([Parameter(Mandatory = $true)][string]$WorkDir)
# 作業フォルダーを用意する。部品（lib.js など）を写し、pptxgenjs と jszip を入れ、使える道具を確かめて表示する。
# 二回目以降は、部品を写し直すだけで、入れ直しはしない。
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
New-Item -ItemType Directory -Force $WorkDir | Out-Null
foreach ($f in 'lib.js', 'inspect.js', 'render.ps1', 'build.ps1', 'deck-example.js', 'example_script.md') {
    Copy-Item -LiteralPath (Join-Path $here $f) -Destination $WorkDir -Force
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js が見つからない。Node.js を入れてから、もう一度実行する' }
if (-not (Test-Path (Join-Path $WorkDir 'node_modules/pptxgenjs'))) {
    Push-Location $WorkDir
    try {
        if (-not (Test-Path 'package.json')) { '{ "name": "deck-work", "private": true }' | Set-Content -Encoding utf8 package.json }
        npm install --no-audit --no-fund pptxgenjs@3.12.0 jszip@3.10.1 2>&1 | Select-Object -Last 2
    }
    finally { Pop-Location }
}
$pp = $false
try { $app = New-Object -ComObject PowerPoint.Application; $pp = $true; [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($app) } catch {}
Add-Type -AssemblyName System.Drawing
$fonts = (New-Object System.Drawing.Text.InstalledFontCollection).Families.Name
$need = 'BIZ UDPゴシック', 'BIZ UDゴシック', 'Segoe UI', 'Consolas'
$missing = $need | Where-Object { $fonts -notcontains $_ }
"作業フォルダー: $WorkDir"
"node: $(node --version)"
"PowerPoint: $(if ($pp) { '使える（render.ps1 で画像にして確かめられる）' } else { '見つからない（画像での確かめはできない）' })"
"フォント: $(if ($missing) { '見つからない: ' + ($missing -join ', ') } else { 'そろっている' })"
