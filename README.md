========================================
  Bilibili Video Downloader - Guide
========================================

【Prerequisites】
  - Windows OS
  - Chrome / Edge browser
  - Python 3.10+ (https://www.python.org/downloads/)
    Check "Add Python to PATH" during installation


【3-Step Setup】

 Step 1: Double-click "启动服务.bat"
         - First run auto-installs dependencies
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


【FAQ】

  Q: Extension shows "Service not started"
  A: Double-click "启动服务.bat", wait for port 8765

  Q: Higher qualities (4K/1080P60) are locked
  A: Log in to Bilibili first, extension reads your cookie

  Q: MKV has no danmaku
  A: Right-click video -> Subtitles -> Enable, or use Hard Burn mode


【Share with friends】

  Zip the entire folder and send. They just need to:
  1. Unzip
  2. Double-click "启动服务.bat"
  3. Load the "extension" folder in browser
  4. Open Bilibili video page
