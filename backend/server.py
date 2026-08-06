"""
B站视频下载服务 - FastAPI 后端
接收扩展发来的下载请求，下载视频/音频流，用 ffmpeg 合并输出 mp4
"""

import os
import re
import json
import asyncio
import subprocess
import sys
import time
from pathlib import Path

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel

from bilibili_api import (
    extract_bvid,
    get_video_info,
    get_video_streams,
    get_danmaku,
    danmaku_to_ass,
    QUALITY_MAP,
    QUALITY_ORDER,
    HEADERS_TEMPLATE,
)
from logger import get_logger, get_log_files, read_logs

# 初始化日志
logger = get_logger("server")

app = FastAPI(
    title="B站视频下载服务",
    description="配合浏览器扩展使用的本地下载后端",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# 下载目录（放在 backend 外，避免 uvicorn reload 监听文件变化触发中断）
DOWNLOAD_DIR = Path(__file__).parent.parent / "downloads"
DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)

# 任务状态存储
download_tasks: dict[str, dict] = {}

# 安全的文件名
def safe_filename(name: str) -> str:
    """移除文件名中的非法字符"""
    name = re.sub(r'[<>:"/\\|?*]', '_', name)
    return name[:100]  # 限制长度


def select_folder_native(initial_dir: Path) -> str:
    """使用独立的系统进程打开文件夹选择器，避免 Tk 在线程中崩溃。"""
    initial_path = str(initial_dir.resolve())

    if sys.platform == "darwin":
        escaped_path = initial_path.replace("\\", "\\\\").replace('"', '\\"')
        script = (
            'set selectedFolder to choose folder with prompt "选择下载保存路径" '
            f'default location POSIX file "{escaped_path}"\n'
            'return POSIX path of selectedFolder'
        )
        result = subprocess.run(
            ["osascript", "-e", script],
            capture_output=True,
            text=True,
            timeout=600,
        )
        if result.returncode == 0:
            return result.stdout.strip()
        # AppleScript -128 表示用户主动取消，不应视为服务错误。
        if "-128" in result.stderr or "User canceled" in result.stderr:
            return ""
        raise RuntimeError(result.stderr.strip() or "macOS 文件夹选择器启动失败")

    if os.name == "nt":
        escaped_path = initial_path.replace("'", "''")
        powershell_script = (
            "$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new();"
            "Add-Type -AssemblyName System.Windows.Forms;"
            "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog;"
            "$dialog.Description = '选择下载保存路径';"
            f"$dialog.SelectedPath = '{escaped_path}';"
            "if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {"
            "[Console]::Write($dialog.SelectedPath)"
            "}"
        )
        result = subprocess.run(
            ["powershell.exe", "-NoProfile", "-STA", "-Command", powershell_script],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=600,
        )
        if result.returncode != 0:
            raise RuntimeError(result.stderr.strip() or "Windows 文件夹选择器启动失败")
        return result.stdout.strip()

    raise RuntimeError("当前系统不支持原生文件夹选择器")


def open_folder_native(folder: str) -> None:
    """使用当前操作系统的文件管理器打开目录。"""
    if sys.platform == "darwin":
        result = subprocess.run(["open", folder], capture_output=True, text=True, timeout=10)
        if result.returncode != 0:
            raise RuntimeError(result.stderr.strip() or "Finder 打开失败")
    elif os.name == "nt":
        os.startfile(folder)
    else:
        result = subprocess.run(["xdg-open", folder], capture_output=True, text=True, timeout=10)
        if result.returncode != 0:
            raise RuntimeError(result.stderr.strip() or "文件管理器打开失败")


def find_ffmpeg() -> str:
    """查找 ffmpeg 路径"""
    # 1. 先检查 imageio-ffmpeg（Python 包自带的 ffmpeg）
    try:
        import imageio_ffmpeg
        exe = imageio_ffmpeg.get_ffmpeg_exe()
        if exe and os.path.exists(exe):
            subprocess.run([exe, "-version"], capture_output=True, timeout=5)
            return exe
    except Exception:
        pass

    # 2. 尝试常见路径
    common_paths = [
        "ffmpeg",
        "ffmpeg.exe",
        r"C:\ffmpeg\bin\ffmpeg.exe",
        r"D:\ffmpeg\bin\ffmpeg.exe",
        r"G:\ffmpeg\bin\ffmpeg.exe",
    ]
    for path in common_paths:
        try:
            subprocess.run([path, "-version"], capture_output=True, timeout=5)
            return path
        except (FileNotFoundError, subprocess.TimeoutExpired):
            continue

    # 3. 尝试 where 命令
    try:
        result = subprocess.run(["where", "ffmpeg"], capture_output=True, text=True, timeout=5)
        if result.returncode == 0:
            return result.stdout.strip().split("\n")[0]
    except Exception:
        pass

    return "ffmpeg"  # 兜底


