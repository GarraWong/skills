#Requires -Version 5.1
<#
.SYNOPSIS
  Create %USERPROFILE%\.freya\dev-db.credentials from the skill example if missing.
  Never overwrites an existing file. Never writes secrets.
#>
param(
    [string] $CredentialsFile = "$env:USERPROFILE\.freya\dev-db.credentials"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$example = Join-Path $PSScriptRoot "..\credentials.example"

if (-not (Test-Path -LiteralPath $example)) {
    throw "Example not found: $example"
}

$dir = Split-Path -Parent $CredentialsFile
if (-not (Test-Path -LiteralPath $dir)) {
    New-Item -ItemType Directory -Path $dir | Out-Null
}

if (Test-Path -LiteralPath $CredentialsFile) {
    Write-Output "Credentials file already exists: $CredentialsFile"
    Write-Output "Fill host/port/username/password locally. Do not overwrite from the example."
    exit 0
}

Copy-Item -LiteralPath $example -Destination $CredentialsFile
Write-Output "Created $CredentialsFile from credentials.example."
Write-Output "Edit that file: set port to your local SSM listen port, and set username/password."
Write-Output "Do not commit the file or paste secrets into chat."
