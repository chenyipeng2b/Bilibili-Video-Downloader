/**
 * B站视频下载助手 - Content Script
 * 注入到 B站视频页面，提取视频信息和 Cookie
 */

(function () {
  'use strict';

  const API_BASE = 'http://127.0.0.1:8765';

  // 从页面提取 BV 号
  function getBvid() {
    const url = window.location.href;
    const match = url.match(/bilibili\.com\/video\/(BV[a-zA-Z0-9]{10})/);
    if (match) return match[1];

    // 备用：从页面数据中提取
    if (window.__INITIAL_STATE__ && window.__INITIAL_STATE__.bvid) {
      return window.__INITIAL_STATE__.bvid;
    }

    return null;
  }

  // 从页面提取视频标题
  function getTitle() {
    // 方法1：从 meta 标签
    const metaTitle = document.querySelector('meta[property="og:title"]');
    if (metaTitle) return metaTitle.getAttribute('content');

    // 方法2：从 h1 标签
    const h1 = document.querySelector('h1.video-title, h1[data-title]');
    if (h1) return h1.textContent.trim();

    // 方法3：从 __INITIAL_STATE__
    if (window.__INITIAL_STATE__ && window.__INITIAL_STATE__.videoData) {
      return window.__INITIAL_STATE__.videoData.title;
    }

    return document.title.replace('_哔哩哔哩_bilibili', '').trim();
  }

  // 获取当前分P的 CID
  function getCid() {
    if (window.__INITIAL_STATE__ && window.__INITIAL_STATE__.videoData) {
      return window.__INITIAL_STATE__.videoData.cid;
    }
    return null;
  }

  // 从 background 获取完整 Cookie（包括 HttpOnly 的 SESSDATA）
  async function getAllCookies() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'getCookies' }, (response) => {
        if (chrome.runtime.lastError || !response || !response.success) {
          // 降级：使用 document.cookie（拿不到 HttpOnly）
          if (chrome.runtime.lastError) {
            console.debug('getCookies 失败，降级使用 document.cookie:', chrome.runtime.lastError.message);
            if (typeof Log !== 'undefined') {
              void Log.warn('获取完整 Cookie 失败，已降级使用 document.cookie', {
                error: chrome.runtime.lastError.message,
              });
            }
          }
          resolve(document.cookie || '');
        } else {
          resolve(response.cookie || document.cookie || '');
        }
      });
    });
  }

  // 检测是否是视频页面
  function isVideoPage() {
    return /bilibili\.com\/video\//.test(window.location.href);
  }

  // 发送消息给 popup/background
  async function sendVideoInfo() {
    if (!isVideoPage()) return;

    const bvid = getBvid();
    const title = getTitle();
    const cid = getCid();
    const cookie = await getAllCookies();

    chrome.runtime.sendMessage({
      action: 'videoInfo',
      data: {
        bvid,
        title,
        cid,
        cookie,
        url: window.location.href,
        isVideoPage: true,
      },
    }, () => {
      if (chrome.runtime.lastError) {
        console.debug('sendMessage videoInfo:', chrome.runtime.lastError.message);
        if (typeof Log !== 'undefined') {
          void Log.warn('向 background 发送视频信息失败', {
            error: chrome.runtime.lastError.message,
            bvid,
            cid,
          });
        }
      }
    });
  }

  // 监听来自 popup/background 的消息
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'getVideoInfo') {
      // 异步获取完整 Cookie（包括 HttpOnly）
      (async () => {
        const bvid = getBvid();
        const title = getTitle();
        const cid = getCid();
        const cookie = await getAllCookies();

        sendResponse({
          success: true,
          bvid,
          title,
          cid,
          cookie,
          url: window.location.href,
          isVideoPage: isVideoPage(),
        });
      })();
      return true; // 保持消息通道开放（异步）
    }
  });

  // 页面加载完成后发送视频信息
  function initSendVideoInfo() {
    if (document.readyState === 'complete') {
      setTimeout(sendVideoInfo, 1000);
    } else {
      window.addEventListener('load', () => {
        setTimeout(sendVideoInfo, 1000);
      });
    }
  }

  initSendVideoInfo();

  // 监听 B站 SPA 页面内导航（用户点击推荐视频/切换视频等）
  // B站使用 history.pushState，我们通过监听 URL 变化来重新发送信息
  let lastUrl = window.location.href;
  const urlCheckInterval = setInterval(() => {
    const currentUrl = window.location.href;
    if (currentUrl !== lastUrl) {
      lastUrl = currentUrl;
      // 延迟等待页面渲染
      setTimeout(() => {
        if (isVideoPage()) {
          sendVideoInfo();
        }
      }, 2000);
    }
  }, 1500);

  // 同时也监听 popstate 事件
  window.addEventListener('popstate', () => {
    setTimeout(() => {
      if (isVideoPage()) {
        sendVideoInfo();
      }
    }, 2000);
  });
})();
