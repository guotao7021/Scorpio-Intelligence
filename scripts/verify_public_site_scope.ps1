param(
  [string]$BaseRef = "HEAD",
  [string]$PathspecRoot = "README.md",
  [string]$PublicRoot = "docs/public",
  [string]$WorkflowPath = ".github/workflows/public-site.yml",
  [string]$IssueTemplatePath = ".github/ISSUE_TEMPLATE"
)

$ErrorActionPreference = "Stop"

$allowed = @(
  $PathspecRoot,
  $PublicRoot,
  $WorkflowPath,
  $IssueTemplatePath
)

function Test-AllowedPath([string]$Path) {
  foreach ($prefix in $allowed) {
    if ($Path -eq $prefix) { return $true }
    if ($Path.StartsWith($prefix + "/")) { return $true }
    if ($Path.StartsWith($prefix + "\")) { return $true }
  }
  return $false
}

$changed = git diff --name-only $BaseRef -- | Where-Object { $_ -and $_.Trim() -ne "" }

if (-not $changed) {
  Write-Host "No changed paths detected relative to $BaseRef."
  exit 0
}

$violations = @()
foreach ($path in $changed) {
  if (-not (Test-AllowedPath $path)) {
    $violations += $path
  }
}

if ($violations.Count -gt 0) {
  Write-Error @"
Public-site scope check failed.
Allowed paths:
  - README.md
  - docs/public/**
  - .github/workflows/public-site.yml
  - .github/ISSUE_TEMPLATE/**

Unexpected paths:
$(($violations | ForEach-Object { "  - $_" }) -join "`n")
"@
  exit 1
}

Write-Host "Public-site scope check passed."
