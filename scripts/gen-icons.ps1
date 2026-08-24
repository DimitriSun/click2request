$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$iconsDir = Join-Path $root "icons"
New-Item -ItemType Directory -Force -Path $iconsDir | Out-Null

function New-Icon {
  param([int]$Size, [string]$Path)

  $bmp = New-Object System.Drawing.Bitmap($Size, $Size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)

  $rect = New-Object System.Drawing.Rectangle(0, 0, $Size, $Size)
  $radius = [int]($Size * 0.22)
  $d = $radius * 2

  $shape = New-Object System.Drawing.Drawing2D.GraphicsPath
  $shape.AddArc(0, 0, $d, $d, 180, 90)
  $shape.AddArc($Size - $d, 0, $d, $d, 270, 90)
  $shape.AddArc($Size - $d, $Size - $d, $d, $d, 0, 90)
  $shape.AddArc(0, $Size - $d, $d, $d, 90, 90)
  $shape.CloseFigure()

  $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    $rect,
    [System.Drawing.Color]::FromArgb(255, 37, 99, 235),
    [System.Drawing.Color]::FromArgb(255, 79, 70, 229),
    45
  )
  $g.FillPath($brush, $shape)

  $white = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
  $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::White, [float]($Size * 0.09))
  $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round

  $s = [float]$Size
  $g.DrawLine($pen, $s * 0.34, $s * 0.66, $s * 0.66, $s * 0.34)

  $head = [System.Drawing.PointF[]]@(
    [System.Drawing.PointF]::new([single]($s * 0.76), [single]($s * 0.26)),
    [System.Drawing.PointF]::new([single]($s * 0.58), [single]($s * 0.30)),
    [System.Drawing.PointF]::new([single]($s * 0.70), [single]($s * 0.44))
  )
  $g.FillPolygon($white, $head)

  $g.Dispose()
  $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
}

foreach ($size in @(16, 32, 48, 128)) {
  $path = Join-Path $iconsDir "icon$size.png"
  New-Icon -Size $size -Path $path
  Write-Host "Generated $path"
}
