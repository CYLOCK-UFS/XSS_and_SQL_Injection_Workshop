@echo off
cd /d "C:\Users\Cliente HT\Documents\GitHub\XSS_and_SQL_Injection_Workshop"
start /b npm start
timeout /t 5
node screenshot-check.js