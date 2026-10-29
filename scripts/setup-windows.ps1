<#
.SYNOPSIS
  One-time setup of a Windows PC for Flag Clash development.

.DESCRIPTION
  Installs whatever is missing (Git, Node.js LTS, Rust, the Visual Studio C++ build tools and WebView2) with
  winget, then installs the project's npm packages. Anything already installed is skipped, so it is safe to
  run again.

  Run it from the repository folder:
    powershell -ExecutionPolicy Bypass -File scripts\setup-windows.ps1
#>
$ErrorActionPreference = 'Stop'

function Update-SessionPath {
  $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
  $user = [Environment]::GetEnvironmentVariable('Path', 'User')
  $env:Path = "$machine;$user;$env:USERPROFILE\.cargo\bin"
}

function Test-Command($name) {
  [bool](Get-Command $name -ErrorAction SilentlyContinue)
}

function Install-WingetPackage($id, [string[]]$extra = @()) {
  Write-Host "  Installing $id (this can take a few minutes)..." -ForegroundColor Cyan
  winget install --id $id --exact --silent --accept-source-agreements --accept-package-agreements @extra
  if ($LASTEXITCODE -ne 0) { Write-Host "  winget finished with code $LASTEXITCODE, checking anyway." -ForegroundColor Yellow }
  Update-SessionPath
}

function Step($text) { Write-Host "`n> $text" -ForegroundColor White }
function Ok($text) { Write-Host "  OK  $text" -ForegroundColor Green }

if (-not (Test-Command winget)) {
  throw 'winget is missing. Install "App Installer" from the Microsoft Store, then run this script again.'
}
if (-not (Test-Path (Join-Path $PSScriptRoot '..\package.json'))) {
  throw 'Run this script from inside the battle-world repository (scripts\setup-windows.ps1).'
}
Update-SessionPath

Step 'Git'
if (-not (Test-Command git)) { Install-WingetPackage 'Git.Git' }
if (-not (Test-Command git)) { throw 'Git did not install. Install it from https://git-scm.com and run again.' }
Ok (git --version)

Step 'Node.js 20 or newer'
$nodeMajor = 0
if (Test-Command node) { $nodeMajor = [int]((node --version).TrimStart('v').Split('.')[0]) }
if ($nodeMajor -lt 20) {
  Install-WingetPackage 'OpenJS.NodeJS.LTS'
  $nodeMajor = [int]((node --version).TrimStart('v').Split('.')[0])
}
if ($nodeMajor -lt 20) { throw 'Node.js 20+ is needed. Install the LTS from https://nodejs.org and run again.' }
Ok "node $(node --version), npm $(npm --version)"

Step 'Visual Studio C++ build tools (needed by Rust on Windows)'
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
function Test-Msvc {
  if (-not (Test-Path $vswhere)) { return $false }
  $found = & $vswhere -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
  return [bool]$found
}
if (-not (Test-Msvc)) {
  Install-WingetPackage 'Microsoft.VisualStudio.2022.BuildTools' @(
    '--override',
    '--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended'
  )
}
if (-not (Test-Msvc)) {
  throw 'The C++ build tools did not install. Open "Visual Studio Installer", add "Desktop development with C++", then run again.'
}
Ok 'MSVC build tools found'

Step 'Rust'
if (-not (Test-Command rustup)) { Install-WingetPackage 'Rustlang.Rustup' }
if (-not (Test-Command rustup)) { throw 'Rust did not install. Install it from https://rustup.rs and run again.' }
rustup default stable | Out-Null
Ok (rustc --version)

Step 'WebView2 runtime'
$webview2 = '{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
$hasWebView2 = (Test-Path "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\$webview2") -or
  (Test-Path "HKCU:\SOFTWARE\Microsoft\EdgeUpdate\Clients\$webview2")
if (-not $hasWebView2) { Install-WingetPackage 'Microsoft.EdgeWebView2Runtime' }
Ok 'WebView2 present'

Step 'npm packages'
Push-Location (Join-Path $PSScriptRoot '..')
try {
  npm ci
  if ($LASTEXITCODE -ne 0) { throw 'npm ci failed (see the output above).' }
} finally {
  Pop-Location
}
Ok 'Installed'

Write-Host "`nAll set. Next:" -ForegroundColor Green
Write-Host '  npm run desktop:dev     run the app with hot reload (the first run compiles Rust, about 5 minutes)'
Write-Host '  npm run desktop:build   build the installer into src-tauri\target\release\bundle\nsis'
Write-Host '  npm test                run the tests'
Write-Host "`nIf a command is not found, close this window and open a new terminal so it picks up the new PATH."
