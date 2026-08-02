/**
 * B站视频下载助手 - Background Service Worker
 * 管理视频信息缓存、与本地后端通信
 */

'use strict';

const API_BASE = 'http://127.0.0.1:8765';

// 缓存当前页面的视频信息
let cachedVideoInfo = null;
let cachedQualities = null;

// 监听来自 content script 的消息
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'videoInfo') {
    cachedVideoInfo = msg.data;
    // 同步存储给 popup
    chrome.storage.local.set({ videoInfo: msg.data });
  }

  if (msg.action === 'getCachedInfo') {
    sendResponse(cachedVideoInfo);
  }
});

// 与后端通信：获取视频信息和画质列表（支持指定 cid 查询不同分P画质）
async function fetchVideoDetails(url, cookie, cid) {
  try {
    const body = { url, cookie };
    if (cid) body.cid = cid;
    const resp = await fetch(`${API_BASE}/api/video-info`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const err = await resp.json();
      throw new Error(err.detail || '获取视频信息失败');
    }

    const data = await resp.json();
    cachedQualities = data;
    return data;
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// 开始下载
async function startDownload(bvid, cid, title, quality, cookie, downloadPath, downloadMode, audioFormat, downloadDanmaku, danmakuMode) {
  try {
    const resp = await fetch(`${API_BASE}/api/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bvid, cid, title, quality, cookie, download_path: downloadPath || '', download_mode: downloadMode || 'video', audio_format: audioFormat || 'mp3', download_danmaku: downloadDanmaku || false, danmaku_mode: danmakuMode || 'soft' }),
    });

    if (!resp.ok) {
      const err = await resp.json();
      throw new Error(err.detail || '启动下载失败');
    }

    const data = await resp.json();
    return { success: true, task_id: data.task_id };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// 查询任务进度
async function checkTaskProgress(taskId) {
  try {
    const resp = await fetch(`${API_BASE}/api/task/${taskId}`);
    if (!resp.ok) throw new Error('查询失败');
    return await resp.json();
  } catch (e) {
    return { status: 'error', message: e.message };
  }
}

// 获取下载链接
function getDownloadUrl(taskId) {
  return `${API_BASE}/api/download/${taskId}`;
}

// 暴露给 popup 的 API
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // 获取视频详情（支持指定 cid 查询不同分P画质）
  if (msg.action === 'fetchVideoDetails') {
    fetchVideoDetails(msg.url, msg.cookie, msg.cid).then(sendResponse);
    return true;
  }

  // 切换分P时刷新该P的可用画质（返回全部画质列表）
  if (msg.action === 'fetchQualityForPage') {
    fetchVideoDetails(msg.url, msg.cookie, msg.cid).then(sendResponse);
    return true;
  }

  // 开始下载
  if (msg.action === 'startDownload') {
    startDownload(msg.bvid, msg.cid, msg.title, msg.quality, msg.cookie, msg.downloadPath, msg.downloadMode, msg.audioFormat, msg.downloadDanmaku, msg.danmakuMode).then(sendResponse);
    return true;
  }

  // 打开文件夹
  if (msg.action === 'openFolder') {
    fetch(`${API_BASE}/api/open-folder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task_id: msg.taskId }),
    }).then(r => r.json()).then(sendResponse).catch(e => sendResponse({ success: false, error: e.message }));
    return true;
  }

  // 查询进度
  if (msg.action === 'checkProgress') {
    checkTaskProgress(msg.taskId).then(sendResponse);
    return true;
  }

  // 获取下载链接
  if (msg.action === 'getDownloadUrl') {
    sendResponse({ url: getDownloadUrl(msg.taskId) });
    return false;
  }

  // 使用 chrome.cookies API 获取 B站完整 Cookie（包括 HttpOnly 的 SESSDATA）
  if (msg.action === 'getCookies') {
    chrome.cookies.getAll({ domain: '.bilibili.com' }, (cookies) => {
      const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');
      sendResponse({ success: true, cookie: cookieStr });
    });
    return true; // 异步响应
  }
});
