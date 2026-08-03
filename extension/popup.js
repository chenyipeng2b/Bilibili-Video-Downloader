/**
 * B站视频下载助手 - Popup 交互逻辑
 * 包含日/夜主题自动切换 + 手动锁定
 */

'use strict';

const API_BASE = 'http://127.0.0.1:8765';

// ==================== 主题管理 ====================

const THEME_KEY = 'bili_downloader_theme';     // 'light' | 'dark' | 'auto'
const THEME_LOCKED_KEY = 'bili_downloader_theme_locked'; // true | false

let themeLocked = false;   // 是否手动锁定主题
let currentTheme = 'light'; // 当前实际主题

/**
 * 检测系统是否为暗色模式
 */
function isSystemDark() {
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/**
 * 应用主题到 document
 */
function applyTheme(theme) {
  currentTheme = theme;
  if (theme === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
    document.getElementById('icon-sun').style.display = 'none';
    document.getElementById('icon-moon').style.display = '';
  } else {
    document.documentElement.removeAttribute('data-theme');
    document.getElementById('icon-sun').style.display = '';
    document.getElementById('icon-moon').style.display = 'none';
  }
  updateThemeToggleUI();
}

/**
 * 更新主题按钮外观
 */
function updateThemeToggleUI() {
  const btn = document.getElementById('theme-toggle');
  if (themeLocked) {
    btn.classList.add('locked');
    btn.title = currentTheme === 'dark' ? '夜间模式 (已锁定)' : '日间模式 (已锁定)';
  } else {
    btn.classList.remove('locked');
    btn.title = '自动切换日间/夜间模式';
  }
}

/**
 * 根据系统主题 + 锁定状态自动切换
 */
function autoSwitchTheme() {
  if (themeLocked) return; // 锁定状态下不自动切换
  const sysDark = isSystemDark();
  applyTheme(sysDark ? 'dark' : 'light');
}

/**
 * 手动切换主题（点击按钮）
 */
function manualToggleTheme() {
  // 如果当前是锁定状态，解锁并自动跟随系统
  if (themeLocked) {
    themeLocked = false;
    chrome.storage.local.set({ [THEME_LOCKED_KEY]: false });
    autoSwitchTheme();
    return;
  }

  // 未锁定：切换到另一个主题并锁定
  themeLocked = true;
  const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
  applyTheme(newTheme);
  chrome.storage.local.set({
    [THEME_KEY]: newTheme,
    [THEME_LOCKED_KEY]: true,
  });
}

/**
 * 初始化主题
 */
async function initTheme() {
  const data = await chrome.storage.local.get([THEME_KEY, THEME_LOCKED_KEY]);
  themeLocked = data[THEME_LOCKED_KEY] === true;

  if (themeLocked && data[THEME_KEY]) {
    // 锁定状态，用保存的主题
    applyTheme(data[THEME_KEY]);
  } else {
    // 自动模式，跟随系统
    themeLocked = false;
    autoSwitchTheme();
  }

  // 监听系统主题变化
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      autoSwitchTheme();
    });
  }
}

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
  videoDurationText: document.getElementById('video-duration-text'),
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
  // 底部 Tab
  bottomTabs: document.getElementById('bottom-tabs'),
  tabItems: document.querySelectorAll('.tab-item'),
  settingsPanel: document.getElementById('settings-panel'),
  mainContent: document.getElementById('main-content'),
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
  [els.notVideoPage, els.loading, els.errorBox, els.videoPanel, els.progressPanel, els.settingsPanel].forEach(hide);
  show(el);
}

// ==================== Tab 切换 ====================

