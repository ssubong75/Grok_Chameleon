Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

Add-Type -TypeDefinition @"
using System;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Windows.Forms;

public sealed class ChameleonProgressBar : Control {
    private int progressValue;
    public int Value {
        get { return progressValue; }
        set { progressValue = Math.Max(0, Math.Min(100, value)); Invalidate(); }
    }
    public ChameleonProgressBar() {
        SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint |
                 ControlStyles.OptimizedDoubleBuffer, true);
        BackColor = Color.FromArgb(55, 58, 72);
        ForeColor = Color.FromArgb(251, 173, 46);
    }
    protected override void OnPaint(PaintEventArgs e) {
        e.Graphics.Clear(BackColor);
        int width = (int)Math.Round(ClientSize.Width * (progressValue / 100.0));
        if (width > 0) using (var brush = new SolidBrush(ForeColor))
            e.Graphics.FillRectangle(brush, 0, 0, width, ClientSize.Height);
        using (var pen = new Pen(Color.FromArgb(76, 80, 94)))
            e.Graphics.DrawRectangle(pen, 0, 0, Math.Max(0, ClientSize.Width - 1), Math.Max(0, ClientSize.Height - 1));
    }
}

public sealed class ChameleonLogBox : UserControl {
    const int EM_GETFIRSTVISIBLELINE = 0x00CE;
    const int EM_LINESCROLL = 0x00B6;
    [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam);
    readonly RichTextBox editor = new RichTextBox();
    bool dragging;
    int dragOffset;
    int firstLine;
    int visibleLines = 1;
    int totalLines = 1;
    Rectangle thumbBounds;

    public ChameleonLogBox() {
        DoubleBuffered = true;
        BackColor = Color.FromArgb(21, 24, 31);
        ForeColor = Color.WhiteSmoke;
        editor.ReadOnly = true;
        editor.BorderStyle = BorderStyle.None;
        editor.ScrollBars = RichTextBoxScrollBars.None;
        editor.BackColor = BackColor;
        editor.ForeColor = ForeColor;
        editor.Location = new Point(5, 5);
        editor.MouseWheel += (s, e) => { ScrollLines(e.Delta > 0 ? -3 : 3); };
        editor.VScroll += (s, e) => { UpdateMetrics(); Invalidate(); };
        Controls.Add(editor);
    }
    protected override void OnResize(EventArgs e) { base.OnResize(e); editor.Size = new Size(Math.Max(0, Width - 23), Math.Max(0, Height - 10)); UpdateMetrics(); Invalidate(); }
    protected override void OnBackColorChanged(EventArgs e) { base.OnBackColorChanged(e); if (editor != null) editor.BackColor = BackColor; }
    protected override void OnForeColorChanged(EventArgs e) { base.OnForeColorChanged(e); if (editor != null) editor.ForeColor = ForeColor; }
    protected override void OnFontChanged(EventArgs e) { base.OnFontChanged(e); if (editor != null) editor.Font = Font; UpdateMetrics(); }
    public void AppendText(string value) { editor.AppendText(value); editor.SelectionStart = editor.TextLength; editor.ScrollToCaret(); UpdateMetrics(); Invalidate(); }
    public int TextLength { get { return editor.TextLength; } }
    public int SelectionStart { get { return editor.SelectionStart; } set { editor.SelectionStart = value; } }
    public void ScrollToCaret() { editor.ScrollToCaret(); UpdateMetrics(); Invalidate(); }
    void UpdateMetrics() {
        totalLines = Math.Max(1, editor.Lines.Length);
        visibleLines = Math.Max(1, editor.ClientSize.Height / Math.Max(1, editor.Font.Height));
        firstLine = (int)SendMessage(editor.Handle, EM_GETFIRSTVISIBLELINE, IntPtr.Zero, IntPtr.Zero);
        int trackTop = 2, trackHeight = Math.Max(1, Height - 4);
        int thumbHeight = Math.Max(28, (int)(trackHeight * Math.Min(1.0, visibleLines / (double)totalLines)));
        int maxFirst = Math.Max(1, totalLines - visibleLines);
        int thumbY = trackTop + (int)((trackHeight - thumbHeight) * Math.Min(1.0, firstLine / (double)maxFirst));
        thumbBounds = new Rectangle(Math.Max(0, Width - 15), thumbY, 11, thumbHeight);
    }
    void ScrollLines(int delta) { SendMessage(editor.Handle, EM_LINESCROLL, IntPtr.Zero, (IntPtr)delta); UpdateMetrics(); Invalidate(); }
    protected override void OnPaint(PaintEventArgs e) {
        e.Graphics.Clear(BackColor);
        using (var border = new Pen(Color.FromArgb(91, 95, 108))) e.Graphics.DrawRectangle(border, 0, 0, Math.Max(0, Width - 1), Math.Max(0, Height - 1));
        using (var track = new SolidBrush(Color.FromArgb(42, 45, 56))) e.Graphics.FillRectangle(track, Math.Max(0, Width - 17), 1, 16, Math.Max(0, Height - 2));
        using (var thumb = new SolidBrush(Color.FromArgb(105, 110, 126))) e.Graphics.FillRectangle(thumb, thumbBounds);
    }
    protected override void OnMouseDown(MouseEventArgs e) {
        base.OnMouseDown(e); UpdateMetrics();
        if (thumbBounds.Contains(e.Location)) { dragging = true; dragOffset = e.Y - thumbBounds.Y; Capture = true; }
        else if (e.X >= Width - 17) ScrollLines(e.Y < thumbBounds.Y ? -visibleLines : visibleLines);
    }
    protected override void OnMouseMove(MouseEventArgs e) {
        base.OnMouseMove(e); if (!dragging) return;
        int trackHeight = Math.Max(1, Height - 4), movable = Math.Max(1, trackHeight - thumbBounds.Height);
        int y = Math.Max(2, Math.Min(2 + movable, e.Y - dragOffset));
        int maxFirst = Math.Max(0, totalLines - visibleLines);
        int target = (int)Math.Round(maxFirst * ((y - 2) / (double)movable));
        ScrollLines(target - firstLine);
    }
    protected override void OnMouseUp(MouseEventArgs e) { base.OnMouseUp(e); dragging = false; Capture = false; }
}

