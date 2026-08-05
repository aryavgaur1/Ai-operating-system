# Nexora Notion OAuth tunnel helper (run in PowerShell)
$cf = "C:\Program Files (x86)\cloudflared\cloudflared.exe"
if (-not (Test-Path $cf)) { throw "cloudflared not found" }
Write-Host "1) In Chrome: Settings > Privacy > Security > Use secure DNS > Cloudflare"
Write-Host "2) Starting tunnel to http://127.0.0.1:4000 ..."
& $cf tunnel --url http://127.0.0.1:4000 --protocol http2
