param(
    [string]$MirrorPath = 'D:\dev\stock\cloudflare\license-api',
    [switch]$Apply
)

$ErrorActionPreference = 'Stop'
$sourceRoot = Split-Path -Parent $PSScriptRoot
$mirrorRoot = [System.IO.Path]::GetFullPath($MirrorPath)
$files = @(
    'src\worker.js',
    'test\mobile-presentation.test.mjs',
    'test\admin-overview.test.mjs',
    'package.json',
    'wrangler.toml'
)

if (-not (Test-Path -LiteralPath $mirrorRoot -PathType Container)) {
    throw "Worker mirror directory does not exist: $mirrorRoot"
}

$differences = @()
foreach ($relativePath in $files) {
    $sourceFile = Join-Path $sourceRoot $relativePath
    $mirrorFile = Join-Path $mirrorRoot $relativePath
    if (-not (Test-Path -LiteralPath $sourceFile -PathType Leaf)) {
        throw "Canonical Worker file is missing: $sourceFile"
    }
    $same = (Test-Path -LiteralPath $mirrorFile -PathType Leaf) -and
        ((Get-FileHash -LiteralPath $sourceFile -Algorithm SHA256).Hash -eq (Get-FileHash -LiteralPath $mirrorFile -Algorithm SHA256).Hash)
    if ($same) {
        Write-Output "OK   $relativePath"
        continue
    }
    $differences += $relativePath
    if ($Apply) {
        $parent = Split-Path -Parent $mirrorFile
        if (-not (Test-Path -LiteralPath $parent -PathType Container)) {
            New-Item -ItemType Directory -Path $parent -Force | Out-Null
        }
        Copy-Item -LiteralPath $sourceFile -Destination $mirrorFile -Force
        Write-Output "SYNC $relativePath"
    } else {
        Write-Output "DIFF $relativePath"
    }
}

if ($differences.Count -and -not $Apply) {
    throw "Consumer Worker mirror is out of sync. Re-run with -Apply after reviewing the canonical website changes."
}

if ($Apply) {
    Write-Output "Synchronized $($differences.Count) consumer Worker file(s) from the website source."
} else {
    Write-Output 'Consumer Worker mirror is synchronized.'
}
