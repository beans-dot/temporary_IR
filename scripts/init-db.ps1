# 이 PC에 설치된 PostgreSQL에 IR 대시보드용 역할과 데이터베이스를 만든다.
#
#   $env:POSTGRES_SUPER_PASSWORD = "<postgres 슈퍼유저 비밀번호>"
#   npm run db:init
#
# 슈퍼유저 비밀번호는 -SuperPassword 로 넘겨도 된다.

param(
  [string]$SuperUser = "postgres",
  [string]$SuperPassword = $env:POSTGRES_SUPER_PASSWORD,
  [string]$EnvFile = ""
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
if (-not $EnvFile) {
  $EnvFile = Join-Path $root ".env"
}

function Read-DotEnv([string]$Path) {
  $map = @{}
  if (-not (Test-Path $Path)) { return $map }
  foreach ($raw in Get-Content -Path $Path) {
    $line = $raw.Trim()
    if ($line.Length -eq 0 -or $line.StartsWith("#")) { continue }
    $idx = $line.IndexOf("=")
    if ($idx -lt 1) { continue }
    $key = $line.Substring(0, $idx).Trim()
    $value = $line.Substring($idx + 1).Trim()
    $map[$key] = $value
  }
  return $map
}

function Assert-Ident([string]$Name, [string]$Label) {
  if ($Name -notmatch '^[A-Za-z_][A-Za-z0-9_]*$') {
    throw "$Label 값 '$Name' 은 영문/숫자/밑줄만 사용할 수 있습니다."
  }
}

$cfg = Read-DotEnv $EnvFile
$dbHost = if ($cfg.ContainsKey("DB_HOST") -and $cfg["DB_HOST"]) { $cfg["DB_HOST"] } else { "localhost" }
$dbPort = if ($cfg.ContainsKey("DB_PORT") -and $cfg["DB_PORT"]) { $cfg["DB_PORT"] } else { "5432" }
$dbUser = if ($cfg.ContainsKey("DB_USERNAME") -and $cfg["DB_USERNAME"]) { $cfg["DB_USERNAME"] } else { "ir_user" }
$dbPass = if ($cfg.ContainsKey("DB_PASSWORD")) { $cfg["DB_PASSWORD"] } else { "ir_password" }
$dbName = if ($cfg.ContainsKey("DB_DATABASE") -and $cfg["DB_DATABASE"]) { $cfg["DB_DATABASE"] } else { "ir_dashboard" }

if ($dbHost -eq "db") {
  throw "DB_HOST=db 는 이 PC의 PostgreSQL이 아닙니다. .env 의 DB_HOST 를 localhost 로 바꾸세요."
}
Assert-Ident $dbUser "DB_USERNAME"
Assert-Ident $dbName "DB_DATABASE"
if (-not $dbPass) {
  throw ".env 의 DB_PASSWORD 가 비어 있습니다."
}

$psqlCmd = Get-Command psql -ErrorAction SilentlyContinue
if ($psqlCmd) {
  $psql = $psqlCmd.Source
} else {
  $found = Get-ChildItem "C:\Program Files\PostgreSQL" -Filter psql.exe -Recurse -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if (-not $found) {
    throw "psql.exe 를 찾지 못했습니다. PostgreSQL을 설치한 뒤 다시 실행하세요. https://www.postgresql.org/download/windows/"
  }
  $psql = $found.FullName
}

if (-not $SuperPassword) {
  throw "PostgreSQL 슈퍼유저 비밀번호가 필요합니다. `$env:POSTGRES_SUPER_PASSWORD 를 설정하거나 -SuperPassword 로 전달하세요."
}

$service = Get-Service -Name "postgresql*" -ErrorAction SilentlyContinue | Select-Object -First 1
if ($service -and $service.Status -ne "Running") {
  Write-Host "PostgreSQL 서비스($($service.Name))를 시작합니다."
  Start-Service $service.Name
}

$env:PGPASSWORD = $SuperPassword
$sqlFile = Join-Path $PSScriptRoot "init-db.sql"

Write-Host "로컬 PostgreSQL ${dbHost}:${dbPort} 에 데이터베이스 '$dbName' / 역할 '$dbUser' 를 준비합니다."
& $psql -h $dbHost -p $dbPort -U $SuperUser -d postgres -v ON_ERROR_STOP=1 `
  -v "app_user=$dbUser" -v "app_password=$dbPass" -v "app_db=$dbName" `
  -f $sqlFile
if ($LASTEXITCODE -ne 0) {
  throw "psql 이 실패했습니다 (exit $LASTEXITCODE). 슈퍼유저 비밀번호와 DB_HOST/DB_PORT 를 확인하세요."
}

Remove-Item Env:PGPASSWORD
$env:PGPASSWORD = $dbPass
& $psql -h $dbHost -p $dbPort -U $dbUser -d $dbName -v ON_ERROR_STOP=1 -c "SELECT current_user, current_database();"
if ($LASTEXITCODE -ne 0) {
  throw "앱 계정으로 접속하지 못했습니다."
}
Remove-Item Env:PGPASSWORD

Write-Host "준비되었습니다. 다음으로 npm run dev 를 실행하세요."
