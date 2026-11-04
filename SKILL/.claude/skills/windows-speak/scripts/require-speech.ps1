# Claude Code Stop hook: sends Claude back once when a turn ends without running speak.ps1.
# Claude still writes the spoken text and decides whether there is anything to say. This only makes it decide.
# Keep this file ASCII only: Windows PowerShell 5.1 reads a script without a BOM in the system code page.

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Web.Extensions
$json = New-Object System.Web.Script.Serialization.JavaScriptSerializer
# The default limit is about 2 MB, and a transcript line can hold a much larger tool result.
$json.MaxJsonLength = [int]::MaxValue

function Test-SpeechCommand([string]$command) {
    # Requiring a launch keeps reading or editing the script from counting as speech.
    # -Stop counts too: the user asked for silence, so there is nothing to send Claude back for.
    return ($command -match 'speak\.ps1') -and ($command -match '-File\s|(^|[;\r\n])\s*&\s')
}

function Test-SpokeInLastTurn([string]$path) {
    # Other processes keep writing the transcript, so the sharing mode has to allow that.
    $stream = [IO.File]::Open($path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]'ReadWrite, Delete')
    try {
        # A transcript can reach tens of MB while a turn is usually small, so read from the end and widen only if needed.
        $size = 1MB
        while ($true) {
            $start = [Math]::Max([long]0, $stream.Length - $size)
            $stream.Position = $start
            $buffer = New-Object byte[] ($stream.Length - $start)
            $read = 0
            while ($read -lt $buffer.Length) {
                $count = $stream.Read($buffer, $read, $buffer.Length - $read)
                if ($count -eq 0) { break }
                $read += $count
            }
            $lines = [Text.Encoding]::UTF8.GetString($buffer, 0, $read).Split("`n")
            # When the window starts inside the file, its first line is cut in half.
            $first = if ($start -gt 0) { 1 } else { 0 }
            for ($i = $lines.Length - 1; $i -ge $first; $i--) {
                if (-not $lines[$i].Trim()) { continue }
                # The last line can still be half written.
                try { $entry = $json.DeserializeObject($lines[$i]) } catch { continue }
                if ($entry -isnot [Collections.IDictionary] -or $entry['isSidechain']) { continue }
                $message = $entry['message']
                if ($message -isnot [Collections.IDictionary]) { continue }
                $content = @(if ($message['content'] -is [array]) { $message['content'] })

                if ($entry['type'] -eq 'assistant') {
                    foreach ($block in $content) {
                        if ($block['type'] -eq 'tool_use' -and $block['input'] -is [Collections.IDictionary] -and
                            (Test-SpeechCommand $block['input']['command'])) {
                            return $true
                        }
                    }
                } elseif ($entry['type'] -eq 'user' -and -not $entry['isMeta'] -and -not $entry['isCompactSummary']) {
                    # Tool results are stored as user entries but belong to the running turn. Anything else starts a turn.
                    if (-not ($content | Where-Object { $_['type'] -eq 'tool_result' })) { return $false }
                }
            }
            if ($start -eq 0) { return $false }
            $size *= 4
        }
    } finally {
        $stream.Dispose()
    }
}

$stdin = New-Object IO.StreamReader([Console]::OpenStandardInput(), (New-Object Text.UTF8Encoding($false)))
$hook = $json.DeserializeObject($stdin.ReadToEnd())

# Claude was already sent back once for this stop. Blocking again could loop forever.
if ($hook['stop_hook_active']) { exit 0 }
if (Test-SpokeInLastTurn $hook['transcript_path']) { exit 0 }

# The procedure is repeated here because the skill may no longer be in Claude's context after a long conversation.
$speak = (Join-Path $PSScriptRoot 'speak.ps1').Replace('\', '/')
$skill = (Join-Path (Split-Path -Parent $PSScriptRoot) 'SKILL.md').Replace('\', '/')
$reason = "No spoken report was started in this turn. If this turn finished or failed a task, explained something, " +
    "answered a question, or is waiting for the user, speak now by following the windows-speak skill " +
    "($skill; read it again if it is no longer in your context): write a separate spoken version, not a copy of the " +
    "on-screen text, to a temporary UTF-8 file with the Write tool, run powershell.exe -NoProfile -ExecutionPolicy " +
    "Bypass -File `"$speak`" <file> as a normal foreground command, then delete the file. The on-screen response is " +
    "already visible, so do not repeat it. If there is nothing new to tell, end now without speaking and without " +
    "further output."

# Write the bytes directly: the console code page could garble a non-ASCII path.
$bytes = (New-Object Text.UTF8Encoding($false)).GetBytes($json.Serialize(@{ decision = 'block'; reason = $reason }))
$stdout = [Console]::OpenStandardOutput()
$stdout.Write($bytes, 0, $bytes.Length)
$stdout.Flush()
