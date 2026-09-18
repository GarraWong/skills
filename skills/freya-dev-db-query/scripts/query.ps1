#Requires -Version 5.1
<#
.SYNOPSIS
  Run a read-oriented SQL query against Freya tenant PostgreSQL via a local SSM tunnel.

.EXAMPLE
  .\query.ps1 -TenantId 0 -DbKind rendition -Sql "SELECT id, status FROM pdf_rendition_task ORDER BY id DESC LIMIT 1"
#>
param(
    [Parameter(Mandatory = $true)]
    [string] $Sql,

    [string] $Database = "",

    [string] $TenantId = "0",

    [ValidateSet("rendition", "docs")]
    [string] $DbKind = "rendition",

    [ValidateSet("dev", "qa")]
    [string] $Environment = "dev",

    [string] $HostName = "",

    [int] $Port = 0,

    [int] $TcpTimeoutMs = 1000,

    [string] $JdbcJar = "$env:USERPROFILE\.m2\repository\org\postgresql\postgresql\42.7.12\postgresql-42.7.12.jar",

    [string] $CredentialsFile = "$env:USERPROFILE\.freya\dev-db.credentials"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$scriptStarted = [Diagnostics.Stopwatch]::StartNew()
$placeholderPattern = '(?i)^(REPLACE_ME|REPLACE_WITH_YOUR_LOCAL_PORT|<.*>)$'

function Test-ReadOnlySql([string] $Text) {
    $normalized = ($Text -replace '(--[^\n]*)', ' ') -replace '(/\*.*?\*/)', ' '
    if ($normalized -match '(?i)\b(INSERT|UPDATE|DELETE|MERGE|ALTER|DROP|TRUNCATE|CREATE|GRANT|REVOKE|CALL|COPY|VACUUM)\b') {
        throw "Refusing non-read SQL. Pass an explicit write workflow if the user confirmed a mutation."
    }
}

function Read-CredentialsMap([string] $Path) {
    $map = @{}
    if (-not (Test-Path -LiteralPath $Path)) {
        return $map
    }

    Get-Content -LiteralPath $Path | ForEach-Object {
        $line = $_.Trim()
        if (-not $line -or $line.StartsWith("#")) {
            return
        }
        $parts = $line -split "=", 2
        if ($parts.Count -eq 2) {
            $map[$parts[0].Trim().ToLowerInvariant()] = $parts[1].Trim()
        }
    }

    return $map
}

function Get-FieldValue([string] $Name, [string] $EnvValue, $FileMap, [string] $CliValue) {
    if ($CliValue) {
        return $CliValue
    }
    if ($EnvValue) {
        return $EnvValue
    }
    if ($FileMap.ContainsKey($Name) -and $FileMap[$Name]) {
        return [string] $FileMap[$Name]
    }
    return ""
}

function Assert-RealValue([string] $Label, [string] $Value) {
    if (-not $Value -or $Value -match $placeholderPattern) {
        throw @"
Missing or placeholder $Label.
Create or edit $CredentialsFile using credentials.example (scripts/init-config.ps1).
Required keys: host, port, username, password.
Env overrides: FREYA_DEV_DB_HOST, FREYA_DEV_DB_PORT, FREYA_DEV_DB_USER, FREYA_DEV_DB_PASSWORD.
Do not paste secrets into chat.
"@
    }
}

function Get-ConnectionConfig {
    $fileMap = Read-CredentialsMap -Path $CredentialsFile

    $cliHost = $HostName
    $cliPort = ""
    if ($Port -gt 0) {
        $cliPort = [string] $Port
    }

    $hostValue = Get-FieldValue -Name "host" -EnvValue $env:FREYA_DEV_DB_HOST -FileMap $fileMap -CliValue $cliHost
    $portValue = Get-FieldValue -Name "port" -EnvValue $env:FREYA_DEV_DB_PORT -FileMap $fileMap -CliValue $cliPort
    $username = Get-FieldValue -Name "username" -EnvValue $env:FREYA_DEV_DB_USER -FileMap $fileMap -CliValue ""
    $password = Get-FieldValue -Name "password" -EnvValue $env:FREYA_DEV_DB_PASSWORD -FileMap $fileMap -CliValue ""

    Assert-RealValue -Label "host" -Value $hostValue
    Assert-RealValue -Label "port" -Value $portValue
    Assert-RealValue -Label "username" -Value $username
    Assert-RealValue -Label "password" -Value $password

    $portNumber = 0
    if (-not [int]::TryParse($portValue, [ref] $portNumber) -or $portNumber -le 0 -or $portNumber -gt 65535) {
        throw "port must be an integer 1-65535 in the credentials file or FREYA_DEV_DB_PORT. Got: $portValue"
    }

    return @{
        HostName = $hostValue
        Port     = $portNumber
        Username = $username
        Password = $password
    }
}

function Resolve-DatabaseName {
    if ($Database) {
        return $Database
    }

    $prefixes = @{
        "dev:rendition" = "docs_rendition_dev_tenant_"
        "dev:docs"      = "docs_dev_tenant_"
        "qa:rendition"  = "docs_rendition_qa_tenant_"
        "qa:docs"       = "docs_qa_tenant_"
    }

    $key = "${Environment}:${DbKind}"
    if (-not $prefixes.ContainsKey($key)) {
        throw "Unsupported environment/db kind: $key"
    }

    return $prefixes[$key] + $TenantId
}

function Test-TcpOpen([string] $TargetHost, [int] $TargetPort, [int] $TimeoutMs) {
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $async = $client.BeginConnect($TargetHost, $TargetPort, $null, $null)
        if (-not $async.AsyncWaitHandle.WaitOne($TimeoutMs, $false)) {
            return $false
        }
        $client.EndConnect($async)
        return $client.Connected
    }
    catch {
        return $false
    }
    finally {
        $client.Close()
    }
}

