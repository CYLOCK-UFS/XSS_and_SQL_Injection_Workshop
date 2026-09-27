@echo off
cd /d "C:\Users\Cliente HT\Documents\GitHub\XSS_and_SQL_Injection_Workshop"
start /b npm start
timeout /t 10
echo === CSS check ===
curl -s http://127.0.0.1:3000/css/lab.css | findstr /c:"--marca:" | findstr /c:"00793f"
if %errorlevel% equ 0 (echo CSS NOVO OK) else (echo CSS ANTIGO)
echo === Shield check ===
curl -s http://127.0.0.1:3000/img/escudo-liga.png -o nul -w "HTTP %%{http_code}  Size: %%{size_download} bytes\n"
echo === HTML check ===
curl -s http://127.0.0.1:3000/ | findstr /c:"topo__escudo"
if %errorlevel% equ 0 (echo HTML TEM ESCUDO) else (echo HTML SEM ESCUDO)
curl -s http://127.0.0.1:3000/ | findstr /c:"escudo-liga-32"
if %errorlevel% equ 0 (echo HTML TEM FAVICON LINK) else (echo HTML SEM FAVICON LINK)
taskkill /f /im node.exe >nul 2>&1
echo killed