"""
B站 API 调用模块
处理视频信息获取、流地址解析等
"""

import hashlib
import time
import urllib.parse
import xml.etree.ElementTree as ET
import httpx

from logger import get_logger

# 初始化日志
logger = get_logger("bilibili_api")

# B站 API 基础配置
BILIBILI_API_BASE = "https://api.bilibili.com"
HEADERS_TEMPLATE = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Referer": "https://www.bilibili.com",
    "Origin": "https://www.bilibili.com",
}

# 画质映射
QUALITY_MAP = {
    127: "8K 超高清",
    126: "杜比视界",
    125: "HDR 真彩",
    120: "4K 超清",
    116: "1080P60 高帧率",
    112: "1080P 高码率",
    80:  "1080P 高清",
    74:  "720P60 高帧率",
    64:  "720P 高清",
    32:  "480P 清晰",
    16:  "360P 流畅",
    6:   "240P 极速",
}

# 画质优先级（从高到低）
QUALITY_ORDER = [127, 126, 125, 120, 116, 112, 80, 74, 64, 32, 16, 6]


def extract_bvid(url: str) -> str | None:
    """从 B站各种链接中提取 BV 号"""
    import re
    patterns = [
        r'BV[a-zA-Z0-9]{10}',           # BV 号直接提取
        r'bilibili\.com/video/(BV[a-zA-Z0-9]{10})',
        r'b23\.tv/([a-zA-Z0-9]+)',       # 短链接
    ]
    for pattern in patterns:
        match = re.search(pattern, url)
        if match:
            bvid = match.group(1) if '(' in pattern else match.group(0)
            # 如果是短链接，可能需要重定向展开（暂时返回原值）
            return bvid
    return None


async def get_video_info(bvid: str, cookie: str = "") -> dict:
    """
    获取视频基本信息（标题、封面、分P列表等）
    """
    headers = {**HEADERS_TEMPLATE}
    if cookie:
        headers["Cookie"] = cookie

    async with httpx.AsyncClient(headers=headers, timeout=15.0) as client:
        resp = await client.get(
            f"{BILIBILI_API_BASE}/x/web-interface/view",
            params={"bvid": bvid}
        )
        resp.raise_for_status()
        data = resp.json()

        if data["code"] != 0:
            logger.error(f"B站 API 获取视频信息失败: bvid={bvid}, code={data['code']}, message={data.get('message', '未知错误')}")
            raise Exception(f"获取视频信息失败: {data.get('message', '未知错误')}")

        video_data = data["data"]
        return {
            "bvid": bvid,
            "title": video_data["title"],
            "cover": video_data["pic"],
            "desc": video_data["desc"],
            "duration": video_data["duration"],
            "owner": {
                "name": video_data["owner"]["name"],
                "face": video_data["owner"]["face"],
            },
            "pages": [
                {
                    "cid": page["cid"],
                    "part": page["part"],
                    "duration": page["duration"],
                }
                for page in video_data["pages"]
            ],
        }


