$ErrorActionPreference = "Stop"
$trackerDirectory = $PSScriptRoot
$configPath = Join-Path $trackerDirectory "config.ps1"
if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) {
  throw "Não encontrei config.ps1. Copie config.example.ps1 para config.ps1 e preencha os dados."
}
. $configPath

if (-not $SiteUrl -or -not $DeliverySecret -or -not $AgentId -or -not $ServerApiUrl -or -not $ServerApiUsername -or -not $ServerApiPassword -or $ServerNumber -notin @(1, 2)) {
  throw "config.ps1 está incompleto."
}
if (-not $PollSeconds) { $PollSeconds = 30 }
if ($PollSeconds -lt 15) { throw "PollSeconds deve ser de pelo menos 15 segundos." }

$statePath = Join-Path $trackerDirectory "activity-state.json"
$headers = @{ "X-Extreme-Delivery-Key" = $DeliverySecret; "X-Extreme-Delivery-Agent" = $AgentId }
$basic = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("$ServerApiUsername`:$ServerApiPassword"))
$serverHeaders = @{ Authorization = "Basic $basic"; Accept = "application/json" }

function Get-Field($Object, [string[]]$Names) {
  foreach ($name in $Names) {
    $property = $Object.PSObject.Properties[$name]
    if ($null -ne $property -and -not [string]::IsNullOrWhiteSpace([string]$property.Value)) { return [string]$property.Value }
  }
  return ""
}
function Read-Players {
  $base = $ServerApiUrl.TrimEnd('/')
  $response = Invoke-RestMethod -UseBasicParsing -Method Get -Uri "$base/v1/api/players" -Headers $serverHeaders
  $rows = if ($response -is [Array]) { $response } elseif ($response.players) { $response.players } elseif ($response.playerList) { $response.playerList } elseif ($response.data -is [Array]) { $response.data } else { @() }
  $byId = @{}
  foreach ($row in $rows) {
    $playerId = Get-Field $row @('playerId', 'player_id', 'uid')
    $name = Get-Field $row @('name', 'playerName', 'nickname', 'nickName')
    if ($playerId -match '^[A-Za-z0-9_:-]{1,180}$' -and $name) { $byId[$playerId] = @{ playerId = $playerId; name = $name.Substring(0, [Math]::Min(80, $name.Length)) } }
  }
  return $byId
}
function Load-State {
  if (-not (Test-Path -LiteralPath $statePath -PathType Leaf)) { return $null }
  try {
    $raw = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
    $result = @{}
    foreach ($player in @($raw.players)) {
      if ($player.playerId -and $player.name) { $result[[string]$player.playerId] = @{ playerId = [string]$player.playerId; name = [string]$player.name } }
    }
    return $result
  } catch { Write-Warning "Estado anterior inválido; será recriado."; return $null }
}
function Save-State($Players) {
  $content = @{ savedAt = [DateTime]::UtcNow.ToString('o'); players = @($Players.Values) } | ConvertTo-Json -Depth 4
  $temporary = "$statePath.tmp"
  [IO.File]::WriteAllText($temporary, $content, [Text.UTF8Encoding]::new($false))
  Move-Item -LiteralPath $temporary -Destination $statePath -Force
}
function Submit-Activity($Current, $Previous) {
  $joins = @()
  $leaves = @()
  if ($null -ne $Previous) {
    foreach ($id in $Current.Keys) { if (-not $Previous.ContainsKey($id)) { $joins += $Current[$id] } }
    foreach ($id in $Previous.Keys) { if (-not $Current.ContainsKey($id)) { $leaves += $Previous[$id] } }
  }
  $body = @{ serverNumber = [int]$ServerNumber; players = @($Current.Values); joins = @($joins); leaves = @($leaves) } | ConvertTo-Json -Depth 5 -Compress
  $response = Invoke-RestMethod -UseBasicParsing -Method Post -Uri "$($SiteUrl.TrimEnd('/'))/api/palworld?mode=activity" -Headers $headers -ContentType "application/json" -Body $body
  Write-Host "[$([DateTime]::Now.ToString('HH:mm:ss'))] Servidor $ServerNumber: $($response.online) online · +$($response.joins) / -$($response.leaves)"
}

$previous = Load-State
Write-Host "Rastreador de atividade iniciado para servidor $ServerNumber. Consulta a cada $PollSeconds segundos."
while ($true) {
  try {
    $current = Read-Players
    Submit-Activity $current $previous
    Save-State $current
    $previous = $current
  } catch {
    Write-Warning ("Rastreador: " + $_.Exception.Message)
  }
  Start-Sleep -Seconds $PollSeconds
}