public static class ChameleonDarkMode {
    [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref int value, int size);
    [DllImport("uxtheme.dll", CharSet = CharSet.Unicode)] static extern int SetWindowTheme(IntPtr hwnd, string appName, string idList);
    [DllImport("user32.dll")] static extern bool ReleaseCapture();
    [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam);
    public static void ApplyTitleBar(IntPtr hwnd) {
        int enabled = 1;
        if (DwmSetWindowAttribute(hwnd, 20, ref enabled, 4) != 0)
            DwmSetWindowAttribute(hwnd, 19, ref enabled, 4);
        int caption = 31 | (34 << 8) | (49 << 16);
        int border = caption;
        int titleText = 245 | (245 << 8) | (245 << 16);
        DwmSetWindowAttribute(hwnd, 35, ref caption, 4);
        DwmSetWindowAttribute(hwnd, 34, ref border, 4);
        DwmSetWindowAttribute(hwnd, 36, ref titleText, 4);
    }
    public static void ApplyDarkScrollBar(IntPtr hwnd) {
        SetWindowTheme(hwnd, "DarkMode_Explorer", null);
    }
    public static void BeginWindowDrag(IntPtr hwnd) {
        ReleaseCapture(); SendMessage(hwnd, 0x00A1, (IntPtr)2, IntPtr.Zero);
    }
}
"@ -ReferencedAssemblies "System.Windows.Forms.dll", "System.Drawing.dll"

[System.Windows.Forms.Application]::EnableVisualStyles()

$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$ResourcesRoot = Split-Path -Parent $ScriptRoot
$PythonHome = Join-Path $ResourcesRoot "Python"
$PythonExe = Join-Path $ResourcesRoot "Python\pythonw.exe"
if (!(Test-Path -LiteralPath $PythonExe -PathType Leaf)) {
    $PythonExe = Join-Path $ResourcesRoot "Python\python.exe"
}
$MigrationPy = Join-Path $ScriptRoot "migration.py"
$script:MigrationProcess = $null

function Quote-Arg([string]$value) {
    return '"' + ($value -replace '"', '\"') + '"'
}

function Append-Log([System.Windows.Forms.Control]$box, [string]$text) {
    $box.AppendText($text + [Environment]::NewLine)
    $box.SelectionStart = $box.TextLength
    $box.ScrollToCaret()
}

