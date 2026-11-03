# Speaks a UTF-8 text file with the Windows built-in voice and returns without waiting for the speech to end.
# Usage: speak.ps1 <file>   Replaces any speech in progress.
#        speak.ps1 -Stop    Stops the speech in progress.
# Keep this file ASCII only: Windows PowerShell 5.1 reads a script without a BOM in the system code page.
param(
    [Parameter(Position = 0)][string]$Path,
    [switch]$Stop,
    [switch]$Worker
)

$ErrorActionPreference = 'Stop'
$stateDir = Join-Path $env:TEMP 'windows-speak'
$errorLog = Join-Path $stateDir 'last-error.txt'

function Stop-Speaking {
    # Match the command line rather than a saved PID, which Windows can reuse for an unrelated process.
    Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" |
        Where-Object { $_.CommandLine -and $_.CommandLine.Contains($PSCommandPath) -and $_.CommandLine.Contains('-Worker') -and $_.ProcessId -ne $PID } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    if (Test-Path -LiteralPath $stateDir) {
        Get-ChildItem -LiteralPath $stateDir -Filter 'speech-*.txt' | Remove-Item -ErrorAction SilentlyContinue
    }
}

if ($Worker) {
    try {
        Add-Type -AssemblyName System.Speech
        $voice = New-Object System.Speech.Synthesis.SpeechSynthesizer
        $voice.Speak([IO.File]::ReadAllText($Path, [Text.Encoding]::UTF8))
    } catch {
        # Nobody is attached to this process, so the next run reports the failure.
        # Log ASCII only: the exception message is localized and would be garbled in some shells.
        $failure = $_.Exception.GetBaseException()
        Set-Content -LiteralPath $errorLog -Value ('{0} (0x{1:X8})' -f $failure.GetType().FullName, $failure.HResult) -Encoding UTF8
    } finally {
        Remove-Item -LiteralPath $Path -ErrorAction SilentlyContinue
    }
    exit 0
}

New-Item -ItemType Directory -Force -Path $stateDir | Out-Null

if (Test-Path -LiteralPath $errorLog) {
    [Console]::Error.WriteLine('The previous speech failed: ' + (Get-Content -LiteralPath $errorLog -Raw -Encoding UTF8).Trim())
    Remove-Item -LiteralPath $errorLog
}

if ($Stop) {
    Stop-Speaking
    exit 0
}

if (-not $Path) {
    [Console]::Error.WriteLine('Usage: speak.ps1 <file> | speak.ps1 -Stop')
    exit 1
}

# Check everything that can fail before touching the speech in progress, and while the caller can still see the error.
if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    [Console]::Error.WriteLine('The text file was not found: ' + $Path)
    exit 1
}
$text = [IO.File]::ReadAllText($Path, [Text.Encoding]::UTF8)
if ([string]::IsNullOrWhiteSpace($text)) {
    [Console]::Error.WriteLine('The text file is empty: ' + $Path)
    exit 1
}
Add-Type -AssemblyName System.Speech
$check = New-Object System.Speech.Synthesis.SpeechSynthesizer
if (-not ($check.GetInstalledVoices() | Where-Object { $_.Enabled })) {
    [Console]::Error.WriteLine('No enabled voice is installed.')
    exit 1
}
$check.Dispose()

Stop-Speaking

# The worker reads its own copy so that the caller can delete its temporary file right away.
$copy = Join-Path $stateDir ('speech-' + [guid]::NewGuid().ToString() + '.txt')
[IO.File]::WriteAllText($copy, $text, (New-Object Text.UTF8Encoding($true)))
$arguments = @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"", "`"$copy`"", '-Worker')
Start-Process powershell.exe -ArgumentList $arguments -WindowStyle Hidden
