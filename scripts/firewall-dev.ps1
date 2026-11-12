param(
  [string]$ElectronPath = '',
  [switch]$Elevated
)

$ErrorActionPreference = 'Stop'

if ($env:OS -ne 'Windows_NT') {
  Write-Host 'This script only applies to Windows.'
  exit 0
}

$root = Split-Path -Parent $PSScriptRoot

function Resolve-ElectronPath {
  Push-Location $root
  try {
    $resolved = & node -e "console.log(require('electron'))" 2>$null
    if ($LASTEXITCODE -eq 0 -and $resolved) {
      return $resolved.Trim()
    }
  } catch {
  } finally {
    Pop-Location
  }
  $candidate = Get-ChildItem -Path (Join-Path $root 'node_modules') -Filter electron.exe -Recurse -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if ($candidate) {
    return $candidate.FullName
  }
  return ''
}

if (-not $ElectronPath) {
  $ElectronPath = Resolve-ElectronPath
}

if (-not $ElectronPath -or -not (Test-Path -LiteralPath $ElectronPath)) {
  Write-Error 'Cannot find electron.exe. Run pnpm install first.'
  exit 1
}

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
$isAdmin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
  try {
    $arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" -ElectronPath `"$ElectronPath`" -Elevated"
    $process = Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList $arguments -Wait -PassThru
    exit $process.ExitCode
  } catch {
    Write-Error "Elevation was cancelled or failed: $($_.Exception.Message)"
    exit 1
  }
}

$netsh = Join-Path $env:SystemRoot 'System32\netsh.exe'
& $netsh advfirewall firewall delete rule name=all program="$ElectronPath" dir=in | Out-Null
& $netsh advfirewall firewall add rule name="lanpost-im-dev" dir=in action=allow program="$ElectronPath" enable=yes profile=any | Out-Null
if ($LASTEXITCODE -ne 0) {
  Write-Error "Failed to add the firewall rule (exit $LASTEXITCODE)."
  exit $LASTEXITCODE
}

Write-Host 'Allowed inbound connections for:'
Write-Host "  $ElectronPath"
Write-Host 'Rule name: lanpost-im-dev (all profiles, any protocol/port)'
exit 0