FFMPEG_PATH = find_ffmpeg()


# ==================== 模型 ====================

class DownloadRequest(BaseModel):
    bvid: str
    cid: int
    title: str
    quality: int
    cookie: str = ""
    download_path: str = ""
    download_mode: str = "video"  # "video" = 视频+音频, "audio" = 仅音频
    audio_format: str = "mp3"     # "mp3"/"flac"/"hires" — 仅 audio 模式有效
    download_danmaku: bool = False  # 是否同时下载弹幕
    danmaku_mode: str = "soft"       # "soft" = MKV软封装, "burn" = 硬烧录
    cover_url: str = ""              # B站原始封面图URL


class TaskStatus(BaseModel):
    task_id: str
    status: str
    progress: float
    message: str


# ==================== API ====================

@app.get("/")
def root():
    return {
        "service": "B站视频下载服务",
        "status": "running",
        "ffmpeg": FFMPEG_PATH,
        "docs": "/docs",
    }


@app.post("/api/video-info")
async def api_video_info(req: dict):
    """获取视频信息 + 可用画质列表（支持指定 cid 查询不同分P画质）"""
    url = req.get("url", "")
    cookie = req.get("cookie", "")
    target_cid = req.get("cid")  # 可选：查询指定分P的画质

    bvid = extract_bvid(url)
    if not bvid:
        logger.error(f"无法识别 B站视频链接: url={url}")
        raise HTTPException(400, "无法识别 B站视频链接，请提供 BV 号或完整链接")

    try:
        info = await get_video_info(bvid, cookie)
        # 如果指定了 cid 就用指定的，否则用第一P
        cid = target_cid if target_cid else (info["pages"][0]["cid"] if info["pages"] else 0)

        streams = await get_video_streams(bvid, cid, cookie)

        # 去重：同一画质 ID 可能有多种编码（avc1/hev1/av01），选最高码率的
        quality_map = {}
        for vs in streams["video_streams"]:
            qid = vs["quality"]
            if qid not in quality_map or vs.get("bandwidth", 0) > quality_map[qid].get("bandwidth", 0):
                quality_map[qid] = {
                    "id": vs["quality"],
                    "name": vs["quality_name"],
                    "width": vs["width"],
                    "height": vs["height"],
                    "frame_rate": vs["frame_rate"],
                    "codec": vs["format"],
                }

        # 按画质从高到低排序
        available_qualities = sorted(
            quality_map.values(),
            key=lambda q: QUALITY_ORDER.index(q["id"]) if q["id"] in QUALITY_ORDER else 999
        )

        # 如果只有旧格式流（durl，音视频已合并），只有一个画质
        if not quality_map and streams["durl_streams"]:
            qid = streams["quality"]
            quality_map[qid] = {
                "id": qid,
                "name": streams["quality_name"],
                "width": 0,
                "height": 0,
                "frame_rate": "unknown",
                "codec": "avc1",
            }
            available_qualities = [quality_map[qid]]

        available_ids = set(q["id"] for q in available_qualities)

        # 全部 12 种画质描述（前端用这个渲染完整下拉框）
        all_qualities = []
        for qid in QUALITY_ORDER:
            all_qualities.append({
                "id": qid,
                "name": QUALITY_MAP[qid],
                "available": qid in available_ids,
            })

        return {
            "success": True,
            "bvid": bvid,
            "title": info["title"],
            "cover": info["cover"],
            "owner": info["owner"]["name"],
            "duration": info["duration"],
            "pages": [
                {"cid": p["cid"], "part": p["part"], "duration": p["duration"]}
                for p in info["pages"]
            ],
            "all_qualities": all_qualities,
            "available_qualities": available_qualities,
            "available_ids": list(available_ids),
            "current_quality": streams["quality_name"],
        }
    except Exception as e:
        logger.error(f"获取视频信息失败: bvid={bvid}, url={url}", exc_info=True)
        raise HTTPException(500, str(e))


