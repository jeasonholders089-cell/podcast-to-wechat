<#
  publish-episode.ps1
  Deterministic half of the pipeline: QC -> render -> covers -> face check -> push draft.
  Reads <episode>/run-meta.json, which the agent phase is required to write.

  Usage:
    powershell -File publish-episode.ps1 -Slug <slug> [-SkipPush] [-NoArt] [-SkipImageNote]
    powershell -File publish-episode.ps1 -Slug <slug> -ImageNoteOnly      # 只重出图文笔记
    powershell -File publish-episode.ps1 -Slug <slug> -StickerOnly       # 只推图片消息（贴图）草稿

  Exit codes: 0 ok / 2 bad input / 3 qc failed / 4 render failed / 5 face check failed / 6 push failed / 7 image note failed
#>
param(
  [Parameter(Mandatory = $true)][string]$Slug,
  [string]$Root = "D:\项目\AI内容生产",
  [string]$SkillsRoot = "",
  [string]$Sizes = "h,3x4,1x1,quote",
  [switch]$SkipPush,
  [switch]$NoArt,
  [switch]$SkipImageNote,
  [switch]$ImageNoteOnly,
  [switch]$StickerOnly
)

$ErrorActionPreference = "Stop"

# 脚本现在住在 skill 里：默认按自己的位置反推 skills 根目录，也可以显式传 -SkillsRoot
if ([string]::IsNullOrWhiteSpace($SkillsRoot)) {
  $SkillsRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
}

$outRoot  = Join-Path $Root "公众号产出"
$episode  = Join-Path $outRoot $Slug
$folderMapPath = Join-Path $outRoot "folder-map.json"
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

# 历史期目录已按公众号标题命名：slug 找不到时回落到 folder-map.json
function Resolve-EpisodeDir {
  param([string]$SlugValue, [string]$Default)
  if (Test-Path -LiteralPath $Default) { return $Default }
  if (-not (Test-Path -LiteralPath $folderMapPath)) { return $Default }
  try {
    $map = Get-Content -LiteralPath $folderMapPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $hit = @($map.items | Where-Object { $_.slug -eq $SlugValue }) | Select-Object -First 1
    if ($hit -and $hit.folder) {
      $candidate = Join-Path $outRoot $hit.folder
      if (Test-Path -LiteralPath $candidate) { return $candidate }
    }
  } catch {}
  return $Default
}

function ConvertTo-FolderName {
  param([string]$Title)
  $s = $Title.Trim()
  $s = $s -replace '[\\/:*?"<>|]', ' '
  $s = $s -replace '\s+', ' '
  $s = $s.Trim().TrimEnd('.')
  if ($s.Length -gt 80) { $s = $s.Substring(0, 80).TrimEnd() }
  return $s
}

function Rename-EpisodeToTitle {
  param([string]$Dir, [string]$SlugValue, [string]$Title)
  if ([string]::IsNullOrWhiteSpace($Title)) { return $Dir }
  $targetName = ConvertTo-FolderName -Title $Title
  if ([string]::IsNullOrWhiteSpace($targetName)) { return $Dir }
  $currentName = Split-Path -Leaf $Dir
  if ($currentName -eq $targetName) { return $Dir }
  $target = Join-Path $outRoot $targetName
  if (Test-Path -LiteralPath $target) {
    Write-Log "skip folder rename: target exists $targetName"
    return $Dir
  }
  try {
    Rename-Item -LiteralPath $Dir -NewName $targetName -ErrorAction Stop
    $mapItems = @()
    if (Test-Path -LiteralPath $folderMapPath) {
      try {
        $oldMap = Get-Content -LiteralPath $folderMapPath -Raw -Encoding UTF8 | ConvertFrom-Json
        $mapItems = @($oldMap.items | Where-Object { $_.slug -ne $SlugValue })
      } catch {}
    }
    $mapItems += [ordered]@{ slug = $SlugValue; title = $Title; folder = $targetName }
    Write-Json -Path $folderMapPath -Object ([ordered]@{
      updatedAt = (Get-Date -Format o)
      items = $mapItems
    })
    Write-Log "folder renamed -> $targetName"
    return $target
  } catch {
    Write-Log "WARN folder rename failed: $($_.Exception.Message)"
    return $Dir
  }
}