async def get_video_streams(
    bvid: str, cid: int, cookie: str = ""
) -> dict:
    """
    获取视频流地址（DASH 格式，音视频分离）
    返回可用的画质列表和对应的下载地址
    """
    headers = {**HEADERS_TEMPLATE}
    if cookie:
        headers["Cookie"] = cookie

    params = {
        "bvid": bvid,
        "cid": cid,
        "qn": 127,          # 请求最高画质
        "fnver": 0,
        "fnval": 4048,      # DASH 格式（音视频分离）+ 支持 4K/8K
        "fourk": 1,          # 请求 4K
    }

    async with httpx.AsyncClient(headers=headers, timeout=15.0) as client:
        resp = await client.get(
            f"{BILIBILI_API_BASE}/x/player/playurl",
            params=params
        )
        resp.raise_for_status()
        data = resp.json()

        if data["code"] != 0:
            logger.error(f"B站 API 获取视频流失败: bvid={bvid}, cid={cid}, code={data['code']}, message={data.get('message', '未知错误')}")
            raise Exception(f"获取视频流失败: {data.get('message', '未知错误')}")

        play_data = data["data"]

        # 视频流
        video_streams = []
        if "dash" in play_data:
            for v in play_data["dash"].get("video", []):
                video_streams.append({
                    "id": v["id"],
                    "quality": v["id"],
                    "quality_name": QUALITY_MAP.get(v["id"], f"未知画质({v['id']})"),
                    "format": v.get("codecs", "unknown"),
                    "width": v.get("width", 0),
                    "height": v.get("height", 0),
                    "frame_rate": v.get("frameRate", v.get("frame_rate", "unknown")),
                    "bandwidth": v.get("bandwidth", 0),
                    "base_url": v.get("baseUrl", v.get("base_url", "")),
                    "backup_urls": v.get("backupUrl", v.get("backup_url", [])),
                    "mime_type": v.get("mimeType", v.get("mime_type", "video/mp4")),
                })

        # 音频流
        audio_streams = []
        if "dash" in play_data:
            for a in play_data["dash"].get("audio", []):
                audio_streams.append({
                    "id": a["id"],
                    "quality_name": f"{a.get('bandwidth', 0) // 1000}kbps",
                    "bandwidth": a.get("bandwidth", 0),
                    "base_url": a.get("baseUrl", a.get("base_url", "")),
                    "backup_urls": a.get("backupUrl", a.get("backup_url", [])),
                    "mime_type": a.get("mimeType", a.get("mime_type", "audio/mp4")),
                })

        # 按画质从高到低排序
        video_streams.sort(key=lambda x: QUALITY_ORDER.index(x["quality"]) 
                           if x["quality"] in QUALITY_ORDER else 999)

        # 如果只有非 DASH 流（旧视频），使用 durl
        durl_streams = play_data.get("durl", [])

        return {
            "bvid": bvid,
            "cid": cid,
            "quality": play_data.get("quality", 0),
            "quality_name": QUALITY_MAP.get(play_data.get("quality", 0), "未知"),
            "video_streams": video_streams,
            "audio_streams": audio_streams,
            "durl_streams": durl_streams,  # 旧格式（音视频合并），备用
            "accept_quality": play_data.get("accept_quality", []),
            "accept_description": play_data.get("accept_description", []),
        }


def build_download_url(base_url: str) -> str:
    """
    处理下载 URL（部分需要修改 host 才能直链下载）
    """
    if not base_url:
        return ""
    # B站 CDN 的 URL 通常可以直接下载，但需要保留查询参数
    # 有时需要替换 host 避免跨域问题
    return base_url


async def get_danmaku(cid: int, cookie: str = "") -> dict:
    """
    获取视频弹幕（XML格式），解析为结构化数据
    返回 {"xml": 原始XML字符串, "list": [{"time":浮点秒, "type":int, "fontsize":int, "color":int, "text":str}, ...]}
    """
    headers = {**HEADERS_TEMPLATE}
    if cookie:
        headers["Cookie"] = cookie

    async with httpx.AsyncClient(headers=headers, timeout=15.0) as client:
        resp = await client.get(
            f"{BILIBILI_API_BASE}/x/v1/dm/list.so",
            params={"oid": cid}
        )
        resp.raise_for_status()
        raw_xml = resp.text

    # 解析 XML 弹幕
    root = ET.fromstring(raw_xml)
    ns = {"ns": "http://www.w3.org/2000/XML/Namespace"}  # 忽略命名空间

    danmaku_list = []
    for d_elem in root.iter("d"):
        p_str = d_elem.get("p", "")
        text = (d_elem.text or "").strip()
        if not text:
            continue

        # p 属性格式: time,type,fontsize,color,timestamp,pool,sender,dbid
        parts = p_str.split(",")
        try:
            time_sec = float(parts[0]) if len(parts) > 0 else 0
            dm_type = int(parts[1]) if len(parts) > 1 else 1
            fontsize = int(parts[2]) if len(parts) > 2 else 25
            color = int(parts[3]) if len(parts) > 3 else 16777215
        except (ValueError, IndexError):
            logger.debug(f"弹幕 p 属性解析失败，使用默认值: cid={cid}, p_str={p_str[:50]}")
            time_sec = 0
            dm_type = 1
            fontsize = 25
            color = 16777215

        danmaku_list.append({
            "time": time_sec,
            "type": dm_type,
            "fontsize": fontsize,
            "color": color,
            "text": text,
        })

    return {
        "xml": raw_xml,
        "list": danmaku_list,
        "count": len(danmaku_list),
    }


