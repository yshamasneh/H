# JOVO restore test. Run in YOUR PowerShell, after setting the READ-ONLY B2 key in this session only:
#   $env:BACKUP_S3_ACCESS_KEY_ID     = "<reader keyID>"
#   $env:BACKUP_S3_SECRET_ACCESS_KEY = "<reader applicationKey>"
#   powershell -ExecutionPolicy Bypass -File C:\Users\hp\jovo-restore-test.ps1
# It restores the newest backup into a throwaway local PostgreSQL 18 database, compares every table's
# row count with the counts recorded at backup time, writes the restored counts (no secrets) to
# C:\Users\hp\jovo-restore-counts.txt, and removes the containers. Nothing secret is printed.
$ErrorActionPreference = "Stop"
$identity = "C:\Users\hp\jovo-backup.agekey"
$repo = "C:\Users\hp\H"
if (-not $env:BACKUP_S3_ACCESS_KEY_ID -or -not $env:BACKUP_S3_SECRET_ACCESS_KEY) { throw "Set the reader key variables in this session first." }
if (-not (Test-Path $identity)) { throw "age identity not found at $identity" }

$env:BACKUP_S3_ENDPOINT = "https://s3.eu-central-003.backblazeb2.com"
$env:BACKUP_S3_REGION = "eu-central-003"
$env:BACKUP_S3_BUCKET = "jovo-db-backups-x7k2m9"
$env:BACKUP_S3_PREFIX = "jovo"
$scratchPassword = -join ((48..57) + (97..122) | Get-Random -Count 32 | ForEach-Object { [char]$_ })
$env:RESTORE_TEST_DATABASE_URL = "postgresql://postgres:$scratchPassword@jovo-restore-scratch:5432/jovo_restore_scratch"

docker build -q -t jovo-backup "$repo\deploy\railway\backup" | Out-Null
docker network create jovo-restore-net | Out-Null
try {
  docker run -d --name jovo-restore-scratch --network jovo-restore-net -e POSTGRES_PASSWORD=$scratchPassword -e POSTGRES_DB=jovo_restore_scratch postgres:18 | Out-Null
  for ($i = 0; $i -lt 30; $i++) { docker exec jovo-restore-scratch pg_isready -U postgres -d jovo_restore_scratch 2>$null | Out-Null; if ($LASTEXITCODE -eq 0) { break }; Start-Sleep 2 }
  Start-Sleep 3
  docker run --rm --network jovo-restore-net `
    -v "${identity}:/keys/jovo-backup.agekey:ro" `
    -e BACKUP_S3_ENDPOINT -e BACKUP_S3_REGION -e BACKUP_S3_BUCKET -e BACKUP_S3_PREFIX `
    -e BACKUP_S3_ACCESS_KEY_ID -e BACKUP_S3_SECRET_ACCESS_KEY -e RESTORE_TEST_DATABASE_URL `
    jovo-backup node restore-test.mjs --identity=/keys/jovo-backup.agekey
  $result = $LASTEXITCODE
  $sql = "select string_agg(format('%s=%s', t, (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from public.%I', t), false, true, '')))[1]::text), E'\n' order by t) from (select tablename as t from pg_tables where schemaname = 'public') x"
  docker exec jovo-restore-scratch psql -U postgres -d jovo_restore_scratch -At -c $sql | Out-File -Encoding utf8 C:\Users\hp\jovo-restore-counts.txt
  Write-Host "Restore test exit code: $result. Restored counts written to C:\Users\hp\jovo-restore-counts.txt"
} finally {
  docker rm -f jovo-restore-scratch 2>$null | Out-Null
  docker network rm jovo-restore-net 2>$null | Out-Null
  Remove-Item Env:RESTORE_TEST_DATABASE_URL -ErrorAction SilentlyContinue
}