function Select-Folder([string]$title, [string]$initialPath = "") {
    $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
    $dialog.Description = $title
    $dialog.ShowNewFolderButton = $true
    if ($initialPath -and (Test-Path -LiteralPath $initialPath -PathType Container)) {
        $dialog.SelectedPath = $initialPath
    }
    try {
        if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
            return $dialog.SelectedPath
        }
        return ""
    } finally {
        $dialog.Dispose()
    }
}

function Browse-Folder([string]$title, [System.Windows.Forms.TextBox]$targetBox) {
    $selectedPath = Select-Folder $title $targetBox.Text
    if ($selectedPath) {
        $targetBox.Text = $selectedPath
    }
}

function Run-Migration(
    [string]$mode,
    [System.Windows.Forms.TextBox]$oldBox,
    [System.Windows.Forms.TextBox]$newBox,
    [System.Windows.Forms.Control]$logBox,
    [System.Windows.Forms.Control]$progress,
    [System.Windows.Forms.Label]$statusLabel,
    [System.Windows.Forms.Label]$percentLabel,
    [System.Windows.Forms.Button[]]$buttons,
    [string]$sourcePath = ""
) {
    if (!(Test-Path -LiteralPath $PythonExe -PathType Leaf)) {
        [System.Windows.Forms.MessageBox]::Show("Resources\Python\pythonw.exe was not found.", "Migration", "OK", "Error") | Out-Null
        return
    }
    if (!(Test-Path -LiteralPath $MigrationPy -PathType Leaf)) {
        [System.Windows.Forms.MessageBox]::Show("migration.py was not found.", "Migration", "OK", "Error") | Out-Null
        return
    }
    $isImport = $mode -eq "Import"
    if (!$isImport -and (!$oldBox.Text -or !(Test-Path -LiteralPath $oldBox.Text -PathType Container))) {
        [System.Windows.Forms.MessageBox]::Show("Select Old Library Folder.", "Migration", "OK", "Warning") | Out-Null
        return
    }
    if (!$newBox.Text) {
        [System.Windows.Forms.MessageBox]::Show("Select New Library Folder.", "Migration", "OK", "Warning") | Out-Null
        return
    }
    if ($isImport -and (!$sourcePath -or !(Test-Path -LiteralPath $sourcePath -PathType Container))) {
        [System.Windows.Forms.MessageBox]::Show("Select a folder containing media to import.", "Migration", "OK", "Warning") | Out-Null
        return
    }

    foreach ($button in $buttons) { $button.Enabled = $false }
    $progress.Value = 0
    $statusLabel.Text = "Running " + $mode + "..."
    $percentLabel.Text = "0%"
    Append-Log $logBox ("")
    Append-Log $logBox ("Running " + $mode + "...")

    $flag = if ($mode -eq "Scan") {
        "--scan"
    } elseif ($mode -eq "Import") {
        "--import-media"
    } else {
        "--convert"
    }
    $source = if ($isImport) { $sourcePath } else { $oldBox.Text }
    $arguments = @(
        "-u",
        (Quote-Arg $MigrationPy),
        $flag,
        "--source",
        (Quote-Arg $source),
        "--target",
        (Quote-Arg $newBox.Text)
    ) -join " "
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $PythonExe
    $psi.Arguments = $arguments
    $psi.WorkingDirectory = $ScriptRoot
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true
    $psi.EnvironmentVariables["PYTHONHOME"] = $PythonHome
    $psi.EnvironmentVariables["PYTHONNOUSERSITE"] = "1"
    $psi.EnvironmentVariables["PYTHONDONTWRITEBYTECODE"] = "1"
    $psi.StandardOutputEncoding = [System.Text.Encoding]::UTF8
    $psi.StandardErrorEncoding = [System.Text.Encoding]::UTF8
    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $psi
    try {
        [void]$process.Start()
        $script:MigrationProcess = $process
        # Drain both streams asynchronously to avoid pipe deadlocks. Keeping
        # process ownership on the UI runspace avoids BackgroundWorker's
        # missing-runspace failure on Windows PowerShell.
        $outputTask = $process.StandardOutput.ReadToEndAsync()
        $errorTask = $process.StandardError.ReadToEndAsync()
        while (!$process.HasExited) {
            [System.Windows.Forms.Application]::DoEvents()
            Start-Sleep -Milliseconds 40
        }
        $process.WaitForExit()
        $outputText = $outputTask.Result
        $errorText = $errorTask.Result
        foreach ($line in ($outputText -split "`r?`n")) {
            if (!$line) { continue }
            if ($line -match "Progress:\s+(\d+)%") {
                $percent = [Math]::Min(100, [Math]::Max(0, [int]$Matches[1]))
                $progress.Value = $percent
                $percentLabel.Text = ([string]$percent) + "%"
            }
            Append-Log $logBox $line
        }
        if ($errorText) { Append-Log $logBox $errorText.Trim() }
        if ($process.ExitCode -eq 0) {
            $progress.Value = 100
            $percentLabel.Text = "100%"
            $statusLabel.Text = $mode + " done."
            Append-Log $logBox ($mode + " done.")
        } else {
            $statusLabel.Text = $mode + " failed."
            Append-Log $logBox ($mode + " failed with code " + $process.ExitCode)
        }
    } catch {
        $statusLabel.Text = "Error"
        Append-Log $logBox ("Error: " + $_.Exception.Message)
    } finally {
        if ($script:MigrationProcess -eq $process) { $script:MigrationProcess = $null }
        foreach ($button in $buttons) { $button.Enabled = $true }
        if ($process) { $process.Dispose() }
    }
}

