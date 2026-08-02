/**
 * B站视频下载助手 - Popup 交互逻辑
 */

'use strict';

const API_BASE = 'http://127.0.0.1:8765';

// DOM 元素
const els = {
  notVideoPage: document.getElementById('not-video-page'),
  loading: document.getElementById('loading'),
  errorBox: document.getElementById('error-box'),
  errorText: document.getElementById('error-text'),
  retryBtn: document.getElementById('retry-btn'),
  videoPanel: document.getElementById('video-panel'),
  videoCover: document.getElementById('video-cover'),
  videoTitle: document.getElementById('video-title'),
  videoOwner: document.getElementById('video-owner'),
  videoDuration: document.getElementById('video-duration'),
  pageSelect: document.getElementById('page-select'),
  qualitySelect: document.getElementById('quality-select'),
  serverStatus: document.getElementById('server-status'),
  serverStatusText: document.getElementById('server-status-text'),
  statusDot: document.querySelector('.status-dot'),
  downloadBtn: document.getElementById('download-btn'),
  progressPanel: document.getElementById('progress-panel'),
  progressBar: document.getElementById('progress-bar'),
  progressText: document.getElementById('progress-text'),
  progressPercent: document.getElementById('progress-percent'),
  saveBtn: document.getElementById('save-btn'),
  cancelBtn: document.getElementById('cancel-btn'),
  downloadPathInput: document.getElementById('download-path-input'),
  resetPathBtn: document.getElementById('reset-path-btn'),
  selectPathBtn: document.getElementById('select-path-btn'),
  openFolderBtn: document.getElementById('open-folder-btn'),
  savePathCheckbox: document.getElementById('save-path-checkbox'),
  modeVideoLabel: document.getElementById('mode-video-label'),
  modeAudioLabel: document.getElementById('mode-audio-label'),
  modeVideoRadio: document.querySelector('input[name="download-mode"][value="video"]'),
  modeAudioRadio: document.querySelector('input[name="download-mode"][value="audio"]'),
  // 音频格式
  audioFormatSection: document.getElementById('audio-format-section'),
  fmtMp3Label: document.getElementById('fmt-mp3-label'),
  fmtFlacLabel: document.getElementById('fmt-flac-label'),
  fmtHiresLabel: document.getElementById('fmt-hires-label'),
  fmtMp3Radio: document.querySelector('input[name="audio-format"][value="mp3"]'),
  fmtFlacRadio: document.querySelector('input[name="audio-format"][value="flac"]'),
  fmtHiresRadio: document.querySelector('input[name="audio-format"][value="hires"]'),
  formatHint: document.getElementById('format-hint'),
  // 弹幕
  downloadDanmakuCheckbox: document.getElementById('download-danmaku-checkbox'),
  danmakuModeSelector: document.getElementById('danmaku-mode-selector'),
  dmModeSoftLabel: document.getElementById('dm-mode-soft-label'),
  dmModeBurnLabel: document.getElementById('dm-mode-burn-label'),
  dmModeSoftRadio: document.querySelector('input[name="danmaku-mode"][value="soft"]'),
  dmModeBurnRadio: document.querySelector('input[name="danmaku-mode"][value="burn"]'),
  danmakuModeHint: document.getElementById('danmaku-mode-hint'),
  // 下载队列
  queueList: document.getElementById('queue-list'),
  queueBackBtn: document.getElementById('queue-back-btn'),
};

// 默认下载路径
const DEFAULT_DOWNLOAD_PATH = 'G:\\bilibili-downloader\\downloads\\';

// 状态
let state = {
  bvid: null,
  cid: null,
  title: '',
  cookie: '',
  coverUrl: '',            // B站原始封面URL
  pages: [],
  qualities: [],
  allQualities: [],        // 全部 12 种画质描述（含可用/不可用标记）
  availableIds: [],        // 当前可用的画质 ID 列表
  selectedQuality: null,
  activeTasks: [],         // 下载队列 [{taskId, title, intervalId, status, progress, message, filePath}]
  downloadPath: DEFAULT_DOWNLOAD_PATH,
  downloadMode: 'video',
  audioFormat: 'mp3',      // 'mp3' / 'flac' / 'hires'
  downloadDanmaku: false,   // 是否下载弹幕
  danmakuMode: 'soft',      // 'soft' = MKV软封装, 'burn' = 硬烧录
  savePathDefault: false,
};

