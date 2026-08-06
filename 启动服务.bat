@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul
title B站视频下载服务

set "PROJECT_DIR=%~dp0"
set "BACKEND_DIR=%PROJECT_DIR%backend"
set "VENV_DIR=%PROJECT_DIR%.venv"
set "VENV_PYTHON=%VENV_DIR%\Scripts\python.exe"
set "REQUIREMENTS_FILE=%BACKEND_DIR%\requirements.txt"
set "REQUIREMENTS_STAMP=%VENV_DIR%\.requirements.sha256"
set "LOG_DIR=%BACKEND_DIR%\logs"
set "LOG_FILE=%LOG_DIR%\startup.log"

if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"
call :log "========== 启动 B站视频下载服务 =========="

echo ==========================================
echo   B站视频下载器 - Windows 一键启动
echo ==========================================
echo.

set "PYTHON_CMD="
py -3 --version >nul 2>&1
if not errorlevel 1 set "PYTHON_CMD=py -3"
if not defined PYTHON_CMD (
    python --version >nul 2>&1
    if not errorlevel 1 set "PYTHON_CMD=python"
)

if not defined PYTHON_CMD (
    call :fail "未检测到 Python 3.10+。请从 https://www.python.org/downloads/ 安装，并勾选 Add Python to PATH。"
    exit /b 1
)

%PYTHON_CMD% -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)" >nul 2>&1
if errorlevel 1 (
    call :fail "Python 版本过低，需要 Python 3.10 或更高版本。"
    exit /b 1
)
call :log "Python 已就绪"

if not exist "%VENV_PYTHON%" (
    echo [ .. ] 首次运行：正在创建项目隔离环境...
    call :log "正在创建虚拟环境: %VENV_DIR%"
    %PYTHON_CMD% -m venv "%VENV_DIR%" >> "%LOG_FILE%" 2>&1
    if errorlevel 1 (
        call :fail "创建虚拟环境失败，详情见 backend\logs\startup.log。"
        exit /b 1
    )
)

set "REQUIREMENTS_HASH="
for /f "usebackq delims=" %%H in (`"%VENV_PYTHON%" -c "import hashlib,pathlib; print(hashlib.sha256(pathlib.Path(r'%REQUIREMENTS_FILE%').read_bytes()).hexdigest())"`) do set "REQUIREMENTS_HASH=%%H"

set "INSTALLED_HASH="
if exist "%REQUIREMENTS_STAMP%" set /p INSTALLED_HASH=<"%REQUIREMENTS_STAMP%"

set "DEPENDENCIES_READY=0"
if "!INSTALLED_HASH!"=="!REQUIREMENTS_HASH!" (
    "%VENV_PYTHON%" -c "import fastapi,uvicorn,httpx,aiofiles,dotenv,imageio_ffmpeg" >nul 2>&1
    if not errorlevel 1 set "DEPENDENCIES_READY=1"
)

if "!DEPENDENCIES_READY!"=="0" (
    echo [ .. ] 首次运行或依赖已更新，正在安装组件和 FFmpeg...
    echo        下载时间取决于网络速度，请保持窗口开启。
    call :log "正在安装依赖"
    "%VENV_PYTHON%" -m pip install -r "%REQUIREMENTS_FILE%" >> "%LOG_FILE%" 2>&1
    if errorlevel 1 (
        call :fail "依赖安装失败，请检查网络。详情见 backend\logs\startup.log。"
        exit /b 1
    )
    > "%REQUIREMENTS_STAMP%" echo !REQUIREMENTS_HASH!
    call :log "依赖安装完成"
) else (
    echo [ OK ] 依赖已就绪
    call :log "依赖已就绪"
)

"%VENV_PYTHON%" -c "import fastapi,uvicorn,httpx,aiofiles,dotenv,imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())" >> "%LOG_FILE%" 2>&1
if errorlevel 1 (
    call :fail "依赖完整性检查失败。请删除 .venv 后重新运行。"
    exit /b 1
)

echo.
echo ==========================================
echo   服务已准备启动
echo   地址: http://127.0.0.1:8765
echo   日志: backend\logs\startup.log
echo ==========================================
echo.
echo 保持此窗口打开；关闭窗口将停止下载服务。
echo.
call :log "启动服务: http://127.0.0.1:8765"

pushd "%BACKEND_DIR%"
"%VENV_PYTHON%" -m uvicorn server:app --host 127.0.0.1 --port 8765 >> "%LOG_FILE%" 2>&1
set "SERVER_EXIT=!ERRORLEVEL!"
popd

call :log "服务已停止，退出码: !SERVER_EXIT!"
echo.
echo 服务已停止。详情见 backend\logs\startup.log。
pause
exit /b !SERVER_EXIT!

:log
echo [%date% %time%] [INFO] %~1>> "%LOG_FILE%"
exit /b 0

:fail
echo [%date% %time%] [ERROR] %~1>> "%LOG_FILE%"
echo [失败] %~1
echo.
pause
exit /b 0
