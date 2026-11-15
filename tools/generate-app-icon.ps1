param()

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$projectRoot = Split-Path -Parent $PSScriptRoot
$sourcePath = Join-Path $projectRoot 'output/imagegen/bilingual-app-icon-refined.png'
$resRoot = Join-Path $projectRoot 'app/src/main/res'
$source = [System.Drawing.Image]::FromFile($sourcePath)

function New-IconBitmap([int]$size) {
    return [System.Drawing.Bitmap]::new($size, $size)
}

function Get-IconGraphics($bitmap) {
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    return $graphics
}

try {
    $sizes = @{ mdpi = 48; hdpi = 72; xhdpi = 96; xxhdpi = 144; xxxhdpi = 192 }
    foreach ($density in $sizes.Keys) {
        # Keep raster exports for reuse; API 26+ uses the adaptive resource in the APK.
        $directory = Join-Path $projectRoot "output/imagegen/densities/$density"
        New-Item -ItemType Directory -Path $directory -Force | Out-Null
        $bitmap = New-IconBitmap $sizes[$density]
        $graphics = Get-IconGraphics $bitmap
        try {
            $graphics.DrawImage($source, 0, 0, $bitmap.Width, $bitmap.Height)
            $bitmap.Save((Join-Path $directory 'ic_launcher.png'), [System.Drawing.Imaging.ImageFormat]::Png)
        } finally {
            $graphics.Dispose()
            $bitmap.Dispose()
        }
    }

    # Android adaptive layers span 108 dp; the artwork occupies the central 66 dp.
    # Extend edge pixels into the surrounding area for full-bleed masks without a border.
    $canvasSize = 432
    $padding = 84
    $artSize = $canvasSize - 2 * $padding
    $adaptive = New-IconBitmap $canvasSize
    $graphics = Get-IconGraphics $adaptive
    $edgeAttributes = [System.Drawing.Imaging.ImageAttributes]::new()
    $edgeAttributes.SetWrapMode([System.Drawing.Drawing2D.WrapMode]::TileFlipXY)
    try {
        $destEdges = @(0, $padding, ($padding + $artSize), $canvasSize)
        $srcEdges = @(0, 1, ($source.Width - 1), $source.Width)
        $srcYEdges = @(0, 1, ($source.Height - 1), $source.Height)
        for ($row = 0; $row -lt 3; $row++) {
            for ($column = 0; $column -lt 3; $column++) {
                $destination = [System.Drawing.Rectangle]::new(
                    $destEdges[$column], $destEdges[$row],
                    ($destEdges[$column + 1] - $destEdges[$column]),
                    ($destEdges[$row + 1] - $destEdges[$row]))
                $origin = [System.Drawing.Rectangle]::new(
                    $srcEdges[$column], $srcYEdges[$row],
                    ($srcEdges[$column + 1] - $srcEdges[$column]),
                    ($srcYEdges[$row + 1] - $srcYEdges[$row]))
                $graphics.DrawImage($source, $destination, $origin.X, $origin.Y,
                    $origin.Width, $origin.Height, [System.Drawing.GraphicsUnit]::Pixel, $edgeAttributes)
            }
        }
        $directory = Join-Path $resRoot 'drawable-xxxhdpi'
        New-Item -ItemType Directory -Path $directory -Force | Out-Null
        $adaptive.Save((Join-Path $directory 'ic_launcher_foreground.png'), [System.Drawing.Imaging.ImageFormat]::Png)

        # Preview the 72 dp circular launcher mask against the 108 dp layer.
        $preview = New-IconBitmap 288
        $previewGraphics = Get-IconGraphics $preview
        $mask = [System.Drawing.Drawing2D.GraphicsPath]::new()
        try {
            $previewGraphics.Clear([System.Drawing.Color]::Transparent)
            $mask.AddEllipse(0, 0, 288, 288)
            $previewGraphics.SetClip($mask)
            $previewGraphics.DrawImage($adaptive, -72, -72, 432, 432)
            $preview.Save((Join-Path $projectRoot 'output/imagegen/app-icon-circle-preview.png'), [System.Drawing.Imaging.ImageFormat]::Png)
        } finally {
            $mask.Dispose()
            $previewGraphics.Dispose()
            $preview.Dispose()
        }
    } finally {
        $edgeAttributes.Dispose()
        $graphics.Dispose()
        $adaptive.Dispose()
    }
} finally {
    $source.Dispose()
}