$bg = [System.Drawing.Color]::FromArgb(31, 34, 49)
$panel = [System.Drawing.Color]::FromArgb(55, 58, 72)
$workBg = [System.Drawing.Color]::FromArgb(21, 24, 31)
$text = [System.Drawing.Color]::WhiteSmoke
$accent = [System.Drawing.Color]::FromArgb(251, 173, 46)

$form = New-Object System.Windows.Forms.Form
$form.Text = "Migration"
$form.StartPosition = "CenterScreen"
$form.ClientSize = New-Object System.Drawing.Size(980, 674)
$form.FormBorderStyle = "None"
$form.MinimumSize = New-Object System.Drawing.Size(720, 520)
$form.BackColor = $bg
$form.ForeColor = $text
$form.Font = New-Object System.Drawing.Font("Segoe UI", 10)

$caption = New-Object System.Windows.Forms.Panel
$caption.SetBounds(0, 0, 980, 34)
$caption.BackColor = $workBg
$caption.Anchor = "Top,Left,Right"
$form.Controls.Add($caption)

$captionTitle = New-Object System.Windows.Forms.Label
$captionTitle.Text = "  Migration"
$captionTitle.ForeColor = $text
$captionTitle.BackColor = $workBg
$captionTitle.TextAlign = "MiddleLeft"
$captionTitle.SetBounds(8, 0, 750, 34)
$captionTitle.Anchor = "Top,Left,Right"
$caption.Controls.Add($captionTitle)

$minBtn = New-Object System.Windows.Forms.Button
$minBtn.Text = [char]0x2014
$minBtn.SetBounds(842, 0, 46, 34)
$minBtn.Anchor = "Top,Right"
$minBtn.FlatStyle = "Flat"
$minBtn.FlatAppearance.BorderSize = 0
$minBtn.BackColor = $workBg
$minBtn.ForeColor = $text
$minBtn.Add_Click({ $form.WindowState = "Minimized" })
$caption.Controls.Add($minBtn)

$maxBtn = New-Object System.Windows.Forms.Button
$maxBtn.Text = [char]0x25A1
$maxBtn.SetBounds(888, 0, 46, 34)
$maxBtn.Anchor = "Top,Right"
$maxBtn.FlatStyle = "Flat"
$maxBtn.FlatAppearance.BorderSize = 0
$maxBtn.BackColor = $workBg
$maxBtn.ForeColor = $text
$maxBtn.Add_Click({
    if ($form.WindowState -eq "Maximized") { $form.WindowState = "Normal" } else { $form.WindowState = "Maximized" }
})
$caption.Controls.Add($maxBtn)

$closeBtn = New-Object System.Windows.Forms.Button
$closeBtn.Text = [char]0x00D7
$closeBtn.SetBounds(934, 0, 46, 34)
$closeBtn.Anchor = "Top,Right"
$closeBtn.FlatStyle = "Flat"
$closeBtn.FlatAppearance.BorderSize = 0
$closeBtn.BackColor = $workBg
$closeBtn.ForeColor = $text
$closeBtn.Add_Click({ $form.Close() })
$caption.Controls.Add($closeBtn)

