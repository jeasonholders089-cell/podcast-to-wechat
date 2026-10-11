<#
  run-rebuild.ps1
  Rebuild queued legacy episodes from 重做清单.json, one batch at a time.
  Each item: agent rewrite (codex exec) then publish-episode.ps1.

  Usage:
    powershell -File run-rebuild.ps1 [-Count 2] [-SkipPush]
#>
param(
  [int]$Count = 1,
  [string]$Root = "D:\项目\AI内容生产",
  [string]$SkillsRoot = "C:\Users\Administrator\.codex\skills",
  [string]$CodexBin = "C:\Users\Administrator\.vscode\extensions\openai.chatgpt-26.1007.21434-win32-x64\bin\windows-x86_64\codex.real.exe",
  [switch]$SkipPush
)

$ErrorActionPreference = "Stop"

$outRoot = Join-Path $Root "公众号产出"
$logPath = Join-Path $outRoot "automation-run.log"
$queuePath = Join-Path $outRoot "重做清单.json"
$promptPath = Join-Path $PSScriptRoot "..\assets\prompts\rebuild-one-episode.md"
if (-not (Test-Path -LiteralPath $promptPath)) { $promptPath = Join-Path $Root "prompts\rebuild-one-episode.md" }
$agentMsg = Join-Path $outRoot "last-agent-message.txt"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Write-Log {
  param([string]$Message)
  $line = "{0} | rebuild | {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
  Add-Content -LiteralPath $logPath -Value $line -Encoding UTF8
  Write-Host $line
}

if (-not (Test-Path -LiteralPath $queuePath)) { Write-Log "FAIL queue not found: $queuePath"; exit 2 }
$queue = Get-Content -LiteralPath $queuePath -Raw -Encoding UTF8 | ConvertFrom-Json
$items = @($queue.items)

$pending = @($items | Where-Object { $_.status -ne "done" })
if ($pending.Count -eq 0) { Write-Log "queue empty, nothing to do"; exit 0 }

$batch = @($pending | Select-Object -First $Count)
$template = Get-Content -LiteralPath $promptPath -Raw -Encoding UTF8
$failed = 0

foreach ($item in $batch) {
  $slug = $item.slug
  Write-Log "start rebuild slug=$slug"

  $prompt = $template.Replace("{{SLUG}}", [string]$slug).
    Replace("{{OLD_ARTICLE}}", [string]$item.old_article).
    Replace("{{TRANSCRIPT}}", [string]$item.transcript)
  $promptFile = Join-Path $outRoot "current-prompt.md"
  [IO.File]::WriteAllText($promptFile, $prompt, $utf8NoBom)

  $OutputEncoding = New-Object System.Text.UTF8Encoding($false)
  Get-Content -LiteralPath $promptFile -Raw -Encoding UTF8 |
    & $CodexBin exec -C $Root -s danger-full-access --skip-git-repo-check -o $agentMsg -
  if ($LASTEXITCODE -ne 0) {
    Write-Log "FAIL agent phase slug=$slug exit=$LASTEXITCODE"
    foreach ($it in $items) { if ($it.slug -eq $slug) { $it.status = "failed"; $it.reason = "agent phase exit $LASTEXITCODE" } }
    $failed++
    continue
  }

  $publishArgs = @("-Slug", $slug, "-Root", $Root, "-SkillsRoot", $SkillsRoot)
  if ($SkipPush) { $publishArgs += "-SkipPush" }
  & (Join-Path $PSScriptRoot "publish-episode.ps1") @publishArgs
  $pubExit = $LASTEXITCODE
  if ($pubExit -ne 0) {
    Write-Log "FAIL publish phase slug=$slug exit=$pubExit"
    foreach ($it in $items) { if ($it.slug -eq $slug) { $it.status = "failed"; $it.reason = "publish exit $pubExit" } }
    $failed++
    continue
  }

  foreach ($it in $items) {
    if ($it.slug -eq $slug) { $it.status = "done"; $it.done_at = (Get-Date -Format o) }
  }
  Write-Log "done rebuild slug=$slug"
}

$queue.items = $items
$queue.updatedAt = (Get-Date -Format o)
[IO.File]::WriteAllText($queuePath, ($queue | ConvertTo-Json -Depth 8), $utf8NoBom)

$remaining = @($items | Where-Object { $_.status -ne "done" }).Count
Write-Log "batch finished done=$($batch.Count - $failed) failed=$failed remaining=$remaining"
if ($failed -gt 0) { exit 1 }