# ---------- step 9 : 图文笔记 ----------
# 每期必出：图文笔记\spec.json（图内文案）+ 正文-<slug>-图文笔记.md（配文，末行带公众号导流）。
# 缺任一份、或正文缺导流句 → 记 FAIL（不影响已经完成的推送，但本轮 exit 7）；缺插画 → 脚本自己跳过。
function Invoke-ImageNote {
  param([string]$FileSlug = $Slug)
  if ($SkipImageNote) { Write-Log "skip step9 图文笔记 (SkipImageNote)"; return $true }
  $noteDir = Join-Path $episode "图文笔记"
  $spec = Join-Path $noteDir "spec.json"
  if (-not (Test-Path -LiteralPath $spec)) {
    Write-Log "FAIL step9 图文笔记：缺少 图文笔记\spec.json（每期必出）"
    return $false
  }
  $noteMd = Join-Path $noteDir ("正文-" + $FileSlug + "-图文笔记.md")
  if (-not (Test-Path -LiteralPath $noteMd)) {
    Write-Log "FAIL step9 图文笔记：缺少 正文-$FileSlug-图文笔记.md（每期必出）"
    return $false
  }
  if ((Get-Content -LiteralPath $noteMd -Raw -Encoding UTF8) -notmatch "完整全文可在公众号") {
    Write-Log "FAIL step9 图文笔记：正文文案缺导流句「完整全文可在公众号：粽子AI世界查看」"
    return $false
  }
  $noteReport = Join-Path $noteDir "render-report.json"
  & $node (Join-Path $skillZ "scripts\make_image_note.mjs") --spec $spec --out-dir $noteDir --report $noteReport | Out-Host
  if ($LASTEXITCODE -ne 0) { Write-Log "FAIL step9 图文笔记 exit=$LASTEXITCODE"; return $false }
  $pages = 0
  if (Test-Path -LiteralPath $noteReport) {
    try { $pages = (Get-Content -LiteralPath $noteReport -Raw -Encoding UTF8 | ConvertFrom-Json).count } catch { $pages = 0 }
  }
  Write-Log "ok step9 图文笔记 pages=$pages"
  return $true
}

# ---------- step 9b : 贴图（图片消息）草稿 ----------
# 图文笔记出完图后，把同一套竖图推成公众号图片消息草稿；已有成功记录就跳过，避免重复。
function Invoke-StickerNote {
  param([string]$FileSlug = $Slug)
  if ($SkipPush) { Write-Log "skip step9b 贴图 (SkipPush)"; return $true }
  if ($SkipImageNote) { Write-Log "skip step9b 贴图 (SkipImageNote)"; return $true }
  $noteDir = Join-Path $episode "图文笔记"
  $imgs = @(Get-ChildItem -LiteralPath $noteDir -Filter "图文笔记-*.png" -ErrorAction SilentlyContinue)
  if ($imgs.Count -eq 0) { Write-Log "skip step9b 贴图：没有 图文笔记-*.png"; return $true }
  $pushJson = Join-Path $noteDir "push-result.json"
  if (Test-Path -LiteralPath $pushJson) {
    try {
      $prev = Get-Content -LiteralPath $pushJson -Raw -Encoding UTF8 | ConvertFrom-Json
      if ($prev.ok -and $prev.media_id) {
        Write-Log ("ok step9b 贴图 already pushed media_id={0}" -f $prev.media_id)
        return $true
      }
    } catch {}
  }
  & $node (Join-Path $skillZ "scripts\push_to_wechat_draft.mjs") --image-note $episode --out $pushJson | Out-Host
  if ($LASTEXITCODE -ne 0) { Write-Log "FAIL step9b 贴图 exit=$LASTEXITCODE"; return $false }
  $stickerId = ""
  if (Test-Path -LiteralPath $pushJson) {
    try { $stickerId = (Get-Content -LiteralPath $pushJson -Raw -Encoding UTF8 | ConvertFrom-Json).media_id } catch {}
  }
  Write-Log ("ok step9b 贴图 media_id={0}" -f $stickerId)
  return $true
}

# 出错必须留痕：任何未捕获异常都写进产线日志，避免「跑完却没日志」的黑盒
trap {
  Write-Log ("FAIL unhandled: {0} - {1}" -f $_.Exception.GetType().Name, $_.Exception.Message)
  exit 9
}

Write-Log ("enter slug={0} root={1}" -f $Slug, $Root)

$episode = Resolve-EpisodeDir -SlugValue $Slug -Default $episode

