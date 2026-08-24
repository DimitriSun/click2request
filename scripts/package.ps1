$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$dist = Join-Path $root "dist"
New-Item -ItemType Directory -Force -Path $dist | Out-Null

$stamp = Get-Date -Format "yyyyMMdd-HHmm"
$zip = Join-Path $dist "click2request-$stamp.zip"

Compress-Archive -Path (Join-Path $root "manifest.json"), (Join-Path $root "src"), (Join-Path $root "icons") -DestinationPath $zip -Force
Write-Host "Packaged: $zip"
