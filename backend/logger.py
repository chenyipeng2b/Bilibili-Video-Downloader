"""
统一日志模块
- 纯文本 .log + JSON .json.log 双格式输出
- 按天轮转（每天 0 点自动切分新文件）
- 自动创建 logs/ 目录
- 支持 DEBUG / INFO / WARNING / ERROR 四个级别
"""

import json
import logging
import os
import sys
import traceback
from datetime import datetime
from logging.handlers import TimedRotatingFileHandler
from pathlib import Path
from typing import Optional

# 日志目录
LOG_DIR = Path(__file__).parent / "logs"
LOG_DIR.mkdir(parents=True, exist_ok=True)

# 保留天数
LOG_RETENTION_DAYS = 30

# 已创建的 logger 缓存（避免重复创建 handler）
_logger_cache: dict[str, logging.Logger] = {}


class TextFormatter(logging.Formatter):
    """纯文本格式：[时间] [级别] [模块:函数:行号] 消息"""

    def format(self, record: logging.LogRecord) -> str:
        ts = datetime.fromtimestamp(record.created).strftime("%Y-%m-%d %H:%M:%S") + \
             f".{int(record.msecs):03d}"
        module = record.name
        func = record.funcName
        line = record.lineno
        prefix = f"[{ts}] [{record.levelname:<7}] [{module}:{func}:{line}]"
        msg = record.getMessage()

        # 如果有异常信息，追加堆栈
        if record.exc_info and record.exc_info[1]:
            exc_msg = f"{record.exc_info[0].__name__}: {record.exc_info[1]}"
            tb = "".join(traceback.format_tb(record.exc_info[2]))
            return f"{prefix} {msg}\n  Exception: {exc_msg}\n  Traceback:\n{tb}"

        return f"{prefix} {msg}"


class JsonFormatter(logging.Formatter):
    """JSON 结构化格式，每行一个 JSON 对象"""

    def format(self, record: logging.LogRecord) -> str:
        entry: dict = {
            "timestamp": datetime.fromtimestamp(record.created).strftime("%Y-%m-%dT%H:%M:%S") +
                         f".{int(record.msecs):03d}",
            "level": record.levelname,
            "module": record.name,
            "function": record.funcName,
            "line": record.lineno,
            "message": record.getMessage(),
        }

        # 添加异常信息
        if record.exc_info and record.exc_info[1]:
            entry["exception"] = {
                "type": record.exc_info[0].__name__,
                "message": str(record.exc_info[1]),
            }
            entry["traceback"] = "".join(traceback.format_tb(record.exc_info[2]))

        # 添加自定义上下文字段（如果通过 extra 传入）
        for key in ("context", "bvid", "cid", "quality", "task_id", "url", "stack"):
            if hasattr(record, key):
                val = getattr(record, key, None)
                if val is not None and (key != "stack" or val):
                    entry[key] = val

        return json.dumps(entry, ensure_ascii=False)


def get_logger(name: str) -> logging.Logger:
    """
    获取指定名称的 logger，自动创建双格式 Handler。

    Args:
        name: 模块名称，如 "server", "bilibili_api", "background", "popup", "content"

    Returns:
        配置好的 logging.Logger 实例
    """
    if name in _logger_cache:
        return _logger_cache[name]

    logger = logging.getLogger(name)
    logger.setLevel(logging.DEBUG)
    logger.propagate = False  # 不传递到根 logger

    # 避免重复添加 handler
    if logger.handlers:
        _logger_cache[name] = logger
        return logger

    # 纯文本 Handler（按天轮转）
    text_file = LOG_DIR / f"{name}.log"
    text_handler = TimedRotatingFileHandler(
        filename=str(text_file),
        when="midnight",
        interval=1,
        backupCount=LOG_RETENTION_DAYS,
        encoding="utf-8",
    )
    text_handler.suffix = "%Y-%m-%d"
    text_handler.setLevel(logging.DEBUG)
    text_handler.setFormatter(TextFormatter())
    logger.addHandler(text_handler)

    # JSON Handler（按天轮转）
    json_file = LOG_DIR / f"{name}.json.log"
    json_handler = TimedRotatingFileHandler(
        filename=str(json_file),
        when="midnight",
        interval=1,
        backupCount=LOG_RETENTION_DAYS,
        encoding="utf-8",
    )
    json_handler.suffix = "%Y-%m-%d"
    json_handler.setLevel(logging.DEBUG)
    json_handler.setFormatter(JsonFormatter())
    logger.addHandler(json_handler)

    # 控制台 Handler（INFO 及以上）
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(logging.INFO)
    console_handler.setFormatter(
        logging.Formatter("[%(levelname)-7s] %(name)s: %(message)s")
    )
    logger.addHandler(console_handler)

    _logger_cache[name] = logger
    return logger


