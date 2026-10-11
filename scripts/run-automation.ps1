<#
  run-automation.ps1
  One full round of the pipeline: agent phase (codex exec) then the deterministic publish phase.
  Single instance guarded by runner.lock.

  Usage:
    powershell -File run-automation.ps1 [-Video <url-or-id>] [-SkipPush]
#>
param(
  [string]$Video = "",
  [string]$Root = "D:\项目\AI内容生产",
  [string]$SkillsRoot = "C:\Users\Administrator\.codex\skills",
  [string]$CodexBin = "C:\Users\Administrator\.vscode\extensions\openai.chatgpt-26.1007.21434-win32-x64\bin\windows-x86_64\codex.real.exe",
  [int]$LockStaleMinutes = 150,
  [switch]$SkipPush
)

$ErrorActionPreference = "Stop"

$outRoot = Join-Path $Root "公众号产出"
$logPath = Join-Path $outRoot "automation-run.log"
$lockPath = Join-Path $outRoot "runner.lock"
$promptPath = Join-Path $PSScriptRoot "..\assets\prompts\run-one-episode.md"
if (-not (Test-Path -LiteralPath $promptPath)) { $promptPath = Join-Path $Root "prompts\run-one-episode.md" }
$agentMsg = Join-Path $outRoot "last-agent-message.txt"

function Write-Log {
  param([string]$Message)
  $line = "{0} | run | {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
  Add-Content -LiteralPath $logPath -Value $line -Encoding UTF8
  Write-Host $line
}

# 出错必须留痕
trap {
  Write-Log ("FAIL unhandled: {0} - {1}" -f $_.Exception.GetType().Name, $_.Exception.Message)
  exit 9
}

# ---------- lock ----------
if (Test-Path -LiteralPath $lockPath) {
  $age = ((Get-Date) - (Get-Item -LiteralPath $lockPath).LastWriteTime).TotalMinutes
  $ownerAlive = $false
  $lockText = Get-Content -LiteralPath $lockPath -Raw -Encoding UTF8 -ErrorAction SilentlyContinue
  $m = [regex]::Match([string]$lockText, 'pid=(\d+)')
  if ($m.Success) {
    $ownerAlive = [bool](Get-Process -Id ([int]$m.Groups[1].Value) -ErrorAction SilentlyContinue)
  }
  if ($ownerAlive -and $age -lt $LockStaleMinutes) {
    Write-Log ("skip: runner.lock held by pid {0} for {1:N0} min" -f $m.Groups[1].Value, $age)
    exit 0
  }
  if ($ownerAlive) { Write-Log ("stale lock ({0:N0} min), taking over" -f $age) }
  else { Write-Log "stale lock: owner process is gone, taking over" }
}
[IO.File]::WriteAllText($lockPath, "pid=$PID started=$(Get-Date -Format o)", (New-Object System.Text.UTF8Encoding($false)))

try {
  $startedAt = Get-Date
  Write-Log "start agent phase"

  if (-not (Test-Path -LiteralPath $CodexBin)) { throw "codex binary not found: $CodexBin" }
  if (-not (Test-Path -LiteralPath $promptPath)) { throw "prompt not found: $promptPath" }

  $prompt = Get-Content -LiteralPath $promptPath -Raw -Encoding UTF8
  if ($Video) {
    $prompt = $prompt + "`n`n## 本轮指定素材`n`n直接使用这个视频，跳过选题搜索：``$Video``"
  }

  $promptFile = Join-Path $outRoot "current-prompt.md"
  [IO.File]::WriteAllText($promptFile, $prompt, (New-Object System.Text.UTF8Encoding($false)))

  # 提示词走 stdin：里面带引号，作为命令行参数会被拆坏
  $OutputEncoding = New-Object System.Text.UTF8Encoding($false)
  Get-Content -LiteralPath $promptFile -Raw -Encoding UTF8 |
    & $CodexBin exec -C $Root -s danger-full-access --skip-git-repo-check -o $agentMsg -
  if ($LASTEXITCODE -ne 0) { Write-Log "FAIL agent phase exit=$LASTEXITCODE"; exit 7 }
  Write-Log "ok agent phase"

  # ---------- locate the episode written by the agent ----------
  $candidates = Get-ChildItem -Path (Join-Path $outRoot "*\run-meta.json") -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTime -gt $startedAt.AddSeconds(-5) } |
    Sort-Object LastWriteTime -Descending
  if (-not $candidates) {
    Write-Log "FAIL no run-meta.json produced by agent phase"
    exit 7
  }
  $slug = Split-Path (Split-Path $candidates[0].FullName -Parent) -Leaf
  Write-Log "episode detected slug=$slug"

  # 必须用 hashtable splat：数组 splat 不会把 -Name 当参数名，会全部按位置参数传，直接 ParameterBindingException
  $publishArgs = @{ Slug = $slug; Root = $Root }
  if ($SkillsRoot) { $publishArgs["SkillsRoot"] = $SkillsRoot }
  if ($SkipPush) { $publishArgs["SkipPush"] = $true }
  Write-Log "invoking publish slug=$slug"
  & (Join-Path $PSScriptRoot "publish-episode.ps1") @publishArgs
  $pubExit = $LASTEXITCODE
  if ($pubExit -ne 0) { Write-Log "FAIL publish phase exit=$pubExit"; exit $pubExit }
  Write-Log "round complete slug=$slug"
}
finally {
  Remove-Item -LiteralPath $lockPath -Force -ErrorAction SilentlyContinue
}
