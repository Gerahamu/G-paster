param(
    [Parameter(Mandatory = $true)][ValidateSet('ocr', 'windows')][string]$Operation,
    [string]$ImagePath,
    [ValidateSet('zh', 'en')][string]$Language = 'en'
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
try {
    if ($Operation -eq 'windows') {
        Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class CaptureWindows {
    [StructLayout(LayoutKind.Sequential)]
    public struct Rect { public int Left, Top, Right, Bottom; }
    private delegate bool WindowCallback(IntPtr window, IntPtr state);
    [DllImport("user32.dll")] private static extern bool EnumWindows(WindowCallback callback, IntPtr state);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr window);
    [DllImport("user32.dll")] private static extern int GetWindowTextLength(IntPtr window);
    [DllImport("user32.dll")] private static extern IntPtr GetShellWindow();
    [DllImport("dwmapi.dll")] private static extern int DwmGetWindowAttribute(IntPtr window, int kind, out int value, int size);
    [DllImport("dwmapi.dll")] private static extern int DwmGetWindowAttribute(IntPtr window, int kind, out Rect value, int size);

    public static Rect[] List() {
        var rectangles = new List<Rect>();
        IntPtr shell = GetShellWindow();
        EnumWindows((window, state) => {
            if (window == shell || !IsWindowVisible(window) || IsIconic(window) || GetWindowTextLength(window) == 0) return true;
            int cloaked;
            if (DwmGetWindowAttribute(window, 14, out cloaked, sizeof(int)) == 0 && cloaked != 0) return true;
            Rect rect;
            if (DwmGetWindowAttribute(window, 9, out rect, Marshal.SizeOf(typeof(Rect))) == 0 &&
                rect.Right > rect.Left && rect.Bottom > rect.Top) rectangles.Add(rect);
            return rectangles.Count < 500;
        }, IntPtr.Zero);
        return rectangles.ToArray();
    }
}
"@
        $rectangles = @([CaptureWindows]::List() | ForEach-Object {
            @{ x = $_.Left; y = $_.Top; width = $_.Right - $_.Left; height = $_.Bottom - $_.Top }
        })
        [Console]::WriteLine((ConvertTo-Json -InputObject $rectangles -Compress))
        exit 0
    }

    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    $null = [Windows.Storage.StorageFile, Windows.Storage, ContentType=WindowsRuntime]
    $null = [Windows.Storage.FileAccessMode, Windows.Storage, ContentType=WindowsRuntime]
    $null = [Windows.Storage.Streams.IRandomAccessStream, Windows.Storage.Streams, ContentType=WindowsRuntime]
    $null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType=WindowsRuntime]
    $null = [Windows.Graphics.Imaging.BitmapTransform, Windows.Graphics.Imaging, ContentType=WindowsRuntime]
    $null = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics.Imaging, ContentType=WindowsRuntime]
    $null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType=WindowsRuntime]
    $null = [Windows.Media.Ocr.OcrResult, Windows.Foundation, ContentType=WindowsRuntime]

    $asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
        $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetGenericArguments().Count -eq 1 -and
        $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
    } | Select-Object -First 1
    function Await-WinRt($Operation, [Type]$ResultType) {
        $task = $asTask.MakeGenericMethod($ResultType).Invoke($null, @($Operation))
        $task.GetAwaiter().GetResult()
    }

    $preferred = [Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages |
        Where-Object { $_.LanguageTag -match "^$Language(-|$)" } | Select-Object -First 1
    $engine = if ($preferred) { [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($preferred) }
    if (!$engine) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages() }
    if (!$engine) {
        $fallback = [Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages | Select-Object -First 1
        if ($fallback) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($fallback) }
    }
    if (!$engine) {
        [Console]::WriteLine('{"error":"ocr-language"}')
        exit 0
    }

    $file = Await-WinRt ([Windows.Storage.StorageFile]::GetFileFromPathAsync($ImagePath)) ([Windows.Storage.StorageFile])
    $stream = Await-WinRt ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
    try {
        $decoder = Await-WinRt ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
        $transform = New-Object Windows.Graphics.Imaging.BitmapTransform
        $factor = [Math]::Min(1, [Windows.Media.Ocr.OcrEngine]::MaxImageDimension / [Math]::Max($decoder.PixelWidth, $decoder.PixelHeight))
        if ($factor -lt 1) {
            $transform.ScaledWidth = [uint32][Math]::Max(1, [Math]::Floor($decoder.PixelWidth * $factor))
            $transform.ScaledHeight = [uint32][Math]::Max(1, [Math]::Floor($decoder.PixelHeight * $factor))
        }
        $bitmap = Await-WinRt ($decoder.GetSoftwareBitmapAsync('Bgra8', 'Ignore', $transform, 'IgnoreExifOrientation', 'DoNotColorManage')) ([Windows.Graphics.Imaging.SoftwareBitmap])
        try {
            $result = Await-WinRt ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
            $text = ($result.Lines | ForEach-Object { $_.Text }) -join "`n"
            [Console]::WriteLine((ConvertTo-Json -Compress @{ text = $text }))
        } finally { $bitmap.Dispose() }
    } finally { $stream.Dispose() }
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    $failure = $_.Exception
    while ($failure.InnerException) { $failure = $failure.InnerException }
    if ($failure -is [UnauthorizedAccessException] -or $failure.HResult -eq -2147024891) {
        [Console]::WriteLine('{"error":"ocr-access"}')
        exit 0
    }
    exit 1
}
