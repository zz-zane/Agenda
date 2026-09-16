param([string]$Installer = 'dist/windows/Agenda-Setup-2.1.0-x64.exe')
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Set-Location -LiteralPath $root
$target = [IO.Path]::GetFullPath((Join-Path $root '.preview/installer-check'))
if (-not $target.StartsWith($root + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Install target outside workspace' }
if (Test-Path -LiteralPath $target) { throw 'Use a fresh test install directory' }
$existing = Get-ItemProperty 'HKCU:/Software/Microsoft/Windows/CurrentVersion/Uninstall/*' -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -eq 'Agenda' }
if ($existing) { throw 'An Agenda installation already exists; leave it untouched' }
foreach ($folder in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))) {
    if (Test-Path -LiteralPath (Join-Path $folder 'Agenda.lnk')) { throw 'An Agenda shortcut already exists; leave it untouched' }
}
function Run-Installer([string]$File, [string[]]$Arguments) {
    $process = Start-Process -FilePath $File -ArgumentList $Arguments -WindowStyle Hidden -PassThru
    if (-not $process.WaitForExit(600000)) { $process.Kill(); throw 'Installer timed out after ten minutes' }
    if ($process.ExitCode -ne 0) { throw "Installer failed: $($process.ExitCode)" }
}
$installerPath = (Resolve-Path -LiteralPath $Installer).Path
$application = Join-Path $target 'Agenda.exe'
$uninstaller = Join-Path $target 'Uninstall Agenda.exe'
try {
    Write-Output 'Installing into isolated directory...'
    Run-Installer $installerPath @('/S', "/D=$target")
    if (-not (Test-Path -LiteralPath $application)) { throw 'Installed executable missing' }
    if ((Get-FileHash -LiteralPath $application).Hash -ne (Get-FileHash -LiteralPath 'dist/windows/win-unpacked/Agenda.exe').Hash) { throw 'Installed application differs from packaged executable' }
    Write-Output 'Checking installed window...'
    & node scripts/check-desktop-window.mjs $application
    if ($LASTEXITCODE -ne 0) { throw 'Installed UI check failed' }
    $check = Get-Content -Raw -Encoding UTF8 '.preview/desktop-window-check.json' | ConvertFrom-Json
    $before = (Get-FileHash -LiteralPath $check.data).Hash
    Write-Output 'Checking reinstall...'
    Run-Installer $installerPath @('/S', "/D=$target")
    if ((Get-FileHash -LiteralPath $check.data).Hash -ne $before) { throw 'Reinstall changed data' }
    Write-Output 'Checking uninstall...'
    Run-Installer $uninstaller @('/S', "_?=$target")
    $deadline = (Get-Date).AddSeconds(30)
    while ((Test-Path -LiteralPath $application) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 200 }
    if (Test-Path -LiteralPath $application) { throw 'Uninstall did not remove the application' }
    if ((Get-FileHash -LiteralPath $check.data).Hash -ne $before) { throw 'Uninstall changed data' }
    $registration = Get-ItemProperty 'HKCU:/Software/Microsoft/Windows/CurrentVersion/Uninstall/*' -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -eq 'Agenda' }
    if ($registration) { throw 'Uninstall registration remains' }
    Write-Output 'PASS: silent per-user install, installed UI, reinstall retains isolated data, uninstall removes app and preserves data.'
} finally {
    if ((Test-Path -LiteralPath $application) -and (Test-Path -LiteralPath $uninstaller)) { Run-Installer $uninstaller @('/S', "_?=$target") }
}
