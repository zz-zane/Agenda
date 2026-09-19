@echo off
cd /d "%~dp0.."
if exist ".venv\Scripts\python.exe" (
  ".venv\Scripts\python.exe" local_server.py %*
) else if exist "..\main-3\.venv\Scripts\python.exe" (
  "..\main-3\.venv\Scripts\python.exe" local_server.py %*
) else (
  py local_server.py %*
)
