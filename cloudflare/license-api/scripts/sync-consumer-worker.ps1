param(
    [string]$MirrorPath = 'D:\dev\stock\cloudflare\license-api',
    [switch]$Apply,
    [string]$ExpectedMirrorFingerprint
)

$ErrorActionPreference = 'Stop'
$sourceRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$mirrorRoot = [IO.Path]::GetFullPath($MirrorPath)
if (-not (Test-Path -LiteralPath $mirrorRoot -PathType Container)) {
    throw "Worker mirror directory does not exist: $mirrorRoot"
}
if ($sourceRoot -eq $mirrorRoot) { throw 'Source and mirror must be different directories.' }

function Get-SourceFiles([string]$Root) {
    $result = @('package.json', 'wrangler.toml')
    foreach ($folder in @('src', 'test', 'migrations')) {
        $directory = Join-Path $Root $folder
        if (Test-Path -LiteralPath $directory) {
            $result += Get-ChildItem -LiteralPath $directory -Recurse -File |
                ForEach-Object { $_.FullName.Substring($Root.Length + 1) }
        }
    }
    return @($result | Sort-Object -Unique)
}

$mirrorFiles = Get-SourceFiles $mirrorRoot
$inventory = @($mirrorFiles | ForEach-Object {
    $path = Join-Path $mirrorRoot $_
    if (Test-Path -LiteralPath $path -PathType Leaf) { "$_ $((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash)" }
})
$hasher = [Security.Cryptography.SHA256]::Create()
try { $fingerprint = [Convert]::ToHexString($hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes(($inventory -join "`n")))) }
finally { $hasher.Dispose() }
Write-Output "Mirror fingerprint: $fingerprint"

$sourceFiles = Get-SourceFiles $sourceRoot
$mirrorOnlyModules = @($mirrorFiles | Where-Object { $_ -like 'src\*' -and $_ -notin $sourceFiles })
if ($mirrorOnlyModules.Count) {
    throw "The mirror contains modules absent from this checkout. Reconcile them first: $($mirrorOnlyModules -join ', ')"
}
if ($Apply -and $ExpectedMirrorFingerprint -ne $fingerprint) {
    throw 'Refusing to overwrite an unreviewed or changed mirror. Review dry-run differences, then provide -ExpectedMirrorFingerprint with its exact fingerprint.'
}

$differences = @()
foreach ($relativePath in $sourceFiles) {
    $from = [IO.Path]::GetFullPath((Join-Path $sourceRoot $relativePath))
    $to = [IO.Path]::GetFullPath((Join-Path $mirrorRoot $relativePath))
    if (-not $to.StartsWith($mirrorRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Mirror path escaped its root.' }
    if (-not (Test-Path -LiteralPath $from -PathType Leaf)) { throw "Missing source: $relativePath" }
    $same = (Test-Path -LiteralPath $to -PathType Leaf) -and
        ((Get-FileHash -LiteralPath $from).Hash -eq (Get-FileHash -LiteralPath $to).Hash)
    if ($same) { continue }
    $differences += $relativePath
    if ($Apply) {
        New-Item -ItemType Directory -Path (Split-Path -Parent $to) -Force | Out-Null
        Copy-Item -LiteralPath $from -Destination $to -Force
        Write-Output "SYNC $relativePath"
    } else { Write-Output "DIFF $relativePath" }
}
Write-Output "$($differences.Count) differing file(s). No files are deleted; database migrations and deployment are never executed."
