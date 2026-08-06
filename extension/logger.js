/**
 * B站视频下载助手 - 统一日志工具
 * 日志会先写入扩展本地环形缓存，再尝试发送到本地后端统一存储。
 * 即使下载服务未启动，popup 也能复制最近的扩展诊断日志。
 *
 * 使用方式:
 *   Log.error('描述', errorObject, { bvid: 'xxx' });
 *   Log.warn('描述', { cid: 123 });
 *   Log.info('描述');
 *   const logs = await Log.getLocalLogs(500);
 */

'use strict';

var Log = globalThis.Log || (function () {
  const LOG_API = 'http://127.0.0.1:8765/api/log';
  const LOCAL_LOG_STORAGE_KEY = 'bili_downloader_local_logs_v1';
  const LOCAL_LOG_LIMIT_PER_MODULE = 100;
  const MESSAGE_LIMIT = 2000;
  const STACK_LIMIT = 8000;
  const CONTEXT_LIMIT = 8000;
  const SENSITIVE_KEY_PATTERN = /cookie|authorization|token|sessdata|access[_-]?key|refresh[_-]?token/i;

  let localWriteQueue = Promise.resolve();

  function truncate(value, limit) {
    const text = value == null ? '' : String(value);
    if (text.length <= limit) return text;
    return `${text.slice(0, limit)}…[已截断]`;
  }

  function sanitizeText(value, limit) {
    const redacted = String(value == null ? '' : value)
      .replace(/(authorization\s*[:=]\s*)(?:bearer\s+)?[^\s,;]+/gi, '$1[REDACTED]')
      .replace(/(cookie\s*[:=]\s*)[^\r\n]+/gi, '$1[REDACTED]')
      .replace(/((?:sessdata|token|access[_-]?key|refresh[_-]?token)\s*[:=]\s*)[^&;,\s]+/gi, '$1[REDACTED]');
    return truncate(redacted, limit);
  }

  /** 自动检测当前模块名 */
  function getModuleName() {
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime) {
        if (typeof document === 'undefined') return 'background';
        try {
          if (document.getElementById && document.getElementById('download-btn')) {
            return 'popup';
          }
        } catch (e) {
          // 忽略 DOM 访问错误
        }
        return 'content';
      }
    } catch (e) {
      // 忽略
    }
    return 'unknown';
  }

  /** 获取当前页面/标签页 URL（用于上下文） */
  function getPageUrl() {
    try {
      if (typeof window !== 'undefined' && window.location) return window.location.href;
      if (typeof self !== 'undefined' && self.location) return self.location.href;
    } catch (e) {
      // Service Worker 中没有 window/location
    }
    return '';
  }

  function getStack(error) {
    if (!error) return '';
    if (typeof error === 'string') return error;
    if (error.stack) return error.stack;
    if (error.message) return error.message;
    return String(error);
  }

  function getErrorMessage(error) {
    if (!error) return '';
    if (typeof error === 'string') return error;
    if (error.message) return error.message;
    return String(error);
  }

  /** 递归清理上下文，过滤凭据并限制对象深度和大小 */
  function sanitizeValue(value, key = '', depth = 0, seen = new WeakSet()) {
    if (SENSITIVE_KEY_PATTERN.test(key)) return '[REDACTED]';
    if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
    if (typeof value === 'string') return sanitizeText(value, MESSAGE_LIMIT);
    if (typeof value !== 'object') return sanitizeText(value, MESSAGE_LIMIT);
    if (depth >= 3) return '[已截断：层级过深]';
    if (seen.has(value)) return '[已截断：循环引用]';

    seen.add(value);
    if (Array.isArray(value)) {
      return value.slice(0, 20).map(item => sanitizeValue(item, '', depth + 1, seen));
    }

    const result = {};
    Object.keys(value).slice(0, 30).forEach(childKey => {
      result[childKey] = sanitizeValue(value[childKey], childKey, depth + 1, seen);
    });
    return result;
  }

  function sanitizeContext(context) {
    const sanitized = sanitizeValue(context || {});
    try {
      const serialized = JSON.stringify(sanitized);
      if (serialized.length > CONTEXT_LIMIT) {
        return { truncated: truncate(serialized, CONTEXT_LIMIT) };
      }
    } catch (e) {
      return { error: '上下文无法序列化' };
    }
    return sanitized;
  }

  function canUseLocalStorage() {
    return typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;
  }

  /** 把日志追加到当前模块的本地环形缓存 */
  function persistLocal(entry) {
    if (!canUseLocalStorage()) return Promise.resolve();

    localWriteQueue = localWriteQueue.then(async () => {
      const stored = await chrome.storage.local.get(LOCAL_LOG_STORAGE_KEY);
      const buffers = stored[LOCAL_LOG_STORAGE_KEY] || {};
      const moduleKey = entry.module || 'ext_unknown';
      const moduleLogs = Array.isArray(buffers[moduleKey]) ? buffers[moduleKey] : [];
      moduleLogs.push(entry);
      buffers[moduleKey] = moduleLogs.slice(-LOCAL_LOG_LIMIT_PER_MODULE);
      await chrome.storage.local.set({ [LOCAL_LOG_STORAGE_KEY]: buffers });
    }).catch(error => {
      console.error('[Logger] 本地日志保存失败:', error.message);
    });

    return localWriteQueue;
  }

  /** 读取所有模块的本地日志，按时间从新到旧排列 */
  async function getLocalLogs(limit = 500) {
    if (!canUseLocalStorage() || limit <= 0) return [];

    await localWriteQueue.catch(() => {});
    try {
      const stored = await chrome.storage.local.get(LOCAL_LOG_STORAGE_KEY);
      const buffers = stored[LOCAL_LOG_STORAGE_KEY] || {};
      const logs = Object.values(buffers)
        .filter(Array.isArray)
        .flat()
        .filter(entry => entry && typeof entry === 'object');

      logs.sort((a, b) => {
        const aTime = Date.parse(a.timestamp || '') || 0;
        const bTime = Date.parse(b.timestamp || '') || 0;
        return bTime - aTime;
      });
      return logs.slice(0, limit);
    } catch (error) {
      console.error('[Logger] 本地日志读取失败:', error.message);
      return [];
    }
  }

  /** 先保存本地日志，再尝试发送到后端 */
  async function sendLog(level, context, message, error) {
    const module = getModuleName();
    const errorMessage = error ? getErrorMessage(error) : '';
    const fullMessage = sanitizeText(message + (errorMessage ? ` | ${errorMessage}` : ''), MESSAGE_LIMIT);
    const safeContext = sanitizeContext(Object.assign({ url: getPageUrl() }, context || {}));
    const safeStack = error ? sanitizeText(getStack(error), STACK_LIMIT) : '';

    const localEntry = {
      timestamp: new Date().toISOString(),
      level,
      module: `ext_${module}`,
      message: fullMessage,
      context: safeContext,
      stack: safeStack,
    };

    await persistLocal(localEntry);

    const backendEntry = {
      level,
      module,
      message: fullMessage,
      context: safeContext,
      stack: safeStack,
    };

    let timeout = null;
    try {
      const controller = new AbortController();
      timeout = setTimeout(() => controller.abort(), 3000);
      await fetch(LOG_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(backendEntry),
        signal: controller.signal,
      });
    } catch (sendError) {
      console.error('[Logger] 日志发送失败:', sendError.message, backendEntry);
    } finally {
      if (timeout) clearTimeout(timeout);
    }

    return localEntry;
  }

  return {
    error: function (message, error, context) {
      return sendLog('ERROR', context, message, error);
    },
    warn: function (message, context) {
      return sendLog('WARNING', context, message, null);
    },
    info: function (message, context) {
      return sendLog('INFO', context, message, null);
    },
    getLocalLogs,
    storageKey: LOCAL_LOG_STORAGE_KEY,
  };
})();

globalThis.Log = Log;