@app.post("/api/download")
async def api_download(req: DownloadRequest):
    """开始下载任务"""
    import uuid
    task_id = str(uuid.uuid4())[:8]

    download_tasks[task_id] = {
        "status": "preparing",
        "progress": 0,
        "message": "正在获取视频流...",
        "bvid": req.bvid,
        "title": req.title,
    }

    logger.info(f"新建下载任务: task_id={task_id}, bvid={req.bvid}, title={req.title}, quality={req.quality}, mode={req.download_mode}")

    # 异步执行下载
    asyncio.create_task(_do_download(task_id, req))

    return {"success": True, "task_id": task_id}


@app.get("/api/task/{task_id}")
def api_task_status(task_id: str):
    """查询下载任务进度"""
    task = download_tasks.get(task_id)
    if not task:
        logger.warning(f"查询不存在的任务: task_id={task_id}")
        raise HTTPException(404, "任务不存在")
    return task


@app.get("/api/select-folder")
def api_select_folder():
    """打开原生文件夹选择对话框，返回选中的路径"""
    try:
        folder_path = select_folder_native(DOWNLOAD_DIR)
        if folder_path:
            return {"success": True, "path": folder_path}
        return {"success": False, "path": ""}
    except subprocess.TimeoutExpired:
        logger.warning("文件夹选择超时")
        raise HTTPException(504, "文件夹选择超时，请重试")
    except Exception as e:
        logger.error("打开文件夹选择器失败", exc_info=True)
        raise HTTPException(500, f"打开文件夹选择器失败: {e}")


@app.post("/api/open-folder")
def api_open_folder(req: dict):
    """在文件资源管理器中打开下载目录"""
    task_id = req.get("task_id", "")
    task = download_tasks.get(task_id)
    if not task:
        logger.warning(f"open-folder 任务不存在: task_id={task_id}")
        raise HTTPException(404, "任务不存在")

    file_path = task.get("file_path", "")
    if not file_path:
        logger.warning(f"open-folder 文件路径为空: task_id={task_id}")
        raise HTTPException(400, "文件路径不存在")

    folder = os.path.dirname(file_path)
    if os.path.exists(folder):
        try:
            open_folder_native(folder)
            logger.info(f"打开文件夹: {folder}")
            return {"success": True, "folder": folder}
        except Exception as e:
            logger.error(f"打开文件夹失败: folder={folder}", exc_info=True)
            raise HTTPException(500, f"打开文件夹失败: {e}")
    else:
        logger.error(f"文件夹不存在: folder={folder}")
        raise HTTPException(404, f"文件夹不存在: {folder}")


@app.get("/api/download/{task_id}")
async def api_download_file(task_id: str):
    """下载已完成的文件"""
    task = download_tasks.get(task_id)
    if not task:
        logger.warning(f"下载文件时任务不存在: task_id={task_id}")
        raise HTTPException(404, "任务不存在")
    if task["status"] != "completed":
        logger.warning(f"下载文件时任务未完成: task_id={task_id}, status={task['status']}")
        raise HTTPException(400, "文件尚未下载完成")

    file_path = task.get("file_path")
    if not file_path or not os.path.exists(file_path):
        logger.error(f"下载文件不存在: task_id={task_id}, file_path={file_path}")
        raise HTTPException(404, "文件不存在")

    filename = os.path.basename(file_path)
    return StreamingResponse(
        open(file_path, "rb"),
        media_type="video/mp4",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Content-Length": str(os.path.getsize(file_path)),
        },
    )


# ==================== 下载核心逻辑 ====================

