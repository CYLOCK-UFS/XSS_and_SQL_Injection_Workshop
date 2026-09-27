# test-server.ps1 — sobe, valida, derruba
cd "C:\Users\Cliente HT\Documents\GitHub\XSS_and_SQL_Injection_Workshop"

$server = Start-Process powershell -ArgumentList "-NoProfile -Command Set-Location 'C:\Users\Cliente HT\Documents\GitHub\XSS_and_SQL_Injection_Workshop'; npm start" -PassThru
Write-Host "Servidor iniciado (PID $($server.Id)), aguardando 10s..."
Start-Sleep 10

try {
  $r = Invoke-WebRequest "http://127.0.0.1:3000/css/lab.css" -UseBasicParsing -ErrorAction Stop
  $cssOk = $r.Content -match '--marca:\s*#00793f' -and $r.Content -match 'topo::before'
  Write-Host "CSS novo servido: $cssOk"

  $r = Invoke-WebRequest "http://127.0.0.1:3000/img/escudo-liga.png" -UseBasicParsing -ErrorAction Stop
  Write-Host "Escudo servido: $($r.Content.Length) bytes"

  $r = Invoke-WebRequest "http://127.0.0.1:3000/" -UseBasicParsing -ErrorAction Stop
  Write-Host "HTML tem escudo: $($r.Content -match 'topo__escudo')"
  Write-Host "HTML tem favicon: $($r.Content -match 'escudo-liga-32')"
}
catch {
  Write-Host "ERRO: $($_.Exception.Message)"
  Write-Host "Status: $($_.Exception.Response.StatusCode.value__)"
}
finally {
  if ($server -and -not $server.HasExited) { $server.Kill(); Write-Host "Servidor finalizado." }
}