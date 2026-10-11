<#
  publish-episode.ps1
  Deterministic half of the pipeline: QC -> render -> covers -> face check -> push draft.
  Reads <episode>/run-meta.json, which the agent phase is required to write.

  Usage:
    powershell -File publish-episode.ps1 -Slug <slug> [-SkipPush] [-NoArt]

  Exit codes: 0 ok / 2 bad input / 3 qc failed / 4 render failed / 5 face check failed / 6 push failed
#>
param(
  [Parameter(Mandatory = $true)][string]$Slug,
  [string]$Root = "D:\项目\AI内容生产",
  [string]$SkillsRoot = "",
  [string]$Sizes = "h,3x4,1x1,quote",
  [switch]$SkipPush,
  [switch]$NoArt
)

$ErrorActionPreference = "Stop"

# 脚本现在住在 skill 里：默认按自己的位置反推 skills 根目录，也可以显式传 -SkillsRoot
if ([string]::IsNullOrWhiteSpace($SkillsRoot)) {
  $SkillsRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
}

$outRoot  = Join-Path $Root "公众号产出"
$episode  = Join-Path $outRoot $Slug
$logPath  = Join-Path $outRoot "automation-run.log"
$lastMsg  = Join-Path $outRoot "last-run-message.txt"
$toDelete = Join-Path $outRoot "待删除-旧草稿.txt"
$master   = Join-Path $outRoot "已发布-视频清单.json"
$skillZ   = Join-Path $SkillsRoot "podcast-to-wechat"

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Write-Log {
  param([string]$Message)
  $line = "{0} | {1} | {2}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Slug, $Message
  Add-Content -LiteralPath $logPath -Value $line -Encoding UTF8
  Write-Host $line
}

function Resolve-Exe {
  param([string]$Name, [string[]]$Fallbacks)
  $cmd = Get-Command $Name -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  foreach ($f in $Fallbacks) { if (Test-Path -LiteralPath $f) { return $f } }
  throw "cannot locate executable: $Name"
}

function Write-Json {
  param([string]$Path, $Object)
  [IO.File]::WriteAllText($Path, ($Object | ConvertTo-Json -Depth 8), $utf8NoBom)
}

$node   = Resolve-Exe -Name "node"   -Fallbacks @("C:\Program Files\nodejs\node.exe")
$python = Resolve-Exe -Name "python" -Fallbacks @("C:\Program Files\Python314\python.exe")

if (-not (Test-Path -LiteralPath $episode)) { throw "episode dir not found: $episode" }
$metaPath = Join-Path $episode "run-meta.json"
if (-not (Test-Path -LiteralPath $metaPath)) { Write-Log "FAIL missing run-meta.json"; exit 2 }
$meta = Get-Content -LiteralPath $metaPath -Raw -Encoding UTF8 | ConvertFrom-Json

$articleMd = Join-Path $episode $meta.article_md
if (-not (Test-Path -LiteralPath $articleMd)) { Write-Log "FAIL missing article: $($meta.article_md)"; exit 2 }
$articleName = (Split-Path $meta.article_md -Leaf) -replace '\.md$', '.html'
$articleHtml = Join-Path $episode $articleName

Write-Log "start slug=$Slug title=$($meta.title)"

# ---------- step 2.5 : QC ----------
$qcJson = Join-Path $episode "qc-report.json"
$qcArgs = @((Join-Path $skillZ "scripts\check_ai_flavor.mjs"), "--md", $articleMd, "--json", $qcJson)
if ($meta.transcript) {
  $tp = Join-Path $episode $meta.transcript
  if (Test-Path -LiteralPath $tp) { $qcArgs += @("--transcript", $tp) }
}
& $node @qcArgs | Out-Host
if ($LASTEXITCODE -ne 0) { Write-Log "FAIL step2.5 qc exit=$LASTEXITCODE"; exit 3 }
Write-Log "ok step2.5 qc"