// ==================== 显示/隐藏面板 ====================

function show(el) { el.classList.remove('hidden'); }
function hide(el) { el.classList.add('hidden'); }

function showOnly(el) {
  [els.notVideoPage, els.loading, els.errorBox, els.videoPanel, els.progressPanel].forEach(hide);
  show(el);
}

// ==================== 工具函数 ====================

function formatDuration(seconds) {
  if (!seconds) return '-';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** 安全发送消息到 background，自动检查 chrome.runtime.lastError */
function runtimeSendMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}

/** 安全发送消息到 content script，自动检查 chrome.runtime.lastError */
function tabsSendMessage(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}

// ==================== 服务状态检查 ====================

async function checkServerStatus() {
  try {
    const resp = await fetch(`${API_BASE}/`);
    if (resp.ok) {
      els.statusDot.classList.add('connected');
      els.statusDot.classList.remove('disconnected');
      els.serverStatusText.textContent = '下载服务已连接';
      return true;
    }
  } catch (e) {
    // 服务未启动
  }
  els.statusDot.classList.add('disconnected');
  els.statusDot.classList.remove('connected');
  els.serverStatusText.textContent = '下载服务未启动 (端口 8765)';
  return false;
}

// ==================== 获取视频信息 ====================

async function loadVideoInfo() {
  showOnly(els.loading);
  els.downloadBtn.textContent = '获取视频信息';
  els.downloadBtn.disabled = true;

  // 先检查服务
  const serverOk = await checkServerStatus();
  if (!serverOk) {
    showOnly(els.errorBox);
    els.errorText.textContent = '下载服务未启动，请在终端运行: python server.py';
    els.downloadBtn.textContent = '未连接服务';
    els.downloadBtn.disabled = true;
    if (state.bvid) show(els.videoPanel); // 也显示面板让用户能看到状态
    return;
  }

  // 从当前标签页获取视频信息
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
      showOnly(els.notVideoPage);
      return;
    }

    // 向 content script 请求视频信息
    let videoData;
    try {
      videoData = await tabsSendMessage(tab.id, { action: 'getVideoInfo' });
    } catch (e) {
      videoData = null;
    }

    if (!videoData || !videoData.isVideoPage || !videoData.bvid) {
      showOnly(els.notVideoPage);
      return;
    }

    state.bvid = videoData.bvid;
    state.title = videoData.title || '未获取到标题';
    state.cookie = videoData.cookie || '';

    // 调用后端获取详细信息
    const details = await runtimeSendMessage({
      action: 'fetchVideoDetails',
      url: videoData.url,
      cookie: state.cookie,
    });

    if (!details || !details.success) {
      showOnly(els.errorBox);
      els.errorText.textContent = (details && details.error) || '获取视频信息失败';
      show(els.videoPanel);
      els.downloadBtn.disabled = true;
      return;
    }

    // 填充 UI
    state.pages = details.pages || [];
    state.qualities = details.available_qualities || [];
    state.allQualities = details.all_qualities || [];
    state.availableIds = details.available_ids || [];

    // 封面
    if (details.cover) {
      els.videoCover.src = details.cover;
      state.coverUrl = details.cover;
    } else {
      els.videoCover.style.display = 'none';
      state.coverUrl = '';
    }

    els.videoTitle.textContent = details.title || state.title;
    els.videoOwner.textContent = `UP主: ${details.owner || '-'}`;
    els.videoDuration.textContent = `时长: ${formatDuration(details.duration)}`;

    // 分P选择
    els.pageSelect.innerHTML = '';
    if (state.pages.length <= 1) {
      // 单P，隐藏分P选择
      els.pageSelect.parentElement.style.display = 'none';
      if (state.pages.length === 1) {
        state.cid = state.pages[0].cid;
      }
    } else {
      els.pageSelect.parentElement.style.display = 'block';
      state.pages.forEach((p, i) => {
        const opt = document.createElement('option');
        opt.value = p.cid;
        opt.textContent = `P${i + 1}: ${p.part}`;
        els.pageSelect.appendChild(opt);
      });
      state.cid = state.pages[0].cid;
    }

    // 渲染全画质下拉框
    renderQualityDropdown();

    show(els.videoPanel);

  } catch (err) {
    console.error('加载视频信息失败:', err);
    showOnly(els.errorBox);
    els.errorText.textContent = err.message || '无法连接到当前页面';
  }
}

