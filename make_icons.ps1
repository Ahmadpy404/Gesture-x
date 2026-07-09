Add-Type -AssemblyName System.Drawing

$projectRoot = 'C:\Users\Admin\.gemini\antigravity\scratch\gesture-x'
$iconsDir = Join-Path $projectRoot 'src\assets\icons'
if (-not (Test-Path $iconsDir)) { New-Item -ItemType Directory -Path $iconsDir -Force | Out-Null }

$sizes = @(16, 32, 48, 128)

foreach ($size in $sizes) {
    $bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

    # Rounded corner radius
    $radius = [Math]::Max(2, [int]($size * 0.18))

    # Build rounded rectangle path
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = $radius * 2
    $path.AddArc(0, 0, $d, $d, 180, 90)
    $path.AddArc(($size - $d), 0, $d, $d, 270, 90)
    $path.AddArc(($size - $d), ($size - $d), $d, $d, 0, 90)
    $path.AddArc(0, ($size - $d), $d, $d, 90, 90)
    $path.CloseFigure()

    # Gradient: violet #7C3AED -> electric blue #38BDF8
    $colorStart = [System.Drawing.Color]::FromArgb(255, 124, 58, 237)
    $colorEnd   = [System.Drawing.Color]::FromArgb(255,  56, 189, 248)
    $pt1 = New-Object System.Drawing.PointF(0, 0)
    $pt2 = New-Object System.Drawing.PointF($size, $size)
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($pt1, $pt2, $colorStart, $colorEnd)

    $g.FillPath($brush, $path)

    # Draw 'GX' text for sizes >= 32
    if ($size -ge 32) {
        $fontSize = [float]([Math]::Max(8, [int]($size * 0.38)))
        $font = New-Object System.Drawing.Font('Arial', $fontSize, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
        $textBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
        $sf = New-Object System.Drawing.StringFormat
        $sf.Alignment = [System.Drawing.StringAlignment]::Center
        $sf.LineAlignment = [System.Drawing.StringAlignment]::Center
        $textRect = New-Object System.Drawing.RectangleF(0, 0, $size, $size)
        $g.DrawString('GX', $font, $textBrush, $textRect, $sf)
        $font.Dispose()
        $textBrush.Dispose()
        $sf.Dispose()
    }

    $brush.Dispose()
    $path.Dispose()
    $g.Dispose()

    $outPath = Join-Path $iconsDir "icon${size}.png"
    $bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Host "Saved: $outPath"
}

Write-Host '--- File sizes ---'
foreach ($size in $sizes) {
    $fp = Join-Path $iconsDir "icon${size}.png"
    $fi = Get-Item $fp
    Write-Host "icon${size}.png: $($fi.Length) bytes"
}
