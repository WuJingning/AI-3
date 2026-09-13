# Save Coze credentials as Windows *user-level* environment variables.
#
# Usage : powershell -ExecutionPolicy Bypass -File scripts\set-env.ps1
#         or double-click scripts\set-env.cmd
# Undo  : Remove-ItemProperty -Path 'HKCU:\Environment' -Name COZE_API_TOKEN,COZE_WORKFLOW_ID,COZE_API_BASE
#
# The script reads the key from .env at runtime. It never contains the key itself.
# This file is intentionally ASCII-only: Windows PowerShell 5.1 reads .ps1 files using the
# system ANSI code page, and non-ASCII content without a BOM can break parsing there.

$ErrorActionPreference = 'Stop'

$rootDir = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $rootDir '.env'

if (-not (Test-Path $envFile)) {
    Write-Host "Cannot find: $envFile" -ForegroundColor Red
    Write-Host "Copy .env.example to .env and fill in COZE_API_TOKEN and COZE_WORKFLOW_ID first." -ForegroundColor Yellow
    exit 1
}

# Read as UTF-8 explicitly: Windows PowerShell 5.1 otherwise decodes the file with the
# system ANSI code page, which can corrupt non-ASCII comment lines in .env.
$text = Get-Content -Raw -Encoding UTF8 $envFile

function Read-Value([string]$name) {
    $pattern = '(?m)^\s*' + $name + '\s*=\s*(.+?)\s*$'
    $found = [regex]::Match($text, $pattern)
    if ($found.Success) { return $found.Groups[1].Value.Trim() }
    return ''
}

$token = Read-Value 'COZE_API_TOKEN'
$workflowId = Read-Value 'COZE_WORKFLOW_ID'
$apiBase = Read-Value 'COZE_API_BASE'

if ([string]::IsNullOrWhiteSpace($token)) {
    Write-Host 'COZE_API_TOKEN is empty in .env, nothing to save.' -ForegroundColor Red
    exit 1
}

[Environment]::SetEnvironmentVariable('COZE_API_TOKEN', $token, 'User')
if ($workflowId) { [Environment]::SetEnvironmentVariable('COZE_WORKFLOW_ID', $workflowId, 'User') }
if ($apiBase) { [Environment]::SetEnvironmentVariable('COZE_API_BASE', $apiBase, 'User') }

$stored = [Environment]::GetEnvironmentVariable('COZE_API_TOKEN', 'User')
$storedId = [Environment]::GetEnvironmentVariable('COZE_WORKFLOW_ID', 'User')
$preview = $stored.Substring(0, [Math]::Min(4, $stored.Length))

Write-Host ''
Write-Host 'Saved as user-level environment variables (registry: HKCU\Environment):' -ForegroundColor Green
Write-Host ('  COZE_API_TOKEN     length {0}, prefix {1}...' -f $stored.Length, $preview)
Write-Host ('  COZE_WORKFLOW_ID   {0}' -f $storedId)
Write-Host ''
Write-Host 'Next: close and reopen your terminal (or sign out and back in), then start the server.'
Write-Host 'Lookup order used by the app: process environment variable > project .env file.'
Write-Host ''
Write-Host "Undo: Remove-ItemProperty -Path 'HKCU:\Environment' -Name COZE_API_TOKEN,COZE_WORKFLOW_ID,COZE_API_BASE"