// ==================== 画质下拉框渲染 ====================

/** 基于全部 12 种画质渲染下拉框，不可用的灰显禁用 */
function renderQualityDropdown() {
  els.qualitySelect.innerHTML = '';

  // 大会员画质 ID
  const vipIds = [112, 116, 120, 125, 126, 127];
  const availableIdSet = new Set(state.availableIds);

  if (!state.allQualities || state.allQualities.length === 0) {
    const opt = document.createElement('option');
    opt.value = '0';
    opt.textContent = '无可用画质';
    els.qualitySelect.appendChild(opt);
    els.downloadBtn.disabled = true;
    els.downloadBtn.textContent = '⬇️ 无可用画质';
    return;
  }

  let firstAvailable = null;

  state.allQualities.forEach((q) => {
    const opt = document.createElement('option');
    opt.value = q.id;
    const vipLabel = vipIds.includes(q.id) ? ' 👑大会员' : '';

    if (q.available) {
      opt.textContent = `${q.name}${vipLabel}`;
      if (!firstAvailable) firstAvailable = q.id;
    } else {
      opt.textContent = `🔒 ${q.name}${vipLabel}`;
      opt.disabled = true;
      opt.style.color = '#888';
    }
    els.qualitySelect.appendChild(opt);
  });

  if (firstAvailable) {
    state.selectedQuality = firstAvailable;
    els.qualitySelect.value = firstAvailable;
    els.downloadBtn.disabled = false;
    updateDownloadBtnText();
  } else {
    state.selectedQuality = null;
    els.downloadBtn.disabled = true;
    els.downloadBtn.textContent = '⬇️ 无可用画质';
  }

  // 检测登录态
  checkLoginStatus();
}

/** 检测是否已登录，更新状态提示 */
function checkLoginStatus() {
  const hasLogin = /SESSDATA/.test(state.cookie || '');
  const baseText = '下载服务已连接';
  if (!hasLogin) {
    els.serverStatusText.textContent = baseText + ' | ⚠️ 未检测到登录态，高画质可能不可用';
    els.serverStatusText.style.color = '#f59e0b';
  } else {
    els.serverStatusText.textContent = baseText;
    els.serverStatusText.style.color = '';
  }
}

/** 根据当前选中画质/格式更新下载按钮文字 */
function updateDownloadBtnText() {
  if (state.downloadMode === 'audio') {
    const fmtLabel = state.audioFormat === 'hires' ? 'Hi-Res' : state.audioFormat.toUpperCase();
    els.downloadBtn.textContent = `⬇️ 下载 ${fmtLabel} 音频`;
    return;
  }
  const selId = state.selectedQuality;
  const selItem = state.allQualities.find(q => q.id === selId);
  if (selItem) {
    els.downloadBtn.textContent = `⬇️ 下载 ${selItem.name}`;
  }
}

/** 切换分P时刷新该P的可用画质 */
async function refreshQualityForPage(cid) {
  // 保持当前选中值，避免异步期间下拉框被清空
  const prevQuality = state.selectedQuality;

  try {
    const details = await runtimeSendMessage({
      action: 'fetchQualityForPage',
      url: `https://www.bilibili.com/video/${state.bvid}`,
      cookie: state.cookie,
      cid: cid,
    });

    if (details && details.success) {
      state.qualities = details.available_qualities || [];
      state.allQualities = details.all_qualities || [];
      state.availableIds = details.available_ids || [];

      // 重新渲染画质下拉框
      renderQualityDropdown();

      // 尝试恢复之前选中的画质（如果新分P也有同画质）
      if (prevQuality && state.availableIds.includes(prevQuality)) {
        els.qualitySelect.value = prevQuality;
        state.selectedQuality = prevQuality;
        updateDownloadBtnText();
      }
    }
  } catch (err) {
    console.error('刷新画质失败:', err);
  }
}

// ==================== 下载流程 ====================