# ---------- step 3 : render ----------
$renderReport = Join-Path $episode "render-report.json"
& $node (Join-Path $skillZ "scripts\render_article.mjs") --in $articleMd --out $articleHtml `
  --template podcast-interview --report $renderReport | Out-Null
if ($LASTEXITCODE -ne 0) { Write-Log "FAIL step3 render exit=$LASTEXITCODE"; exit 4 }
Write-Log "ok step3 render -> $articleName"

# ---------- step 5 : covers ----------
function New-Cover {
  param([string]$SizeList, [string]$ArtFile)
  $a = @((Join-Path $skillZ "scripts\make_social_cover.mjs"),
         "--name", $meta.slug,
         "--title", $meta.cover_title,
         "--out-dir", $episode,
         "--sizes", $SizeList)
  if ($meta.kicker) { $a += @("--kicker", $meta.kicker) }
  if ($meta.stat)   { $a += @("--stat", $meta.stat) }
  if ($meta.quote)  { $a += @("--quote", $meta.quote) }
  if ($ArtFile)     { $a += @("--art", $ArtFile) }
  & $node @a | Out-Null
  if ($LASTEXITCODE -ne 0) { Write-Log "FAIL step5 cover sizes=$SizeList exit=$LASTEXITCODE"; exit 4 }
}

# 插画：agent 只给 subject/motif，出图由脚本做（提示词里的 CRITICAL FACE REQUIREMENT 不允许手搓）
$defaultArtV = Join-Path $episode ("插画-{0}-竖版.png" -f $meta.slug)
$defaultArtS = Join-Path $episode ("插画-{0}-方版.png" -f $meta.slug)
$artV = ""
$artS = ""

if (-not $NoArt) {
  if ((Test-Path -LiteralPath $defaultArtV) -and (Test-Path -LiteralPath $defaultArtS)) {
    Write-Log "ok step5a art already exists"
  } elseif ($meta.art_subject) {
    $artArgs = @((Join-Path $skillZ "scripts\generate_art.mjs"), "--name", $meta.slug, "--out-dir", $episode, "--subject", $meta.art_subject)
    if ($meta.art_motif) { $artArgs += @("--motif", $meta.art_motif) }
    if ($meta.art_model) { $artArgs += @("--model", $meta.art_model) }
    & $node @artArgs | Out-Host
    if ($LASTEXITCODE -ne 0) { Write-Log "FAIL step5a art exit=$LASTEXITCODE"; exit 4 }
    Write-Log "ok step5a art generated"
  } else {
    Write-Log "step5a art skipped (run-meta.json 没有 art_subject)"
  }

  if ($meta.art_vertical) {
    $p = Join-Path $episode $meta.art_vertical
    if (Test-Path -LiteralPath $p) { $artV = $p }
  }
  if ($meta.art_square) {
    $p = Join-Path $episode $meta.art_square
    if (Test-Path -LiteralPath $p) { $artS = $p }
  }
  if (-not $artV -and (Test-Path -LiteralPath $defaultArtV)) { $artV = $defaultArtV }
  if (-not $artS -and (Test-Path -LiteralPath $defaultArtS)) { $artS = $defaultArtS }
  if (-not $artS) { $artS = $artV }
}

$wantH = $Sizes -split ',' -contains 'h'
$want34 = $Sizes -split ',' -contains '3x4'
$want11 = $Sizes -split ',' -contains '1x1'
$wantQ = $Sizes -split ',' -contains 'quote'

if ($wantH)  { New-Cover -SizeList "h"     -ArtFile $artV }
if ($want34) { New-Cover -SizeList "3x4"   -ArtFile $artV }
if ($want11) { New-Cover -SizeList "1x1"   -ArtFile $artS }
if ($wantQ)  { New-Cover -SizeList "quote" -ArtFile "" }
Write-Log "ok step5 covers art=$([bool]$artV)"

# ---------- face check ----------
$faceJson = Join-Path $episode "face-report.json"
& $python (Join-Path $skillZ "scripts\check_art_faces.py") $episode --json $faceJson | Out-Host
if ($LASTEXITCODE -ne 0) { Write-Log "FAIL face check exit=$LASTEXITCODE"; exit 5 }
Write-Log "ok face check"

# ---------- step 8 : push draft ----------
$coverHorizontal = Join-Path $episode ("封面-{0}-横版.png" -f $meta.slug)
$pushScript = Join-Path $skillZ "scripts\push_to_wechat_draft.mjs"
$mediaId = ""

if ($SkipPush) {
  Write-Log "skip step8 push (SkipPush)"
} else {
  & $node $pushScript --check | Out-Host
  if ($LASTEXITCODE -ne 0) { Write-Log "FAIL step8 token check exit=$LASTEXITCODE"; exit 6 }

  & $node $pushScript --html $articleHtml --title $meta.title --digest $meta.digest `
    --cover $coverHorizontal --dry-run | Out-Host
  if ($LASTEXITCODE -ne 0) { Write-Log "FAIL step8 dry-run exit=$LASTEXITCODE"; exit 6 }

  $pushRaw = & $node $pushScript --html $articleHtml --title $meta.title --digest $meta.digest `
    --cover $coverHorizontal
  $pushExit = $LASTEXITCODE
  $pushRaw | Out-Host
  if ($pushExit -ne 0) { Write-Log "FAIL step8 push exit=$pushExit"; exit 6 }
  $mediaId = ($pushRaw -join "`n" | ConvertFrom-Json).media_id
  Write-Log "ok step8 push media_id=$mediaId"
}

# ---------- record ----------
$draftPath = Join-Path $episode "draft.json"
if (Test-Path -LiteralPath $draftPath) {
  $old = Get-Content -LiteralPath $draftPath -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($old.media_id -and $old.media_id -ne $mediaId) {
    Add-Content -LiteralPath $toDelete -Value ("{0} | {1} | replaced by {2}" -f $old.media_id, $Slug, $mediaId) -Encoding UTF8
  }
}
Write-Json -Path $draftPath -Object ([ordered]@{
  slug = $meta.slug
  media_id = $mediaId
  title = $meta.title
  digest = $meta.digest
  pushed_at = (Get-Date -Format o)
})

if ($mediaId -and (Test-Path -LiteralPath $master)) {
  $m = Get-Content -LiteralPath $master -Raw -Encoding UTF8 | ConvertFrom-Json
  $items = @()
  if ($m.items) { $items = @($m.items | Where-Object { $_.video_id -ne $meta.video_id -and $_.slug -ne $meta.slug }) }
  $items += [pscustomobject][ordered]@{
    video_id = $meta.video_id
    slug = $meta.slug
    title = $meta.title
    source = $meta.source_show
    published_at = $meta.published_at
    done_at = (Get-Date -Format o)
    draft_media_id = $mediaId
  }
  Write-Json -Path $master -Object ([ordered]@{
    version = 1
    note = "Published video registry. Read by step 0.5 for de-duplication."
    updatedAt = (Get-Date -Format o)
    items = $items
  })
}

$summary = "slug={0} title={1} media_id={2} pushed={3}" -f $meta.slug, $meta.title, $mediaId, (-not $SkipPush)
[IO.File]::WriteAllText($lastMsg, $summary, $utf8NoBom)
Write-Log "done $summary"
