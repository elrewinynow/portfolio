# Rebuild PNG sizes from the owner's supplied artwork (no redesign).
Add-Type -AssemblyName System.Drawing
$pwaArtwork = [System.Drawing.Bitmap]::FromFile((Join-Path $PSScriptRoot 'icon-source.png'))
try {
 foreach ($pwaSize in @(32, 180, 192, 512)) {
  $pwaBitmap = [System.Drawing.Bitmap]::new($pwaSize, $pwaSize)
  $pwaGraphics = [System.Drawing.Graphics]::FromImage($pwaBitmap)
  try {
   $pwaGraphics.Clear([System.Drawing.Color]::Black)
   $pwaGraphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
   $pwaGraphics.DrawImage($pwaArtwork, 0, 0, $pwaSize, $pwaSize)
   $pwaBitmap.Save((Join-Path $PSScriptRoot "public/icon-$pwaSize.png"), [System.Drawing.Imaging.ImageFormat]::Png)
  } finally { $pwaGraphics.Dispose(); $pwaBitmap.Dispose() }
 }
 $pwaBitmap = [System.Drawing.Bitmap]::new(512,512)
 $pwaGraphics = [System.Drawing.Graphics]::FromImage($pwaBitmap)
 try {
  $pwaGraphics.Clear([System.Drawing.Color]::Black)
  $pwaGraphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $pwaGraphics.DrawImage($pwaArtwork, 64, 64, 384, 384)
  $pwaBitmap.Save((Join-Path $PSScriptRoot 'public/icon-maskable-512.png'), [System.Drawing.Imaging.ImageFormat]::Png)
 } finally { $pwaGraphics.Dispose(); $pwaBitmap.Dispose() }
} finally { $pwaArtwork.Dispose() }