async def _do_download(task_id: str, req: DownloadRequest):
    """执行实际下载"""
    task = download_tasks[task_id]

    try:
        # 1. 获取视频流地址
        task["status"] = "fetching"
        task["message"] = "正在获取下载地址..."
        task["progress"] = 0.05

        headers = {**HEADERS_TEMPLATE}
        if req.cookie:
            headers["Cookie"] = req.cookie

        async with httpx.AsyncClient(headers=headers, timeout=30.0) as client:
            resp = await client.get(
                "https://api.bilibili.com/x/player/playurl",
                params={
                    "bvid": req.bvid,
                    "cid": req.cid,
                    "qn": req.quality,
                    "fnver": 0,
                    "fnval": 4048,
                    "fourk": 1,
                },
            )
            data = resp.json()
            if data["code"] != 0:
                logger.error(f"B站 API 返回非0: bvid={req.bvid}, cid={req.cid}, code={data['code']}, message={data.get('message')}")
                raise Exception(f"获取下载地址失败: {data.get('message')}")

            play_data = data["data"]

            # 2. 解析流地址
            video_url = None
            audio_url = None
            durls = []

            if "dash" in play_data:
                # DASH 格式（音视频分离）
                dash = play_data["dash"]
                # 选择对应画质的视频流
                for v in dash.get("video", []):
                    if v["id"] == req.quality:
                        video_url = v.get("baseUrl") or v.get("base_url", "")
                        if not video_url and "backupUrl" in v:
                            video_url = v["backupUrl"][0] if v["backupUrl"] else ""
                        break
                    # 如果没匹配到，用第一个
                if not video_url and dash.get("video"):
                    v = dash["video"][0]
                    video_url = v.get("baseUrl") or v.get("base_url", "")

                # 选择最高质量音频
                if dash.get("audio"):
                    best_audio = max(dash["audio"], key=lambda a: a.get("bandwidth", 0))
                    audio_url = best_audio.get("baseUrl") or best_audio.get("base_url", "")
            else:
                # 旧格式（durl，音视频已合并）
                durls = play_data.get("durl", [])

            if not video_url and not durls:
                logger.error(f"未找到可用的视频流: bvid={req.bvid}, cid={req.cid}, quality={req.quality}")
                raise Exception("未找到可用的视频流")

            # 3. 确定下载目录
            if req.download_path and req.download_path.strip():
                output_dir = Path(req.download_path.strip())
            else:
                output_dir = DOWNLOAD_DIR
            output_dir.mkdir(parents=True, exist_ok=True)

            # 4. 纯音频模式
            if req.download_mode == "audio":
                if not audio_url:
                    logger.error(f"旧格式视频不支持纯音频下载: bvid={req.bvid}, cid={req.cid}")
                    raise Exception("此视频为旧格式（音视频已合并），不支持纯音频下载，请选择'视频+音频'模式")

                audio_tmp = output_dir / f"{task_id}_audio.m4s"
                safe_title = safe_filename(req.title)

                # 根据格式选择确定后缀和编码参数
                fmt = req.audio_format or "mp3"
                if fmt == "mp3":
                    ext = "mp3"
                    codec_args = ["-c:a", "libmp3lame", "-b:a", "320k"]
                elif fmt == "flac":
                    ext = "flac"
                    codec_args = ["-c:a", "flac"]
                elif fmt == "hires":
                    ext = "flac"
                    codec_args = ["-c:a", "flac", "-sample_fmt", "s32"]
                else:
                    ext = "mp3"
                    codec_args = ["-c:a", "libmp3lame", "-b:a", "320k"]

                output_filename = f"{safe_title}_audio.{ext}"
                output_path = output_dir / output_filename

                try:
                    # 下载音频流
                    task["status"] = "downloading_audio"
                    task["message"] = "正在下载音频流..."
                    task["progress"] = 0.1
                    await _download_file(client, audio_url, audio_tmp, headers, task, 0.1, 0.85)

                    # ffmpeg 编码转换
                    task["status"] = "processing"
                    task["message"] = f"正在转换为 {fmt.upper()}..."
                    task["progress"] = 0.85

                    cmd = [FFMPEG_PATH, "-y", "-i", str(audio_tmp)] + codec_args + [str(output_path)]
                    process = await asyncio.create_subprocess_exec(
                        *cmd,
                        stdout=asyncio.subprocess.PIPE,
                        stderr=asyncio.subprocess.PIPE,
                    )
                    stdout, stderr = await process.communicate()

                    if process.returncode != 0:
                        err_detail = stderr.decode() if stderr else "无错误输出"
                        logger.error(f"ffmpeg 音频转换失败: task_id={task_id}, fmt={fmt}, rc={process.returncode}, detail={err_detail[:500]}")
                        raise Exception(f"音频转换失败: {err_detail[:200]}")
                finally:
                    audio_tmp.unlink(missing_ok=True)

            # 5. 视频+音频模式（现有逻辑）
            else:
                # 构建输出文件名
                quality_name = QUALITY_MAP.get(req.quality, f"Q{req.quality}")
                safe_title = safe_filename(req.title)
                output_filename = f"{safe_title}_{quality_name}.mp4"
                output_path = output_dir / output_filename

                if video_url and audio_url:
                    # DASH 模式：并发下载视频和音频（提速明显）
                    video_tmp = output_dir / f"{task_id}_video.m4s"
                    audio_tmp = output_dir / f"{task_id}_audio.m4s"

                    try:
                        task["status"] = "downloading"
                        task["message"] = "正在并发下载视频+音频..."
                        task["progress"] = 0.1

                        await asyncio.gather(
                            _download_file(client, video_url, video_tmp, headers, task, 0.1, 0.85),
                            _download_file(client, audio_url, audio_tmp, headers, task, 0.1, 0.85),
                        )
                        task["progress"] = 0.85

                        # ffmpeg 合并（或硬烧录弹幕）
                        task["status"] = "merging"
                        task["progress"] = 0.85

                        # 硬烧录模式：先拉弹幕生成ASS，再合并时烧入画面
                        burn_ass = None
                        if req.download_danmaku and req.danmaku_mode == "burn":
                            try:
                                task["message"] = "正在获取弹幕..."
                                dm_data = await get_danmaku(req.cid, req.cookie)
                                safe_for_file = safe_filename(req.title)
                                burn_ass = output_dir / f"{safe_for_file}.ass"
                                ass_text = danmaku_to_ass(dm_data["list"], title=safe_for_file)
                                burn_ass.write_text(ass_text, encoding="utf-8")
                                task["message"] = "正在烧录弹幕到画面..."
                            except Exception as dm_ex:
                                logger.warning(f"弹幕获取失败，降级为普通合并: task_id={task_id}", exc_info=True)
                                burn_ass = None  # 弹幕获取失败，降级为普通合并

                        if burn_ass and burn_ass.exists():
                            safe_ass = output_dir / f"{task_id}_danmaku.ass"
                            safe_ass.write_text(burn_ass.read_text(encoding="utf-8"), encoding="utf-8")
                            try:
                                cmd = [
                                    FFMPEG_PATH, "-y",
                                    "-i", str(video_tmp.name),
                                    "-i", str(audio_tmp.name),
                                    "-vf", f"ass={safe_ass.name}",
                                    "-c:v", "libx264", "-crf", "20", "-preset", "fast",
                                    "-c:a", "copy",
                                    "-movflags", "+faststart",
                                    str(output_path.name),
                                ]
                                proc = await asyncio.create_subprocess_exec(
                                    *cmd,
                                    stdout=asyncio.subprocess.PIPE,
                                    stderr=asyncio.subprocess.PIPE,
                                    cwd=str(output_dir),
                                )
                                _, stderr = await proc.communicate()
                                if proc.returncode != 0:
                                    err_detail = stderr.decode()[:200] if stderr else "无错误输出"
                                    logger.error(f"ffmpeg 弹幕烧录失败: task_id={task_id}, rc={proc.returncode}, detail={err_detail}")
                                    raise Exception(f"弹幕烧录失败: {err_detail}")
                            finally:
                                safe_ass.unlink(missing_ok=True)
                                burn_ass.unlink(missing_ok=True)  # 烧录完删掉临时ASS
                        else:
                            task["message"] = "正在合并音视频..."
                            await _merge_audio_video(video_tmp, audio_tmp, output_path)
                    finally:
                        # 清理临时 .m4s 文件（无论成功或失败都清理）
                        video_tmp.unlink(missing_ok=True)
                        audio_tmp.unlink(missing_ok=True)

                elif durls:
                    # 旧格式：直接下载（音视频已合并）
                    task["status"] = "downloading"
                    task["message"] = "正在下载视频..."
                    task["progress"] = 0.15

                    # 尝试下载第一个分段
                    dl_url = durls[0]["url"]
                    await _download_file(client, dl_url, output_path, headers, task, 0.15, 0.95)

            # 6. 完成
            task["status"] = "completed"
            task["progress"] = 1.0
            task["message"] = f"下载完成: {output_filename}"
            task["file_path"] = str(output_path)
            task["file_size"] = os.path.getsize(output_path) if output_path.exists() else 0

            # 封面嵌入（MP4 内嵌缩略图，资源管理器显示为视频封面）
            if req.cover_url and output_path.suffix == ".mp4":
                try:
                    cover_tmp = output_dir / f"{task_id}_cover.jpg"
                    async with httpx.AsyncClient(timeout=30.0, headers={
                        "Referer": "https://www.bilibili.com",
                        "Origin": "https://www.bilibili.com",
                        "User-Agent": HEADERS_TEMPLATE.get("User-Agent", ""),
                    }) as cover_client:
                        resp = await cover_client.get(req.cover_url)
                        resp.raise_for_status()
                        cover_tmp.write_bytes(resp.content)

                    if cover_tmp.stat().st_size > 1024:  # 确保封面 > 1KB
                        tmp_out = output_path.with_suffix(".tmp.mp4")
                        cmd = [
                            FFMPEG_PATH, "-y",
                            "-i", str(output_path.name),
                            "-attach", str(cover_tmp.name),
                            "-c", "copy",
                            "-metadata:s:t", "mimetype=image/jpeg",
                            "-movflags", "+faststart",
                            str(tmp_out.name),
                        ]
                        proc = await asyncio.create_subprocess_exec(
                            *cmd,
                            stdout=asyncio.subprocess.PIPE,
                            stderr=asyncio.subprocess.PIPE,
                            cwd=str(output_dir),
                        )
                        _, stderr = await proc.communicate()
                        cover_tmp.unlink(missing_ok=True)

                        if proc.returncode == 0 and tmp_out.exists():
                            output_path.unlink(missing_ok=True)
                            tmp_out.rename(output_path)
                            task["file_size"] = os.path.getsize(output_path)
                        else:
                            tmp_out.unlink(missing_ok=True)
                            logger.warning(f"封面嵌入失败: task_id={task_id}, detail={stderr.decode()[:200]}")
                    else:
                        cover_tmp.unlink(missing_ok=True)
                        logger.warning(f"封面文件太小，跳过嵌入: task_id={task_id}")
                except Exception as e:
                    logger.warning(f"封面处理失败: task_id={task_id}", exc_info=True)

            # 7. 弹幕保存（可选）
            if req.download_danmaku:
                is_burn = (req.danmaku_mode == "burn" and req.download_mode == "video")

                if is_burn:
                    # 烧录模式：弹幕已刻入画面，无需额外保存文件
                    task["message"] += " + 弹幕(已烧录)"
                else:
                    try:
                        dm_data = await get_danmaku(req.cid, req.cookie)
                        safe_title = safe_filename(req.title)
                        # 保存 XML
                        xml_path = output_dir / f"{safe_title}.xml"
                        xml_path.write_text(dm_data["xml"], encoding="utf-8")
                        # 保存 JSON
                        json_path = output_dir / f"{safe_title}.json"
                        json_path.write_text(json.dumps(dm_data["list"], ensure_ascii=False, indent=2), encoding="utf-8")
                        # 保存 ASS
                        ass_path = output_dir / f"{safe_title}.ass"
                        ass_text = danmaku_to_ass(dm_data["list"], title=safe_title)
                        ass_path.write_text(ass_text, encoding="utf-8")

                        # 视频模式下，将 ASS 软封装进 MKV
                        if req.download_mode == "video" and output_path.suffix == ".mp4":
                            mkv_path = output_path.with_suffix(".mkv")
                            mux_cmd = [
                                FFMPEG_PATH, "-y",
                                "-i", str(output_path),
                                "-i", str(ass_path),
                                "-c:v", "copy", "-c:a", "copy", "-c:s", "copy",
                                "-map", "0:v", "-map", "0:a", "-map", "1:s",
                                "-metadata:s:s:0", "language=chi",
                                "-disposition:s:0", "default",
                                str(mkv_path),
                            ]
                            proc = await asyncio.create_subprocess_exec(
                                *mux_cmd,
                                stdout=asyncio.subprocess.PIPE,
                                stderr=asyncio.subprocess.PIPE,
                            )
                            _, stderr = await proc.communicate()
                            if proc.returncode == 0 and mkv_path.exists():
                                output_path.unlink(missing_ok=True)
                                task["file_path"] = str(mkv_path)
                                task["file_size"] = os.path.getsize(mkv_path)
                                task["message"] = f"下载完成: {mkv_path.name} + 弹幕({dm_data['count']}条)"
                            else:
                                task["message"] += f" + 弹幕({dm_data['count']}条, 封装失败)";
                    except Exception as dm_err:
                        logger.warning(f"弹幕保存失败: task_id={task_id}, bvid={req.bvid}", exc_info=True)
                        task["message"] += " (弹幕保存失败)"

    except Exception as e:
        task["status"] = "failed"
        task["message"] = str(e)
        logger.error(f"下载失败: task_id={task_id}, bvid={req.bvid}, title={req.title}, quality={req.quality}", exc_info=True)


