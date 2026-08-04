' B站视频下载服务 - 开机自启动（后台静默运行）
' 将此文件放到 shell:startup 即可开机自启

Set objShell = CreateObject("WScript.Shell")

' 工作目录
workDir = "G:\bilibili-downloader\backend"

' 启动命令
cmd = "cmd /c cd /d """ & workDir & """ && py -m uvicorn server:app --host 127.0.0.1 --port 8765 > """ & workDir & "\logs\server_output.log"" 2>&1"

' 隐藏窗口运行
objShell.Run cmd, 0, False

Set objShell = Nothing
