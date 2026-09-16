@echo off
cd /d "%~dp0.."
call npm.cmd ci --prefix dsh --ignore-scripts --no-audit --no-fund
exit /b %errorlevel%