async function startDownload() {
  const quality = parseInt(els.qualitySelect.value) || state.selectedQuality;
  if (!quality || quality === 0) return;
  const cid = parseInt(els.pageSelect.value) || state.cid;

  // 创建任务对象
  const taskObj = { taskId: null, title: state.title, intervalId: null, status: 'preparing', progress: 0, message: '正在提交...', filePath: '' };
  state.activeTasks.push(taskObj);

  show(els.progressPanel);
  renderQueueList();

  try {
    const result = await runtimeSendMessage({
      action: 'startDownload',
      bvid: state.bvid,
      cid: cid || state.cid,
      title: state.title,
      quality: quality,
      cookie: state.cookie,
      downloadPath: state.downloadPath,
      downloadMode: state.downloadMode,
      audioFormat: state.audioFormat,
      downloadDanmaku: state.downloadDanmaku,
      danmakuMode: state.danmakuMode,
      coverUrl: state.coverUrl,
    });

    if (!result || !result.success) {
      throw new Error((result && result.error) || '启动失败');
    }

    taskObj.taskId = result.task_id;
    taskObj.status = 'downloading';
    taskObj.message = '下载中...';
    taskObj.intervalId = setInterval(() => pollTaskProgress(taskObj), 1000);
    renderQueueList();

  } catch (err) {
    taskObj.status = 'failed';
    taskObj.message = err.message;
    renderQueueList();
  }
}

function pollTaskProgress(taskObj) {
  if (!taskObj.taskId) return;

  runtimeSendMessage({ action: 'checkProgress', taskId: taskObj.taskId }).then(task => {
    if (!task) return;
    taskObj.progress = task.progress || 0;
    taskObj.message = task.message || '';
    taskObj.status = task.status;

    if (task.status === 'completed') {
      clearInterval(taskObj.intervalId);
      taskObj.filePath = task.file_path || '';
    }
    if (task.status === 'failed') {
      clearInterval(taskObj.intervalId);
    }
    renderQueueList();
  });
}

function renderQueueList() {
  els.queueList.innerHTML = '';

  state.activeTasks.forEach((t, idx) => {
    const div = document.createElement('div');
    div.className = 'queue-item ' + t.status;

    const icon = t.status === 'completed' ? '✅' : t.status === 'failed' ? '❌' : '⏳';
    const pct = Math.round((t.progress || 0) * 100);

    div.innerHTML = `
      <span class="q-icon">${icon}</span>
      <div class="q-info">
        <div class="q-title">${t.title}</div>
        <div class="q-progress-bar"><div class="q-progress-fill" style="width:${pct}%"></div></div>
        <div class="q-msg">${t.message}</div>
      </div>
      <span class="q-pct">${pct}%</span>
      ${t.status === 'completed' ? `<button class="q-folder-btn" data-idx="${idx}" title="打开文件夹">📂</button>` : ''}
    `;

    div.querySelector('.q-folder-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      runtimeSendMessage({ action: 'openFolder', taskId: t.taskId });
    });

    els.queueList.appendChild(div);
  });

  // 清理已完成/失败任务的 interval（防止泄漏）
  state.activeTasks.forEach(t => {
    if ((t.status === 'completed' || t.status === 'failed') && t.intervalId) {
      clearInterval(t.intervalId);
      t.intervalId = null;
    }
  });
}

async function cancelAllTasks() {
  state.activeTasks.forEach(t => {
    if (t.intervalId) clearInterval(t.intervalId);
  });
  state.activeTasks = [];
  renderQueueList();
  show(els.videoPanel);
  hide(els.progressPanel);
}
  }
}

function resetToPanel() {
  cancelAllTasks();
}

// ==================== 路径管理 ====================

async function loadSavedPath() {
  try {
    const data = await chrome.storage.local.get(['downloadPath', 'savePathDefault']);
    if (data.savePathDefault && data.downloadPath) {
      state.savePathDefault = true;
      state.downloadPath = data.downloadPath;
      els.downloadPathInput.value = data.downloadPath;
      els.savePathCheckbox.checked = true;
    } else {
      els.downloadPathInput.placeholder = DEFAULT_DOWNLOAD_PATH;
      els.savePathCheckbox.checked = false;
    }
    // 如果之前存了路径但没勾选默认，也恢复路径到输入框（但不标记为默认）
    if (data.downloadPath && !data.savePathDefault) {
      els.downloadPathInput.value = data.downloadPath;
      state.downloadPath = data.downloadPath;
    }
  } catch (e) {
    els.downloadPathInput.placeholder = DEFAULT_DOWNLOAD_PATH;
  }
}