/** 切换到指定 Tab */
function switchTab(tabName) {
  // 更新 Tab 按钮高亮
  els.tabItems.forEach(t => {
    if (t.dataset.tab === tabName) {
      t.classList.add('active');
    } else {
      t.classList.remove('active');
    }
  });

  // 切换面板
  if (tabName === 'video') {
    showOnly(els.videoPanel);
    els.bottomTabs.classList.remove('hidden');
  } else if (tabName === 'queue') {
    showOnly(els.progressPanel);
    els.bottomTabs.classList.remove('hidden');
    // 隐藏队列面板中的返回按钮（有Tab就不需要了）
    if (els.queueBackBtn) hide(els.queueBackBtn);
  } else if (tabName === 'settings') {
    showOnly(els.settingsPanel);
    els.bottomTabs.classList.remove('hidden');
  }
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
    // 服务未启动，仅输出到 console（避免未连接时日志发送也失败造成循环）
    console.warn('服务状态检查失败:', e.message);
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
    if (state.bvid) show(els.videoPanel);
    return;
  }

  // 从当前标签页获取视频信息
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
      showOnly(els.notVideoPage);
      return;
    }

    // 如果不是 B站视频页面，直接提示
    if (!tab.url || !tab.url.includes('bilibili.com/video/')) {
      showOnly(els.notVideoPage);
      return;
    }

    // === 多策略获取视频信息 ===
    let videoData = null;
    const currentUrl = tab.url;

    // 策略1：从 background 的内存缓存获取（最近一次 content script 上报的）
    try {
      const cached = await runtimeSendMessage({ action: 'getCachedInfo' });
      if (cached && cached.bvid && cached.url === currentUrl) {
        videoData = cached;
      }
    } catch (e) {
      // ignore
    }

    // 策略2：从 chrome.storage.local 获取
    if (!videoData) {
      try {
        const data = await chrome.storage.local.get('videoInfo');
        if (data.videoInfo && data.videoInfo.bvid && data.videoInfo.url === currentUrl) {
          videoData = data.videoInfo;
        }
      } catch (e) {
        // ignore
      }
    }

    // 策略3：直接询问 content script
    if (!videoData) {
      try {
        videoData = await tabsSendMessage(tab.id, { action: 'getVideoInfo' });
      } catch (e) {
        videoData = null;
      }
    }

    // 策略4：主动注入 content script 后重试
    if (!videoData) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content.js'],
        });
        // 等待 content script 初始化完成
        await new Promise(r => setTimeout(r, 800));
        videoData = await tabsSendMessage(tab.id, { action: 'getVideoInfo' });
      } catch (e2) {
        videoData = null;
      }
    }

    // 策略5：仍未获取到，从 URL 直接提取 BV 号
    if (!videoData || !videoData.bvid) {
      const bvidMatch = currentUrl.match(/bilibili\.com\/video\/(BV[a-zA-Z0-9]{10})/);
      if (bvidMatch) {
        videoData = {
          bvid: bvidMatch[1],
          title: document.title.replace('_哔哩哔哩_bilibili', '').trim() || '未知标题',
          cid: null,
          cookie: '',
          url: currentUrl,
          isVideoPage: true,
        };
      }
    }

    if (!videoData || !videoData.bvid) {
      showOnly(els.notVideoPage);
      return;
    }

    state.bvid = videoData.bvid;
    state.title = videoData.title || '未知视频';
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
    els.videoOwner.textContent = details.owner || '-';
    els.videoDuration.textContent = formatDuration(details.duration);
    if (els.videoDurationText) {
      els.videoDurationText.textContent = formatDuration(details.duration);
    }

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
    Log.error('加载视频信息失败', err, { bvid: state.bvid });
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
    els.downloadBtn.textContent = '无可用画质';
    return;
  }

  let firstAvailable = null;

  state.allQualities.forEach((q) => {
    const opt = document.createElement('option');
    opt.value = q.id;
    const vipLabel = vipIds.includes(q.id) ? ' [大会员]' : '';

    if (q.available) {
      opt.textContent = `${q.name}${vipLabel}`;
      if (!firstAvailable) firstAvailable = q.id;
    } else {
      opt.textContent = `[未解锁] ${q.name}${vipLabel}`;
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
    els.downloadBtn.textContent = '无可用画质';
  }

  // 检测登录态
  checkLoginStatus();
}

/** 检测是否已登录，更新状态提示 */
function checkLoginStatus() {
  const hasLogin = /SESSDATA/.test(state.cookie || '');
  const baseText = '下载服务已连接';
  if (!hasLogin) {
    els.serverStatusText.textContent = baseText + ' | 未检测到登录态，高画质可能不可用';
    els.serverStatusText.style.color = '#f59e0b';
  } else {
    els.serverStatusText.textContent = baseText;
    els.serverStatusText.style.color = '';
  }
}

/** 根据当前选中画质/格式更新下载按钮文字 */
function updateDownloadBtnText() {
  const ICON_DOWNLOAD = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px;margin-right:4px"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;
  if (state.downloadMode === 'audio') {
    const fmtLabel = state.audioFormat === 'hires' ? 'Hi-Res' : state.audioFormat.toUpperCase();
    els.downloadBtn.innerHTML = `${ICON_DOWNLOAD} 下载 ${fmtLabel} 音频`;
    return;
  }
  const selId = state.selectedQuality;
  const selItem = state.allQualities.find(q => q.id === selId);
  if (selItem) {
    els.downloadBtn.innerHTML = `${ICON_DOWNLOAD} 下载 ${selItem.name}`;
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
    Log.error('刷新画质失败', err, { bvid: state.bvid, cid });
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

  switchTab('queue');
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
    Log.error('启动下载任务失败', err, { bvid: state.bvid, cid: state.cid, quality, mode: state.downloadMode });
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

  // SVG 图标定义
  const ICON_DOWNLOADING = `<svg class="spinner-sm" viewBox="0 0 24 24" fill="none" stroke="#FB7299" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>`;
  const ICON_COMPLETED   = `<svg viewBox="0 0 24 24" fill="none" stroke="#52C41A" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="9 12 11 14 15 10"/></svg>`;
  const ICON_FAILED      = `<svg viewBox="0 0 24 24" fill="none" stroke="#FF4D4F" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`;
  const ICON_FOLDER      = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`;

  state.activeTasks.forEach((t, idx) => {
    const div = document.createElement('div');
    div.className = 'queue-item ' + t.status;

    let icon = ICON_DOWNLOADING;
    if (t.status === 'completed') icon = ICON_COMPLETED;
    else if (t.status === 'failed') icon = ICON_FAILED;

    const pct = Math.round((t.progress || 0) * 100);

    div.innerHTML = `
      <span class="q-icon">${icon}</span>
      <div class="q-info">
        <div class="q-title">${t.title}</div>
        <div class="q-progress-bar"><div class="q-progress-fill" style="width:${pct}%"></div></div>
        <div class="q-msg">${t.message}</div>
      </div>
      <span class="q-pct">${pct}%</span>
      ${t.status === 'completed' ? `<button class="q-folder-btn" data-idx="${idx}" title="打开文件夹">${ICON_FOLDER}</button>` : ''}
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
  switchTab('video');
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
    Log.error('选择文件夹失败', e);
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

// 队列返回按钮（仅在没有 Tab 栏时使用）
if (els.queueBackBtn) {
  els.queueBackBtn.addEventListener('click', () => {
    switchTab('video');
  });
}

// ==================== 初始化 ====================

document.addEventListener('DOMContentLoaded', async () => {
  // 初始化主题
  await initTheme();

  // 主题切换按钮事件
  document.getElementById('theme-toggle').addEventListener('click', () => {
    manualToggleTheme();
  });

  // 底部 Tab 切换事件
  els.tabItems.forEach(tab => {
    tab.addEventListener('click', () => {
      switchTab(tab.dataset.tab);
    });
  });

  // 功能区网格按钮事件
  const funcQuality = document.getElementById('func-quality');
  const funcMode = document.getElementById('func-mode');
  const funcDanmaku = document.getElementById('func-danmaku');
  const funcPath = document.getElementById('func-path');
  if (funcQuality) funcQuality.addEventListener('click', () => els.qualitySelect.focus());
  if (funcMode) funcMode.addEventListener('click', () => document.getElementById('mode-section').scrollIntoView({ behavior: 'smooth' }));
  if (funcDanmaku) funcDanmaku.addEventListener('click', () => document.getElementById('danmaku-section').scrollIntoView({ behavior: 'smooth' }));
  if (funcPath) funcPath.addEventListener('click', () => els.downloadPathInput.focus());

  await loadSavedPath();
  await loadSavedMode();
  await loadSavedAudioFormat();
  await loadSavedDanmaku();
  loadVideoInfo();
});
