#!/bin/zsh

setopt NO_NOMATCH

PROJECT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
BACKEND_DIR="$PROJECT_DIR/backend"
VENV_DIR="$PROJECT_DIR/.venv"
VENV_PYTHON="$VENV_DIR/bin/python"
REQUIREMENTS_FILE="$BACKEND_DIR/requirements.txt"
REQUIREMENTS_STAMP="$VENV_DIR/.requirements.sha256"
LOG_DIR="$BACKEND_DIR/logs"
LOG_FILE="$LOG_DIR/startup.log"

mkdir -p "$LOG_DIR"

log_message() {
  local level="$1"
  local message="$2"
  printf '[%s] [%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$level" "$message" | tee -a "$LOG_FILE"
}

finish_with_error() {
  log_message "ERROR" "$1"
  printf '\n[失败] %s\n' "$1"
  printf '完整记录：%s\n' "$LOG_FILE"
  if [[ "${BILI_NO_PAUSE:-0}" != "1" ]]; then
    printf '\n按回车键关闭窗口...'
    read -r
  fi
  exit 1
}

log_message "INFO" "========== 启动 B站视频下载服务 =========="
printf '==========================================\n'
printf '  B站视频下载器 - macOS 一键启动\n'
printf '==========================================\n\n'

if ! command -v python3 >/dev/null 2>&1; then
  finish_with_error "未检测到 Python 3.10+。请从 https://www.python.org/downloads/ 安装。"
fi

if ! python3 -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)' >/dev/null 2>&1; then
  finish_with_error "Python 版本过低，需要 Python 3.10 或更高版本。"
fi
log_message "INFO" "Python 已就绪: $(python3 --version 2>&1)"

if [[ ! -x "$VENV_PYTHON" ]]; then
  printf '[ .. ] 首次运行：正在创建项目隔离环境...\n'
  log_message "INFO" "正在创建虚拟环境: $VENV_DIR"
  if ! python3 -m venv "$VENV_DIR" >> "$LOG_FILE" 2>&1; then
    finish_with_error "创建虚拟环境失败。"
  fi
fi

REQUIREMENTS_HASH="$($VENV_PYTHON -c 'import hashlib,pathlib,sys; print(hashlib.sha256(pathlib.Path(sys.argv[1]).read_bytes()).hexdigest())' "$REQUIREMENTS_FILE")"
INSTALLED_HASH=""
if [[ -f "$REQUIREMENTS_STAMP" ]]; then
  INSTALLED_HASH="$(<"$REQUIREMENTS_STAMP")"
fi

DEPENDENCIES_READY=0
if [[ "$INSTALLED_HASH" == "$REQUIREMENTS_HASH" ]] && "$VENV_PYTHON" -c 'import fastapi,uvicorn,httpx,aiofiles,dotenv,imageio_ffmpeg' >/dev/null 2>&1; then
  DEPENDENCIES_READY=1
fi

if (( DEPENDENCIES_READY == 0 )); then
  printf '[ .. ] 首次运行或依赖已更新，正在安装组件和 FFmpeg...\n'
  printf '       下载时间取决于网络速度，请保持窗口开启。\n'
  log_message "INFO" "正在安装依赖"
  "$VENV_PYTHON" -m pip install -r "$REQUIREMENTS_FILE" 2>&1 | tee -a "$LOG_FILE"
  INSTALL_STATUS=${pipestatus[1]}
  if (( INSTALL_STATUS != 0 )); then
    finish_with_error "依赖安装失败，请检查网络。"
  fi
  printf '%s\n' "$REQUIREMENTS_HASH" > "$REQUIREMENTS_STAMP"
  log_message "INFO" "依赖安装完成"
else
  log_message "INFO" "依赖已就绪"
fi

FFMPEG_PATH="$($VENV_PYTHON -c 'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())' 2>> "$LOG_FILE")"
if [[ -z "$FFMPEG_PATH" || ! -x "$FFMPEG_PATH" ]]; then
  finish_with_error "FFmpeg 完整性检查失败，请删除 .venv 后重新运行。"
fi
log_message "INFO" "FFmpeg 已就绪: $FFMPEG_PATH"

printf '\n==========================================\n'
printf '  服务已准备启动\n'
printf '  地址: http://127.0.0.1:8765\n'
printf '  日志: backend/logs/startup.log\n'
printf '==========================================\n\n'
printf '保持此窗口打开；关闭窗口将停止下载服务。\n\n'
log_message "INFO" "启动服务: http://127.0.0.1:8765"

cd "$BACKEND_DIR" || finish_with_error "无法进入 backend 目录。"
"$VENV_PYTHON" -m uvicorn server:app --host 127.0.0.1 --port 8765 2>&1 | tee -a "$LOG_FILE"
SERVER_STATUS=${pipestatus[1]}

log_message "INFO" "服务已停止，退出码: $SERVER_STATUS"
printf '\n服务已停止。完整记录：%s\n' "$LOG_FILE"
if [[ "${BILI_NO_PAUSE:-0}" != "1" ]]; then
  printf '\n按回车键关闭窗口...'
  read -r
fi
exit "$SERVER_STATUS"