function Write-Utf8NoBom([string] $Path, [string] $Content) {
    [System.IO.File]::WriteAllText($Path, $Content, [System.Text.UTF8Encoding]::new($false))
}

function Get-CachedQueryClass([string] $JavaSourcePath) {
    $classDir = Join-Path $env:USERPROFILE ".freya\db-query-classes"
    $classFile = Join-Path $classDir "QueryMain.class"
    if (-not (Test-Path -LiteralPath $classDir)) {
        New-Item -ItemType Directory -Path $classDir | Out-Null
    }

    $sourceTime = (Get-Item -LiteralPath $JavaSourcePath).LastWriteTimeUtc
    $classFresh = (Test-Path -LiteralPath $classFile) -and ((Get-Item -LiteralPath $classFile).LastWriteTimeUtc -ge $sourceTime)
    if ($classFresh) {
        return @{ Dir = $classDir; Compiled = $false }
    }

    $javac = Get-Command javac -ErrorAction SilentlyContinue
    if (-not $javac) {
        throw "QueryMain.class cache is stale or missing and javac is not on PATH. Need javac once to compile $JavaSourcePath"
    }

    & $javac.Source -d $classDir $JavaSourcePath
    if ($LASTEXITCODE -ne 0) {
        throw "javac failed with exit code $LASTEXITCODE"
    }
    return @{ Dir = $classDir; Compiled = $true }
}

Test-ReadOnlySql -Text $Sql

$conn = Get-ConnectionConfig
$targetDatabase = Resolve-DatabaseName

$preflightStarted = [Diagnostics.Stopwatch]::StartNew()
if (-not (Test-TcpOpen -TargetHost $conn.HostName -TargetPort $conn.Port -TimeoutMs $TcpTimeoutMs)) {
    throw @"
Local tunnel is not reachable at $($conn.HostName):$($conn.Port) within ${TcpTimeoutMs}ms.
Start the AWS SSM port-forward yourself with localPortNumber matching this port.
Do not ask the agent to create the tunnel.
"@
}
$preflightMs = $preflightStarted.ElapsedMilliseconds

if (-not (Test-Path -LiteralPath $JdbcJar)) {
    throw "PostgreSQL JDBC jar not found: $JdbcJar. Run a Maven build that resolves org.postgresql:postgresql:42.7.12 first."
}

$java = Get-Command java -ErrorAction SilentlyContinue
if (-not $java) {
    throw "java not found on PATH."
}

$javaSource = Join-Path $PSScriptRoot "QueryMain.java"
if (-not (Test-Path -LiteralPath $javaSource)) {
    throw "QueryMain.java not found: $javaSource"
}

$compileStarted = [Diagnostics.Stopwatch]::StartNew()
$cached = Get-CachedQueryClass -JavaSourcePath $javaSource
$compileMs = $compileStarted.ElapsedMilliseconds

$env:FREYA_DEV_DB_USER = $conn.Username
$env:FREYA_DEV_DB_PASSWORD = $conn.Password

$tempDir = Join-Path ([System.IO.Path]::GetTempPath()) ("freya-dev-db-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $tempDir | Out-Null
$sqlFile = Join-Path $tempDir "query.sql"

try {
    Write-Utf8NoBom -Path $sqlFile -Content $Sql

    $jdbcUrl = "jdbc:postgresql://$($conn.HostName):$($conn.Port)/${targetDatabase}?connectTimeout=5&socketTimeout=60"
    Write-Output "Connecting $($conn.HostName):$($conn.Port)/$targetDatabase"
    & $java.Source -cp "$($cached.Dir);$JdbcJar" QueryMain $sqlFile $jdbcUrl
    if ($LASTEXITCODE -ne 0) {
        throw "java query failed with exit code $LASTEXITCODE"
    }
}
finally {
    Remove-Item Env:FREYA_DEV_DB_USER, Env:FREYA_DEV_DB_PASSWORD -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $tempDir -Recurse -Force -ErrorAction SilentlyContinue
}

$compiledLabel = if ($cached.Compiled) { "yes" } else { "no" }
Write-Output "SCRIPT_MS=preflight=$preflightMs compile=$compileMs compiled=$compiledLabel total=$($scriptStarted.ElapsedMilliseconds)"