$form.Add_FormClosing({
    if ($script:MigrationProcess -and !$script:MigrationProcess.HasExited) {
        try { $script:MigrationProcess.Kill() } catch {}
    }
})

$dragWindow = { [ChameleonDarkMode]::BeginWindowDrag($form.Handle) }
$caption.Add_MouseDown($dragWindow)
$captionTitle.Add_MouseDown($dragWindow)
$caption.Add_DoubleClick({ $maxBtn.PerformClick() })

$content = New-Object System.Windows.Forms.Panel
$content.SetBounds(0, 34, 980, 640)
$content.BackColor = $bg
$content.Anchor = "Top,Bottom,Left,Right"
$form.Controls.Add($content)

$title = New-Object System.Windows.Forms.Label
$title.Text = "Migration"
$title.ForeColor = $accent
$title.Font = New-Object System.Drawing.Font("Segoe UI", 24, [System.Drawing.FontStyle]::Bold)
$title.TextAlign = "MiddleCenter"
$title.SetBounds(0, 26, 960, 42)
$content.Controls.Add($title)

$oldLabel = New-Object System.Windows.Forms.Label
$oldLabel.Text = "1. Old Library Folder"
$oldLabel.Font = New-Object System.Drawing.Font("Segoe UI", 11)
$oldLabel.SetBounds(42, 104, 190, 30)
$content.Controls.Add($oldLabel)

$oldBox = New-Object System.Windows.Forms.TextBox
$oldBox.SetBounds(242, 102, 520, 34)
$oldBox.BackColor = $panel
$oldBox.ForeColor = $text
$oldBox.BorderStyle = "FixedSingle"
$content.Controls.Add($oldBox)

$oldBrowse = New-Object System.Windows.Forms.Button
$oldBrowse.Text = "Browse"
$oldBrowse.Font = New-Object System.Drawing.Font("Segoe UI", 11)
$oldBrowse.SetBounds(784, 100, 132, 38)
$oldBrowse.BackColor = $accent
$oldBrowse.ForeColor = [System.Drawing.Color]::Black
$oldBrowse.FlatStyle = "Flat"
$oldBrowse.Add_Click({ Browse-Folder "Select Old Library Folder" $oldBox })
$content.Controls.Add($oldBrowse)

$newLabel = New-Object System.Windows.Forms.Label
$newLabel.Text = "2. New Library Folder"
$newLabel.Font = New-Object System.Drawing.Font("Segoe UI", 11)
$newLabel.SetBounds(42, 158, 190, 30)
$content.Controls.Add($newLabel)

$newBox = New-Object System.Windows.Forms.TextBox
$newBox.SetBounds(242, 156, 520, 34)
$newBox.BackColor = $panel
$newBox.ForeColor = $text
$newBox.BorderStyle = "FixedSingle"
$content.Controls.Add($newBox)

$newBrowse = New-Object System.Windows.Forms.Button
$newBrowse.Text = "Browse"
$newBrowse.Font = New-Object System.Drawing.Font("Segoe UI", 11)
$newBrowse.SetBounds(784, 154, 132, 38)
$newBrowse.BackColor = $accent
$newBrowse.ForeColor = [System.Drawing.Color]::Black
$newBrowse.FlatStyle = "Flat"
$newBrowse.Add_Click({ Browse-Folder "Select New Library Folder" $newBox })
$content.Controls.Add($newBrowse)

$scanLabel = New-Object System.Windows.Forms.Label
$scanLabel.Text = "3. Scan"
$scanLabel.Font = New-Object System.Drawing.Font("Segoe UI", 11)
$scanLabel.SetBounds(42, 212, 190, 30)
$content.Controls.Add($scanLabel)

$scanBtn = New-Object System.Windows.Forms.Button
$scanBtn.Text = "Scan"
$scanBtn.Font = New-Object System.Drawing.Font("Segoe UI", 11)
$scanBtn.SetBounds(784, 208, 132, 38)
$scanBtn.BackColor = $accent
$scanBtn.ForeColor = [System.Drawing.Color]::Black
$scanBtn.FlatStyle = "Flat"
$content.Controls.Add($scanBtn)

$convertLabel = New-Object System.Windows.Forms.Label
$convertLabel.Text = "4. Convert"
$convertLabel.Font = New-Object System.Drawing.Font("Segoe UI", 11)
$convertLabel.SetBounds(42, 266, 190, 30)
$content.Controls.Add($convertLabel)

