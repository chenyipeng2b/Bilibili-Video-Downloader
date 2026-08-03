@echo off
chcp 65001 >nul
title B站视频下载服务
cd /d "%~dp0backend"

:: 日志目录和文件
set "LOG_DIR=logs"
set "LOG_FILE=%LOG_DIR%\startup.log"
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

:: 获取当前时间戳
for /f "tokens=1-3 delims=/- " %%a in ('echo %date%') do set "TS_DATE=%%a-%%b-%%c"
set "TS=%TS_DATE% %time:~0,8%"

echo [%TS%] ========== 启动 B站视频下载服务 ========== >> "%LOG_FILE%"

echo ==========================================
echo   B站视频下载器 - 一键启动
echo ==========================================
echo.

:: 检测 Python
set "PYTHON="
py --version >nul 2>&1
if %errorlevel% equ 0 (
    set "PYTHON=py"
) else (
    python --version >nul 2>&1
    if %errorlevel% equ 0 (set "PYTHON=python")
)
if "%PYTHON%"=="" (
    echo [%TS%] [错误] 未检测到 Python >> "%LOG_FILE%"
    echo [错误] 未检测到 Python，请先安装 Python 3.10+
    echo 下载地址: https://www.python.org/downloads/
    echo 安装时务必勾选 "Add Python to PATH"
    pause
    exit /b 1
)
echo [ OK ] Python 已就绪
echo [%TS%] [ OK ] Python 已就绪 (%PYTHON%) >> "%LOG_FILE%"

:: 检查并安装依赖
echo [ .. ] 检查依赖...
%PYTHON% -c "import fastapi,uvicorn,httpx" >nul 2>&1
if %errorlevel% neq 0 (
    echo [ .. ] 正在安装依赖（首次运行）...
    echo [%TS%] [ INFO ] 正在安装依赖... >> "%LOG_FILE%"
    %PYTHON% -m pip install -r requirements.txt -q
    if %errorlevel% neq 0 (
        echo [%TS%] [错误] 依赖安装失败 >> "%LOG_FILE%"
        echo [失败] 依赖安装失败，请检查网络后重试
        pause
        exit /b 1
    )
    echo [ OK ] 依赖安装完成
    echo [%TS%] [ OK ] 依赖安装完成 >> "%LOG_FILE%"
) else (
    echo [ OK ] 依赖已就绪
    echo [%TS%] [ OK ] 依赖已就绪 >> "%LOG_FILE%"
)

:: 启动服务
echo.
echo ==========================================
echo   服务启动中...
echo   地址: http://127.0.0.1:8765
echo   下载目录: ..\downloads\
echo   日志目录: backend\logs\
echo ==========================================
echo.
echo 保持此窗口打开，然后使用浏览器扩展下载视频
echo 关闭此窗口将停止服务
echo.

echo [%TS%] [ INFO ] 服务启动: http://127.0.0.1:8765 >> "%LOG_FILE%"

%PYTHON% -m uvicorn server:app --host 127.0.0.1 --port 8765

:: 服务退出后记录
for /f "tokens=1-3 delims=/- " %%a in ('echo %date%') do set "TE_DATE=%%a-%%b-%%c"
set "TE=%TE_DATE% %time:~0,8%"
echo [%TE%] [ INFO ] 服务已停止 >> "%LOG_FILE%"

pause
