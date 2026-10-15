@echo off
rem Starts the local QA server for the "עלונים (בדיקה)" plugin copy (real catalog, files proxied from the sources on click).
cd /d "%~dp0\..\.."
node tools\qa\qa-server.mjs --proxy --port 39811