async function savePath(value) {
  state.downloadPath = value;
  // 仅当勾选"保存为默认"时才持久化
  if (state.savePathDefault) {
    await chrome.storage.local.set({ downloadPath: value });
  }
}

// ==================== 模式管理 ====================

async function loadSavedMode() {
  try {
    const data = await chrome.storage.local.get('downloadMode');
    if (data.downloadMode) {
      setMode(data.downloadMode);
    }
  } catch (e) {
    // 使用默认 video 模式
  }
}

function setMode(mode) {
  state.downloadMode = mode;
  els.modeVideoRadio.checked = (mode === 'video');
  els.modeAudioRadio.checked = (mode === 'audio');

  els.modeVideoLabel.classList.toggle('active', mode === 'video');
  els.modeAudioLabel.classList.toggle('active', mode === 'audio');

  // 仅音频模式显示格式选择器
  if (mode === 'audio') {
    show(els.audioFormatSection);
    updateFormatHint();
  } else {
    hide(els.audioFormatSection);
  }
  updateDownloadBtnText();
}

async function saveMode(mode) {
  setMode(mode);
  await chrome.storage.local.set({ downloadMode: mode });
}

// ==================== 音频格式管理 ====================

const AUDIO_FORMAT_DESC = {
  mp3: 'MP3 320kbps — 通用兼容，体积小',
  flac: 'FLAC 无损 — 保留原始 48kHz，体积较大',
  hires: 'Hi-Res FLAC — 32bit 位深，仅封装升级',
};

function setAudioFormat(format) {
  state.audioFormat = format;
  els.fmtMp3Radio.checked = (format === 'mp3');
  els.fmtFlacRadio.checked = (format === 'flac');
  els.fmtHiresRadio.checked = (format === 'hires');

  els.fmtMp3Label.classList.toggle('active', format === 'mp3');
  els.fmtFlacLabel.classList.toggle('active', format === 'flac');
  els.fmtHiresLabel.classList.toggle('active', format === 'hires');

  updateFormatHint();
  updateDownloadBtnText();
}

function updateFormatHint() {
  els.formatHint.textContent = AUDIO_FORMAT_DESC[state.audioFormat] || '';
}

async function saveAudioFormat(format) {
  setAudioFormat(format);
  await chrome.storage.local.set({ audioFormat: format });
}

async function loadSavedAudioFormat() {
  try {
    const data = await chrome.storage.local.get('audioFormat');
    if (data.audioFormat) {
      setAudioFormat(data.audioFormat);
    }
  } catch (e) {
    // 使用默认 mp3
  }
}

// ==================== 弹幕管理 ====================

async function loadSavedDanmaku() {
  try {
    const data = await chrome.storage.local.get(['downloadDanmaku', 'danmakuMode']);
    if (data.downloadDanmaku !== undefined) {
      state.downloadDanmaku = data.downloadDanmaku;
      els.downloadDanmakuCheckbox.checked = data.downloadDanmaku;
      toggleDanmakuMode(data.downloadDanmaku);
    }
    if (data.danmakuMode) {
      setDanmakuMode(data.danmakuMode);
    }
  } catch (e) {
    // 使用默认值
  }
}

async function saveDanmaku(checked) {
  state.downloadDanmaku = checked;
  await chrome.storage.local.set({ downloadDanmaku: checked });
  toggleDanmakuMode(checked);
}

function toggleDanmakuMode(visible) {
  if (visible) {
    show(els.danmakuModeSelector);
    updateDanmakuModeHint();
  } else {
    hide(els.danmakuModeSelector);
  }
}

function setDanmakuMode(mode) {
  state.danmakuMode = mode;
  els.dmModeSoftRadio.checked = (mode === 'soft');
  els.dmModeBurnRadio.checked = (mode === 'burn');
  els.dmModeSoftLabel.classList.toggle('active', mode === 'soft');
  els.dmModeBurnLabel.classList.toggle('active', mode === 'burn');
  updateDanmakuModeHint();
}

