# Mata qualquer processo Node antigo
Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force
Write-Host "Processos Node finalizados."