def danmaku_to_ass(danmaku_list: list, width: int = 1920, height: int = 1080, title: str = "") -> str:
    """
    将弹幕列表转换为 ASS 字幕格式，可在 PotPlayer/VLC/MPC 中叠加显示
    """
    base_fontsize = max(24, height // 36)
    duration = 8.0  # 滚动弹幕持续秒数

    # 颜色：B站十进制 → ASS BBGGRR 十六进制
    def to_ass_color(dec_color: int) -> str:
        r = (dec_color >> 16) & 0xFF
        g = (dec_color >> 8) & 0xFF
        b = dec_color & 0xFF
        return f"&H{b:02X}{g:02X}{r:02X}"

    # 秒 → ASS 时间 H:MM:SS.cc
    def to_ass_time(sec: float) -> str:
        h = int(sec // 3600)
        m = int((sec % 3600) // 60)
        s = sec % 60
        return f"{h}:{m:02d}:{s:05.2f}"

    lines = []
    lines.append("[Script Info]")
    lines.append(f"Title: {title} Danmaku")
    lines.append("ScriptType: v4.00+")
    lines.append(f"PlayResX: {width}")
    lines.append(f"PlayResY: {height}")
    lines.append("WrapStyle: 2")
    lines.append("ScaledBorderAndShadow: yes")
    lines.append("YCbCr Matrix: None")
    lines.append("")
    lines.append("[V4+ Styles]")
    lines.append("Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, "
                 "OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, "
                 "ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, "
                 "Alignment, MarginL, MarginR, MarginV, Encoding")
    lines.append(f"Style: Default,Microsoft YaHei,{base_fontsize},&H00FFFFFF,&H000000FF,"
                 f"&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,2,0,2,10,10,10,1")
    lines.append("")
    lines.append("[Events]")
    lines.append("Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text")

    # 轨迹管理：避让同时间滚动弹幕
    track_usage = {}  # {track_index: free_until_time}
    MAX_TRACKS = 12

    for dm in sorted(danmaku_list, key=lambda d: d["time"]):
        t = dm["time"]
        color = to_ass_color(dm["color"])
        text = dm["text"]
        fs = base_fontsize
        dm_type = dm["type"]

        start = to_ass_time(t)

        if dm_type in (1, 2, 3):
            # 滚动弹幕 (右→左)
            # 分配轨道避让
            track = 0
            for i in range(MAX_TRACKS):
                if track_usage.get(i, 0) <= t:
                    track = i
                    break
            track_usage[track] = t + 4.0  # 4秒后释放
            y_pos = 50 + track * (base_fontsize + 8)
            end = to_ass_time(t + duration)
            move = f"{{\\move({width + 100},{y_pos},-500,{y_pos})}}"
            lines.append(f"Dialogue: 0,{start},{end},Default,,0,0,0,,{move}{{\\c{color}\\fs{fs}}}{text}")

        elif dm_type == 4:
            # 底部固定
            end = to_ass_time(t + 5.0)
            pos = f"{{\\an2\\pos({width // 2},{height - 60})}}"
            lines.append(f"Dialogue: 0,{start},{end},Default,,0,0,0,,{pos}{{\\c{color}\\fs{fs}}}{text}")

        elif dm_type == 5:
            # 顶部固定
            end = to_ass_time(t + 5.0)
            pos = f"{{\\an8\\pos({width // 2},60)}}"
            lines.append(f"Dialogue: 0,{start},{end},Default,,0,0,0,,{pos}{{\\c{color}\\fs{fs}}}{text}")

        elif dm_type == 6:
            # 逆向滚动 (左→右)
            end = to_ass_time(t + duration)
            move = f"{{\\move(-500,{height // 2},{width + 100},{height // 2})}}"
            lines.append(f"Dialogue: 0,{start},{end},Default,,0,0,0,,{move}{{\\c{color}\\fs{fs}}}{text}")

        else:
            # 高级/特殊弹幕，当顶部固定处理
            end = to_ass_time(t + 5.0)
            pos = f"{{\\an8\\pos({width // 2},60)}}"
            lines.append(f"Dialogue: 0,{start},{end},Default,,0,0,0,,{pos}{{\\c{color}\\fs{fs}}}{text}")

    return "\n".join(lines)
