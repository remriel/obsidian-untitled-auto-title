param(
    [Parameter(Mandatory = $true)]
    [string]$VaultPath
)

$ErrorActionPreference = 'Stop'
$taskVaultRoot = (Resolve-Path -LiteralPath $VaultPath).Path
$taskConfigRoot = Join-Path $taskVaultRoot '.obsidian'
if (-not (Test-Path -LiteralPath $taskConfigRoot -PathType Container)) {
    throw 'This vault does not contain a .obsidian directory. Open it in Obsidian first.'
}

$taskReleaseRoot = Join-Path $PSScriptRoot 'untitled-auto-title'
if (Test-Path -LiteralPath (Join-Path $taskReleaseRoot 'manifest.json')) {
    $taskSourceRoot = $taskReleaseRoot
} else {
    $taskSourceRoot = Split-Path -Parent $PSScriptRoot
}
$taskManifest = Get-Content -LiteralPath (Join-Path $taskSourceRoot 'manifest.json') -Raw | ConvertFrom-Json
if ($taskManifest.id -ne 'untitled-auto-title') { throw 'The plugin manifest does not match this installer.' }

$taskPluginParent = Join-Path $taskConfigRoot 'plugins'
$taskPluginRoot = [IO.Path]::GetFullPath((Join-Path $taskPluginParent 'untitled-auto-title'))
$taskExpectedParent = [IO.Path]::GetFullPath($taskPluginParent).TrimEnd('\') + '\'
if (-not $taskPluginRoot.StartsWith($taskExpectedParent, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'The destination must remain inside this vault plugin directory.'
}
foreach ($taskRequiredFile in @('main.js', 'manifest.json', 'styles.css')) {
    if (-not (Test-Path -LiteralPath (Join-Path $taskSourceRoot $taskRequiredFile) -PathType Leaf)) {
        throw "Missing release file: $taskRequiredFile"
    }
}

$taskBackupRoot = $null
if (Test-Path -LiteralPath $taskPluginRoot) {
    $taskBackupRoot = Join-Path $env:TEMP ('untitled-auto-title-backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
    New-Item -ItemType Directory -Path $taskBackupRoot -Force | Out-Null
    foreach ($taskBackupFile in @('main.js', 'manifest.json', 'styles.css', 'data.json')) {
        $taskExistingFile = Join-Path $taskPluginRoot $taskBackupFile
        if (Test-Path -LiteralPath $taskExistingFile) {
            Copy-Item -LiteralPath $taskExistingFile -Destination (Join-Path $taskBackupRoot $taskBackupFile)
        }
    }
}

New-Item -ItemType Directory -Path $taskPluginRoot -Force | Out-Null
foreach ($taskRequiredFile in @('main.js', 'manifest.json', 'styles.css')) {
    $taskSourceFile = Join-Path $taskSourceRoot $taskRequiredFile
    $taskInstalledFile = Join-Path $taskPluginRoot $taskRequiredFile
    Copy-Item -LiteralPath $taskSourceFile -Destination $taskInstalledFile -Force
    if ((Get-FileHash -LiteralPath $taskSourceFile -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath $taskInstalledFile -Algorithm SHA256).Hash) {
        throw "Installed file verification failed: $taskRequiredFile"
    }
}

$taskEnabledPath = Join-Path $taskConfigRoot 'community-plugins.json'
$taskEnabledPlugins = @()
if (Test-Path -LiteralPath $taskEnabledPath) {
    $taskEnabledPlugins = @(Get-Content -LiteralPath $taskEnabledPath -Raw | ConvertFrom-Json)
    if ($taskBackupRoot) {
        Copy-Item -LiteralPath $taskEnabledPath -Destination (Join-Path $taskBackupRoot 'community-plugins.json') -Force
    }
}
if ($taskEnabledPlugins -notcontains 'untitled-auto-title') {
    $taskEnabledPlugins += 'untitled-auto-title'
    $taskEncoded = ConvertTo-Json -InputObject @($taskEnabledPlugins)
    [IO.File]::WriteAllText($taskEnabledPath, $taskEncoded + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
}

[PSCustomObject]@{
    Plugin = $taskManifest.name
    Version = $taskManifest.version
    InstalledTo = $taskPluginRoot
    Backup = $taskBackupRoot
    Enabled = $true
    CredentialsCopied = $false
    NextStep = 'Restart Obsidian to load the plugin.'
} | ConvertTo-Json