async def _download_file(
    client: httpx.AsyncClient,
    url: str,
    dest: Path,
    headers: dict,
    task: dict,
    progress_start: float,
    progress_end: float,
):
    """下载单个文件，带进度"""
    download_headers = {
        **headers,
        "Referer": "https://www.bilibili.com",
        "Origin": "https://www.bilibili.com",
    }

    async with client.stream("GET", url, headers=download_headers) as resp:
        resp.raise_for_status()
        total = int(resp.headers.get("Content-Length", 0))

        with open(dest, "wb") as f:
            downloaded = 0
            async for chunk in resp.aiter_bytes(4 * 1024 * 1024):  # 4MB chunks
                f.write(chunk)
                downloaded += len(chunk)
                if total > 0:
                    ratio = downloaded / total
                    task["progress"] = progress_start + ratio * (progress_end - progress_start)
                    task["message"] = f"下载中... {downloaded // 1024 // 1024}MB / {total // 1024 // 1024}MB"


async def _merge_audio_video(video_path: Path, audio_path: Path, output_path: Path):
    """使用 ffmpeg 合并音视频"""
    cmd = [
        FFMPEG_PATH,
        "-y",  # 覆盖已存在文件
        "-i", str(video_path),
        "-i", str(audio_path),
        "-c:v", "copy",   # 视频直接复制，不重新编码
        "-c:a", "copy",   # 音频直接复制，不重新编码
        "-movflags", "+faststart",  # 优化流式播放
        str(output_path),
    ]

    process = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await process.communicate()

    if process.returncode != 0:
        err_msg = stderr.decode() if stderr else "ffmpeg 合并失败"
        logger.error(f"ffmpeg 合并失败: rc={process.returncode}, detail={err_msg[:500]}")
        raise Exception(f"ffmpeg 合并失败: {err_msg[:500]}")


