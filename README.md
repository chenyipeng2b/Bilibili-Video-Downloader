========================================
  Bilibili Video Downloader - Guide
========================================

【Prerequisites】
  - Windows or macOS
  - Chrome / Edge browser
  - Python 3.10+ (https://www.python.org/downloads/)
    Windows: check "Add Python to PATH" during installation


【3-Step Setup】

 Step 1: Start the local service
         - Windows: double-click "启动服务.bat"
         - macOS:  double-click "启动服务.command"
           If macOS blocks it, right-click the file and choose Open once
         - First run creates .venv and downloads dependencies + FFmpeg
         - Keep the window open (service runs on port 8765)

 Step 2: Load the browser extension
         Chrome: go to chrome://extensions/
         Edge:   go to edge://extensions/
         -> Enable "Developer mode" (top right)
         -> Click "Load unpacked"
         -> Select the "extension" folder in this directory
         -> Icon appears in browser toolbar

 Step 3: Open any Bilibili video page, click the extension icon to start


【Features】

  Download Mode
    [Video+Audio]  Download as MP4/MKV
    [Audio Only]   MP3 / FLAC / Hi-Res

  Danmaku (Bullet Comments)
    [Soft Mux MKV]  Subtitles as separate track (PotPlayer/VLC)
    [Hard Burn]     Danmaku burned into video frames (any player)
                    (slower download, larger file)

  Quality
    All 12 quality tiers displayed (locked items grayed out)
    Login to unlock higher qualities

  Log Copy
    Click the [LOG] button at the top of the extension popup
    Copies the latest 500 extension and backend log entries as JSON
    Entries are ordered from newest to oldest
    If the service is offline, local extension diagnostics are copied instead


【FAQ】

  Q: Extension shows "Service not started"
  A: Run "启动服务.bat" (Windows) or "启动服务.command" (macOS)
     Keep the service window open and wait for port 8765

  Q: Higher qualities (4K/1080P60) are locked
  A: Log in to Bilibili first, extension reads your cookie

  Q: MKV has no danmaku
  A: Right-click video -> Subtitles -> Enable, or use Hard Burn mode

  Q: The LOG button shows "Copy failed"
  A: This now only means clipboard access failed. Service-offline diagnostics
     are copied automatically. Startup details: backend/logs/startup.log


【Share with friends】

  Do not include the generated .venv folder when sharing. The recipient should:
  1. Unzip
  2. Run the startup file for their system
  3. Load the "extension" folder in browser
  4. Open Bilibili video page