function updateDanmakuModeHint() {
  const hints = {
    soft: '快速，不重编码，需 PotPlayer/VLC 等支持字幕的播放器',
    burn: '较慢需重编码，弹幕直接刻入画面，任何播放器都能显示',
  };
  els.danmakuModeHint.textContent = hints[state.danmakuMode] || '';
}

async function saveDanmakuMode(mode) {
  setDanmakuMode(mode);
  await chrome.storage.local.set({ danmakuMode: mode });
}

// ==================== 事件绑定 ====================

els.downloadBtn.addEventListener('click', () => {
  const quality = parseInt(els.qualitySelect.value);
  if (quality && quality > 0) {
    startDownload();
  } else {
    loadVideoInfo();
  }
});

els.qualitySelect.addEventListener('change', () => {
  state.selectedQuality = parseInt(els.qualitySelect.value);
  updateDownloadBtnText();
});

els.pageSelect.addEventListener('change', () => {
  const newCid = parseInt(els.pageSelect.value);
  state.cid = newCid;
  // 多 P 联动：切换分 P 后刷新该 P 的可用画质
  if (newCid) {
    refreshQualityForPage(newCid);
  }
});

els.retryBtn.addEventListener('click', loadVideoInfo);

// 下载路径输入
els.downloadPathInput.addEventListener('change', () => {
  const val = els.downloadPathInput.value.trim();
  if (val) savePath(val);
});
els.downloadPathInput.addEventListener('input', () => {
  const val = els.downloadPathInput.value.trim();
  state.downloadPath = val || DEFAULT_DOWNLOAD_PATH;
});

// 选择文件夹
els.selectPathBtn.addEventListener('click', async () => {
  try {
    const resp = await fetch(`${API_BASE}/api/select-folder`);
    const data = await resp.json();
    if (data.success && data.path) {
      els.downloadPathInput.value = data.path;
      state.downloadPath = data.path;
      // 勾选保存为默认
      els.savePathCheckbox.checked = true;
      state.savePathDefault = true;
      await chrome.storage.local.set({
        downloadPath: data.path,
        savePathDefault: true,
      });
    }
  } catch (e) {
    console.error('选择文件夹失败:', e);
  }
});

// 重置路径为默认
els.resetPathBtn.addEventListener('click', () => {
  els.downloadPathInput.value = '';
  els.downloadPathInput.placeholder = DEFAULT_DOWNLOAD_PATH;
  state.downloadPath = DEFAULT_DOWNLOAD_PATH;
  state.savePathDefault = false;
  els.savePathCheckbox.checked = false;
  chrome.storage.local.remove(['downloadPath', 'savePathDefault']);
});

// 保存为默认路径复选框
els.savePathCheckbox.addEventListener('change', () => {
  state.savePathDefault = els.savePathCheckbox.checked;
  chrome.storage.local.set({ savePathDefault: state.savePathDefault });
  // 勾选时立即保存当前路径
  if (state.savePathDefault && state.downloadPath && state.downloadPath !== DEFAULT_DOWNLOAD_PATH) {
    chrome.storage.local.set({ downloadPath: state.downloadPath });
  }
});

// 下载模式切换
els.modeVideoLabel.addEventListener('click', () => saveMode('video'));
els.modeAudioLabel.addEventListener('click', () => saveMode('audio'));

// 音频格式切换
els.fmtMp3Label.addEventListener('click', () => saveAudioFormat('mp3'));
els.fmtFlacLabel.addEventListener('click', () => saveAudioFormat('flac'));
els.fmtHiresLabel.addEventListener('click', () => saveAudioFormat('hires'));

// 弹幕复选框
els.downloadDanmakuCheckbox.addEventListener('change', () => {
  saveDanmaku(els.downloadDanmakuCheckbox.checked);
});

// 弹幕模式切换
els.dmModeSoftLabel.addEventListener('click', () => saveDanmakuMode('soft'));
els.dmModeBurnLabel.addEventListener('click', () => saveDanmakuMode('burn'));

// 队列返回按钮
els.queueBackBtn.addEventListener('click', () => {
  show(els.videoPanel);
  hide(els.progressPanel);
});

// ==================== 初始化 ====================

document.addEventListener('DOMContentLoaded', async () => {
  await loadSavedPath();
  await loadSavedMode();
  await loadSavedAudioFormat();
  await loadSavedDanmaku();
  loadVideoInfo();
});
