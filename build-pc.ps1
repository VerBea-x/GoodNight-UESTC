$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath $PSScriptRoot).Path
$output = Join-Path $root 'dist\GoodNight-PC'
$dist = Join-Path $root 'dist'
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $compiler)) { throw 'C# compiler missing.' }
if (-not (Test-Path -LiteralPath (Join-Path $root 'node_modules\playwright\package.json'))) { throw 'Run npm ci first.' }
if (Test-Path -LiteralPath $output) {
    $resolved = [IO.Path]::GetFullPath($output)
    if (-not $resolved.StartsWith(([IO.Path]::GetFullPath($dist) + [IO.Path]::DirectorySeparatorChar), [StringComparison]::OrdinalIgnoreCase)) { throw 'Output path is outside dist.' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
New-Item -ItemType Directory -Path $output | Out-Null
foreach ($folder in @('bin','src','web','node_modules')) { Copy-Item -LiteralPath (Join-Path $root $folder) -Destination (Join-Path $output $folder) -Recurse }
foreach ($file in @('package.json','LICENSE')) { Copy-Item -LiteralPath (Join-Path $root $file) -Destination (Join-Path $output $file) }
Copy-Item -LiteralPath (Join-Path $root 'docs\pc.md') -Destination (Join-Path $output 'README-PC.md')
$exe = Join-Path $output 'GoodNight.exe'
$sourceFile = Join-Path $root 'desktop\GoodNight.cs'
& $compiler /nologo /target:winexe /optimize+ /reference:System.Windows.Forms.dll "/out:$exe" $sourceFile
if ($LASTEXITCODE -ne 0) { throw 'Desktop compilation failed.' }
$zip = Join-Path $dist 'GoodNight-PC.zip'
if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip -Force }
Compress-Archive -Path (Join-Path $output '*') -DestinationPath $zip -CompressionLevel Optimal
Write-Host "Windows desktop package: $zip"