# ==================== 日志 API ====================

class LogEntry(BaseModel):
    level: str = "ERROR"          # ERROR / WARNING / INFO
    module: str = "unknown"        # background / popup / content
    message: str = ""
    context: dict = {}
    stack: str = ""


@app.post("/api/log")
async def api_log(entry: LogEntry):
    """接收浏览器扩展端的日志，统一写入后端日志文件"""
    ext_logger = get_logger(f"ext_{entry.module}")

    extra = {
        "context": entry.context,
        "stack": entry.stack,
    }

    level = entry.level.upper()
    if level == "ERROR":
        ext_logger.error(f"[扩展:{entry.module}] {entry.message}", extra=extra)
    elif level == "WARNING":
        ext_logger.warning(f"[扩展:{entry.module}] {entry.message}", extra=extra)
    else:
        ext_logger.info(f"[扩展:{entry.module}] {entry.message}", extra=extra)

    return {"success": True}


@app.get("/api/logs")
async def api_logs(date: str = "", level: str = "", module: str = "", limit: int = 100):
    """查询日志，支持按日期、级别、模块筛选"""
    entries = read_logs(module=module or "", date=date, level=level, limit=min(limit, 500))
    return {
        "success": True,
        "count": len(entries),
        "logs": entries,
    }


@app.get("/api/log-files")
async def api_log_files():
    """获取日志文件列表"""
    files = get_log_files()
    return {
        "success": True,
        "files": files,
    }


# ==================== 启动 ====================

if __name__ == "__main__":
    import uvicorn
    logger.info(f"服务启动 - ffmpeg 路径: {FFMPEG_PATH}, 下载目录: {DOWNLOAD_DIR}")
    uvicorn.run("server:app", host="127.0.0.1", port=8765, reload=False)