$convertBtn = New-Object System.Windows.Forms.Button
$convertBtn.Text = "Convert"
$convertBtn.Font = New-Object System.Drawing.Font("Segoe UI", 11)
$convertBtn.SetBounds(784, 262, 132, 38)
$convertBtn.BackColor = $accent
$convertBtn.ForeColor = [System.Drawing.Color]::Black
$convertBtn.FlatStyle = "Flat"
$content.Controls.Add($convertBtn)

$progressStatus = New-Object System.Windows.Forms.Label
$progressStatus.Text = "Ready"
$progressStatus.Font = New-Object System.Drawing.Font("Segoe UI", 9)
$progressStatus.ForeColor = $text
$progressStatus.SetBounds(42, 306, 320, 18)
$content.Controls.Add($progressStatus)

$progressPercent = New-Object System.Windows.Forms.Label
$progressPercent.Text = "0%"
$progressPercent.Font = New-Object System.Drawing.Font("Segoe UI", 9)
$progressPercent.ForeColor = $text
$progressPercent.TextAlign = "MiddleRight"
$progressPercent.SetBounds(846, 306, 70, 18)
$content.Controls.Add($progressPercent)

$progress = New-Object ChameleonProgressBar
$progress.SetBounds(42, 328, 874, 12)
$progress.BackColor = $panel
$progress.ForeColor = $accent
$content.Controls.Add($progress)

$logBox = New-Object System.Windows.Forms.TextBox
$logBox.Multiline = $true
$logBox.ReadOnly = $true
$logBox.ScrollBars = "None"
$logBox.BackColor = [System.Drawing.Color]::FromArgb(21, 24, 31)
$logBox.ForeColor = $text
$logBox.BorderStyle = "FixedSingle"
$logBox.SetBounds(42, 354, 874, 210)
$content.Controls.Add($logBox)

$logScrollTrack = New-Object System.Windows.Forms.Panel
$logScrollTrack.SetBounds(900, 355, 15, 208)
$logScrollTrack.BackColor = [System.Drawing.Color]::FromArgb(42, 45, 56)
$content.Controls.Add($logScrollTrack)
$logScrollTrack.BringToFront()

$logScrollThumb = New-Object System.Windows.Forms.Panel
$logScrollThumb.SetBounds(2, 4, 11, 48)
$logScrollThumb.BackColor = [System.Drawing.Color]::FromArgb(105, 110, 126)
$logScrollTrack.Controls.Add($logScrollThumb)

$importLabel = New-Object System.Windows.Forms.Label
$importLabel.Text = "+ Import other media"
$importLabel.Font = New-Object System.Drawing.Font("Segoe UI", 11)
$importLabel.SetBounds(42, 586, 190, 30)
$content.Controls.Add($importLabel)

$importBtn = New-Object System.Windows.Forms.Button
$importBtn.Text = "Import"
$importBtn.Font = New-Object System.Drawing.Font("Segoe UI", 11)
$importBtn.SetBounds(784, 578, 132, 38)
$importBtn.BackColor = $accent
$importBtn.ForeColor = [System.Drawing.Color]::Black
$importBtn.FlatStyle = "Flat"
$content.Controls.Add($importBtn)

$buttons = @($oldBrowse, $newBrowse, $scanBtn, $convertBtn, $importBtn)
$scanBtn.Add_Click({ Run-Migration "Scan" $oldBox $newBox $logBox $progress $progressStatus $progressPercent $buttons })
$convertBtn.Add_Click({ Run-Migration "Convert" $oldBox $newBox $logBox $progress $progressStatus $progressPercent $buttons })
$importBtn.Add_Click({
    if (!$newBox.Text) {
        [System.Windows.Forms.MessageBox]::Show("Select New Library Folder.", "Migration", "OK", "Warning") | Out-Null
        return
    }
    $mediaFolder = Select-Folder "Select a folder containing media to import"
    if ($mediaFolder) {
        Run-Migration "Import" $oldBox $newBox $logBox $progress $progressStatus $progressPercent $buttons $mediaFolder
    }
})

Append-Log $logBox "1. Select Old Library Folder."
Append-Log $logBox "2. Select New Library Folder."
Append-Log $logBox "3. Run Scan."
Append-Log $logBox "4. Run Convert."

[void]$form.ShowDialog()