def log_error(
    logger: logging.Logger,
    message: str,
    exc_info: bool = True,
    extra: Optional[dict] = None,
) -> None:
    """
    便捷函数：记录 ERROR 级别日志并自动捕获异常堆栈。

    Args:
        logger: Logger 实例
        message: 错误描述
        exc_info: 是否记录异常堆栈（默认 True）
        extra: 额外上下文字典
    """
    logger.error(message, exc_info=exc_info, extra=extra or {})


def log_warning(
    logger: logging.Logger,
    message: str,
    extra: Optional[dict] = None,
) -> None:
    """便捷函数：记录 WARNING 级别日志"""
    logger.warning(message, extra=extra or {})


def log_info(
    logger: logging.Logger,
    message: str,
    extra: Optional[dict] = None,
) -> None:
    """便捷函数：记录 INFO 级别日志"""
    logger.info(message, extra=extra or {})


def log_debug(
    logger: logging.Logger,
    message: str,
    extra: Optional[dict] = None,
) -> None:
    """便捷函数：记录 DEBUG 级别日志"""
    logger.debug(message, extra=extra or {})


def get_log_files() -> list[dict]:
    """获取所有日志文件列表，按日期排序"""
    files = []
    if not LOG_DIR.exists():
        return files

    for f in sorted(LOG_DIR.iterdir(), reverse=True):
        if f.is_file() and f.suffix in (".log",):
            files.append({
                "name": f.name,
                "path": str(f),
                "size": f.stat().st_size,
                "modified": datetime.fromtimestamp(f.stat().st_mtime).isoformat(),
            })

    return files


def read_logs(
    module: str = "",
    date: str = "",
    level: str = "",
    limit: int = 100,
) -> list[dict]:
    """
    读取最近的日志条目。

    Args:
        module: 筛选模块名（如 "server"），空表示所有
        date: 筛选日期（如 "2026-08-03"），空表示所有
        level: 筛选级别（ERROR/WARNING/INFO），空表示所有
        limit: 返回条数上限

    Returns:
        日志条目列表（JSON 格式）
    """
    if limit <= 0 or not LOG_DIR.exists():
        return []

    # 同时读取当前日志和按天轮转后的日志，再做全局时间排序。
    # 每个文件最多读取 limit 条即可：全局前 limit 条不可能需要某个文件
    # 中排名在 limit 之后的记录。
    log_files = set(LOG_DIR.glob("*.json.log"))
    log_files.update(LOG_DIR.glob("*.json.log.*"))

    if module:
        module_prefix = f"{module}.json.log"
        log_files = {
            path for path in log_files
            if path.name == module_prefix or path.name.startswith(f"{module_prefix}.")
        }

    results = []
    for filepath in log_files:
        results.extend(_parse_json_log(filepath, date, level, limit))

    results.sort(key=lambda entry: entry.get("timestamp", ""), reverse=True)
    return results[:limit]


def _parse_json_log(filepath: Path, date: str, level: str, limit: int) -> list[dict]:
    """解析单个 JSON 日志文件"""
    results = []
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            lines = f.readlines()

        # 从后往前读（最近的在前）
        for line in reversed(lines):
            if len(results) >= limit:
                break
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
                ts = entry.get("timestamp", "")

                # 按日期筛选
                if date and not ts.startswith(date):
                    continue

                # 按级别筛选
                if level and entry.get("level", "").upper() != level.upper():
                    continue

                results.append(entry)
            except json.JSONDecodeError:
                continue
    except Exception:
        pass

    return results
