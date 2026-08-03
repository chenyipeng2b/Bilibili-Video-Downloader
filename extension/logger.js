/**
 * B站视频下载助手 - 统一日志工具
 * 浏览器扩展端日志模块，将日志通过 fetch 发送到后端统一存储
 *
 * 使用方式:
 *   Log.error('描述', errorObject, { bvid: 'xxx' });
 *   Log.warn('描述', { cid: 123 });
 *   Log.info('描述');
 */

'use strict';

const LOG_API = 'http://127.0.0.1:8765/api/log';

const Log = (function () {
  /**
   * 自动检测当前模块名
   */
  function getModuleName() {
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime) {
        // background.js (Service Worker) 没有 document
        if (typeof document === 'undefined') {
          return 'background';
        }
        // popup 有 document 且有 popup 相关的 DOM
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

  /**
   * 获取当前页面/标签页 URL（用于上下文）
   */
  function getPageUrl() {
    try {
      if (typeof window !== 'undefined' && window.location) {
        return window.location.href;
      }
      if (typeof self !== 'undefined' && self.location) {
        return self.location.href;
      }
    } catch (e) {
      // Service Worker 中没有 window/location
    }
    return '';
  }

  /**
   * 提取错误堆栈
   */
  function getStack(error) {
    if (!error) return '';
    if (typeof error === 'string') return error;
    if (error.stack) return error.stack;
    if (error.message) return error.message;
    return String(error);
  }

  /**
   * 提取错误消息
   */
  function getErrorMessage(error) {
    if (!error) return '';
    if (typeof error === 'string') return error;
    if (error.message) return error.message;
    return String(error);
  }

  /**
   * 发送日志到后端
   */
  async function sendLog(level, context, message, error) {
    const module = getModuleName();
    const errorMessage = error ? getErrorMessage(error) : '';
    const fullMessage = message + (errorMessage ? ` | ${errorMessage}` : '');

    const entry = {
      level: level,
      module: module,
      message: fullMessage,
      context: Object.assign({ url: getPageUrl() }, context || {}),
      stack: error ? getStack(error) : '',
    };

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);

      await fetch(LOG_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry),
        signal: controller.signal,
      });

      clearTimeout(timeout);
    } catch (e) {
      // 降级：发送失败时输出到 console
      console.error('[Logger] 日志发送失败:', e.message, entry);
    }
  }

  return {
    /**
     * 记录 ERROR 级别日志
     * @param {string} message - 描述信息
     * @param {Error|string} [error] - 错误对象或消息
     * @param {object} [context] - 上下文参数（bvid, cid, quality 等）
     */
    error: function (message, error, context) {
      sendLog('ERROR', context, message, error);
    },

    /**
     * 记录 WARNING 级别日志
     * @param {string} message - 描述信息
     * @param {object} [context] - 上下文参数
     */
    warn: function (message, context) {
      sendLog('WARNING', context, message, null);
    },

    /**
     * 记录 INFO 级别日志
     * @param {string} message - 描述信息
     * @param {object} [context] - 上下文参数
     */
    info: function (message, context) {
      sendLog('INFO', context, message, null);
    },
  };
})();