$node   = Resolve-Exe -Name "node"   -Fallbacks @("C:\Program Files\nodejs\node.exe")
$python = Resolve-Exe -Name "python" -Fallbacks @("C:\Program Files\Python314\python.exe")

if (-not (Test-Path -LiteralPath $episode)) { throw "episode dir not found: $episode" }

$metaPath = Join-Path $episode "run-meta.json"
if (-not (Test-Path -LiteralPath $metaPath)) { Write-Log "FAIL missing run-meta.json"; exit 2 }
$meta = Get-Content -LiteralPath $metaPath -Raw -Encoding UTF8 | ConvertFrom-Json

if ($ImageNoteOnly) {
  Write-Log "mode: 只重出图文笔记"
  if (Invoke-ImageNote -FileSlug $meta.slug) { exit 0 } else { exit 7 }
}
if ($StickerOnly) {
  Write-Log "mode: 只推图片消息（贴图）草稿"
  if (Invoke-StickerNote -FileSlug $meta.slug) { exit 0 } else { exit 7 }
}

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
$existingDraft = $null
$existingDraftPath = Join-Path $episode "draft.json"
if (-not $SkipPush -and (Test-Path -LiteralPath $existingDraftPath)) {
  try {
    $candidateDraft = Get-Content -LiteralPath $existingDraftPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($candidateDraft.media_id -and $candidateDraft.slug -eq $meta.slug -and $candidateDraft.title -eq $meta.title) {
      $existingDraft = $candidateDraft
    }
  } catch {}
}

if ($existingDraft) {
  $mediaId = $existingDraft.media_id
  Write-Log "reuse existing draft media_id=$mediaId"
} elseif ($SkipPush) {
  Write-Log "skip step8 push (SkipPush)"
} else {
  & $node $pushScript --check | Out-Host
  if ($LASTEXITCODE -ne 0) { Write-Log "FAIL step8 token check exit=$LASTEXITCODE"; exit 6 }

  & $node $pushScript --html $articleHtml --title $meta.title --digest $meta.digest `
    --cover $coverHorizontal --dry-run | Out-Host
  if ($LASTEXITCODE -ne 0) { Write-Log "FAIL step8 dry-run exit=$LASTEXITCODE"; exit 6 }

  # node 的 stdout 是 UTF-8，但 Windows PowerShell 5.1 在无控制台的计划任务里按 936 解码，
  # 中文会被解坏，ConvertFrom-Json 抛「未终止的字符串」（草稿其实已经创建，结果却没记上）。
  # 所以让 push 脚本额外把结果写成 UTF-8 文件，这里直接读文件。
  $pushJson = Join-Path $episode "push-result.json"
  if (Test-Path -LiteralPath $pushJson) { Remove-Item -LiteralPath $pushJson -Force -ErrorAction SilentlyContinue }
  $pushRaw = & $node $pushScript --html $articleHtml --title $meta.title --digest $meta.digest `
    --cover $coverHorizontal --out $pushJson
  $pushExit = $LASTEXITCODE
  $pushRaw | Out-Host
  if ($pushExit -ne 0) { Write-Log "FAIL step8 push exit=$pushExit"; exit 6 }
  if (Test-Path -LiteralPath $pushJson) {
    $pushText = [IO.File]::ReadAllText($pushJson, [Text.Encoding]::UTF8)
  } else {
    $pushText = ($pushRaw -join "`n")
  }
  $mediaId = ($pushText | ConvertFrom-Json).media_id
  if (-not $mediaId) { Write-Log "FAIL step8 push: 结果里没有 media_id"; exit 6 }
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

# ---------- step 9 : 图文笔记 ----------
$noteOk = Invoke-ImageNote -FileSlug $meta.slug
$noteState = "ok"
if (-not $noteOk) { $noteState = "failed" }

$stickerOk = Invoke-StickerNote -FileSlug $meta.slug
$stickerState = "ok"
if (-not $stickerOk) { $stickerState = "failed" }

$episode = Rename-EpisodeToTitle -Dir $episode -SlugValue $meta.slug -Title $meta.title

$summary = "slug={0} title={1} media_id={2} pushed={3} note={4} sticker={5}" -f $meta.slug, $meta.title, $mediaId, (-not $SkipPush), $noteState, $stickerState
[IO.File]::WriteAllText($lastMsg, $summary, $utf8NoBom)
Write-Log "done $summary"
if (-not $noteOk) { exit 7 }
