/**
 * B站视频下载器 - Web 前端
 * 纯 Vanilla JS，无依赖，支持移动端
 */
(function() {
'use strict';

var $ = function(sel) { return document.querySelector(sel); };
var $$ = function(sel) { return document.querySelectorAll(sel); };

var els = {};
var state = {
    videoInfo: null,
    currentCid: null,
    downloadMode: 'video',
    activeTasks: []
};

function init() {
    els.urlInput = $('#url-input');
    els.fetchBtn = $('#fetch-btn');
    els.cookieToggle = $('#cookie-toggle');
    els.cookieContent = $('#cookie-content');
    els.cookieSection = $('#cookie-section');
    els.cookieInput = $('#cookie-input');
    els.inputCard = $('#input-card');
    els.videoCard = $('#video-card');
    els.coverImg = $('#cover-img');
    els.videoTitle = $('#video-title');
    els.videoOwner = $('#video-owner');
    els.videoDuration = $('#video-duration');
    els.pageGroup = $('#page-group');
    els.pageSelect = $('#page-select');
    els.qualitySelect = $('#quality-select');
    els.modeBtns = $$('.mode-btn');
    els.audioFormatGroup = $('#audio-format-group');
    els.audioFormatSelect = $('#audio-format-select');
    els.danmakuCheck = $('#danmaku-check');
    els.danmakuModeSelect = $('#danmaku-mode-select');
    els.pathInput = $('#path-input');
    els.downloadBtn = $('#download-btn');
    els.serviceStatus = $('#service-status');
    els.statusText = $('#status-text');
    els.statusDot = $('.status-dot');
    els.queueCard = $('#queue-card');
    els.queueList = $('#queue-list');
    els.queueCount = $('#queue-count');
    els.queueBackBtn = $('#queue-back-btn');
    els.toast = $('#toast');
    els.lanHint = $('#lan-hint');

    loadSettings();
    bindEvents();
    showLanHint();
}

function loadSettings() {
    var cookie = localStorage.getItem('bili_cookie') || '';
    var path = localStorage.getItem('bili_path') || '';
    var mode = localStorage.getItem('bili_mode') || 'video';
    var audioFormat = localStorage.getItem('bili_audio_format') || 'mp3';
    var danmaku = localStorage.getItem('bili_danmaku') === 'true';
    var danmakuMode = localStorage.getItem('bili_danmaku_mode') || 'soft';

    els.cookieInput.value = cookie;
    els.pathInput.value = path;
    els.audioFormatSelect.value = audioFormat;
    els.danmakuCheck.checked = danmaku;
    els.danmakuModeSelect.value = danmakuMode;
    state.downloadMode = mode;

    updateModeUI();
    updateDanmakuModeUI();

    if (cookie) {
        els.cookieSection.classList.add('open');
        els.cookieContent.classList.remove('hidden');
    }
}

function bindEvents() {
    els.fetchBtn.addEventListener('click', fetchVideoInfo);
    els.urlInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') fetchVideoInfo();
    });

    els.cookieToggle.addEventListener('click', function() {
        els.cookieSection.classList.toggle('open');
        els.cookieContent.classList.toggle('hidden');
    });

    els.modeBtns.forEach(function(btn) {
        btn.addEventListener('click', function() {
            state.downloadMode = btn.dataset.mode;
            updateModeUI();
            localStorage.setItem('bili_mode', state.downloadMode);
        });
    });

    els.audioFormatSelect.addEventListener('change', function() {
        localStorage.setItem('bili_audio_format', els.audioFormatSelect.value);
    });

    els.danmakuCheck.addEventListener('change', function() {
        updateDanmakuModeUI();
        localStorage.setItem('bili_danmaku', els.danmakuCheck.checked);
    });

    els.danmakuModeSelect.addEventListener('change', function() {
        localStorage.setItem('bili_danmaku_mode', els.danmakuModeSelect.value);
    });

    els.pageSelect.addEventListener('change', function() {
        var cid = parseInt(els.pageSelect.value);
        if (cid === state.currentCid) return;
        state.currentCid = cid;
        refetchQualities(cid);
    });

    els.downloadBtn.addEventListener('click', startDownload);

    els.queueBackBtn.addEventListener('click', function() {
        els.queueCard.classList.add('hidden');
        els.videoCard.classList.remove('hidden');
        els.inputCard.classList.remove('hidden');
    });

    els.pathInput.addEventListener('change', function() {
        localStorage.setItem('bili_path', els.pathInput.value);
    });
}

function updateModeUI() {
    els.modeBtns.forEach(function(btn) {
        btn.classList.toggle('active', btn.dataset.mode === state.downloadMode);
    });
    els.audioFormatGroup.classList.toggle('hidden', state.downloadMode !== 'audio');
    if (state.downloadMode === 'audio' && els.danmakuModeSelect.value === 'burn') {
        els.danmakuModeSelect.value = 'soft';
    }
}

function updateDanmakuModeUI() {
    els.danmakuModeSelect.classList.toggle('hidden', !els.danmakuCheck.checked);
}

function showToast(msg, type) {
    type = type || '';
    els.toast.textContent = msg;
    els.toast.className = 'toast ' + type;
    els.toast.classList.remove('hidden');
    clearTimeout(els.toast._timeout);
    els.toast._timeout = setTimeout(function() {
        els.toast.classList.add('hidden');
    }, 3000);
}

function setStatus(status, msg) {
    els.statusDot.className = 'status-dot ' + status;
    els.statusText.textContent = msg;
}

function fetchVideoInfo() {
    var url = els.urlInput.value.trim();
    if (!url) {
        showToast('请输入 B站视频链接或 BV 号', 'error');
        return;
    }

    setStatus('loading', '正在获取视频信息...');
    els.fetchBtn.disabled = true;
    els.fetchBtn.textContent = '获取中...';

    var cookie = els.cookieInput.value.trim();
    if (cookie) localStorage.setItem('bili_cookie', cookie);

    fetch('/api/video-info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url, cookie: cookie })
    })
    .then(function(resp) {
        if (!resp.ok) return resp.json().then(function(e) { throw new Error(e.detail || '获取视频信息失败'); });
        return resp.json();
    })
    .then(function(data) {
        if (!data.success) throw new Error('获取视频信息失败');
        state.videoInfo = data;
        state.currentCid = data.pages[0] ? data.pages[0].cid : 0;
        renderVideoInfo(data);
        setStatus('success', '视频信息获取成功');
        els.videoCard.classList.remove('hidden');
    })
    .catch(function(err) {
        setStatus('error', err.message);
        showToast(err.message, 'error');
    })
    .finally(function() {
        els.fetchBtn.disabled = false;
        els.fetchBtn.innerHTML = '<span class="btn-icon">🔍</span><span class="btn-label">获取信息</span>';
    });
}

function renderVideoInfo(data) {
    els.coverImg.src = data.cover;
    els.videoTitle.textContent = data.title;
    els.videoOwner.textContent = 'UP主: ' + data.owner;
    els.videoDuration.textContent = formatDuration(data.duration);

    if (data.pages.length > 1) {
        els.pageGroup.classList.remove('hidden');
        els.pageSelect.innerHTML = data.pages.map(function(p, i) {
            return '<option value="' + p.cid + '">P' + (i+1) + ': ' + p.part + ' (' + formatDuration(p.duration) + ')</option>';
        }).join('');
        els.pageSelect.value = data.pages[0].cid;
    } else {
        els.pageGroup.classList.add('hidden');
    }

    renderQualities(data.all_qualities, data.available_ids);
}

function renderQualities(allQualities, availableIds) {
    var availableSet = {};
    availableIds.forEach(function(id) { availableSet[id] = true; });

    els.qualitySelect.innerHTML = allQualities.map(function(q) {
        var label = q.name + (q.available ? '' : ' (不可用)');
        var disabled = q.available ? '' : ' disabled';
        return '<option value="' + q.id + '"' + disabled + '>' + label + '</option>';
    }).join('');

    for (var i = 0; i < allQualities.length; i++) {
        if (allQualities[i].available) {
            els.qualitySelect.value = allQualities[i].id;
            break;
        }
    }
}

function refetchQualities(cid) {
    setStatus('loading', '正在获取该分P的画质...');
    var url = els.urlInput.value.trim();
    var cookie = els.cookieInput.value.trim();

    fetch('/api/video-info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url, cookie: cookie, cid: cid })
    })
    .then(function(resp) {
        if (!resp.ok) throw new Error('获取画质失败');
        return resp.json();
    })
    .then(function(data) {
        renderQualities(data.all_qualities, data.available_ids);
        setStatus('success', '画质列表已更新');
    })
    .catch(function(err) {
        setStatus('error', err.message);
        showToast(err.message, 'error');
    });
}

function startDownload() {
    if (!state.videoInfo) {
        showToast('请先获取视频信息', 'error');
        return;
    }

    var reqBody = {
        bvid: state.videoInfo.bvid,
        cid: state.currentCid,
        title: state.videoInfo.title,
        quality: parseInt(els.qualitySelect.value),
        cookie: els.cookieInput.value.trim(),
        download_path: els.pathInput.value.trim(),
        download_mode: state.downloadMode,
        audio_format: els.audioFormatSelect.value,
        download_danmaku: els.danmakuCheck.checked,
        danmaku_mode: els.danmakuModeSelect.value,
        cover_url: state.videoInfo.cover || ''
    };

    setStatus('loading', '正在提交下载任务...');

    fetch('/api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reqBody)
    })
    .then(function(resp) {
        if (!resp.ok) return resp.json().then(function(e) { throw new Error(e.detail || '提交下载失败'); });
        return resp.json();
    })
    .then(function(data) {
        if (!data.success) throw new Error('提交下载失败');

        var taskObj = {
            taskId: data.task_id,
            title: state.videoInfo.title,
            intervalId: null,
            status: 'preparing',
            progress: 0,
            message: '准备中...',
            filePath: ''
        };

        state.activeTasks.push(taskObj);
        taskObj.intervalId = setInterval(function() { pollTaskProgress(taskObj); }, 1000);

        renderQueueList();
        els.queueCard.classList.remove('hidden');
        els.videoCard.classList.remove('hidden');
        setStatus('success', '任务已加入队列');
        showToast('下载任务已提交', 'success');

        localStorage.setItem('bili_cookie', reqBody.cookie);
        localStorage.setItem('bili_path', reqBody.download_path);
    })
    .catch(function(err) {
        setStatus('error', err.message);
        showToast(err.message, 'error');
    });
}

function pollTaskProgress(taskObj) {
    fetch('/api/task/' + taskObj.taskId)
    .then(function(resp) {
        if (!resp.ok) return;
        return resp.json();
    })
    .then(function(data) {
        if (!data) return;
        taskObj.status = data.status;
        taskObj.progress = data.progress || 0;
        taskObj.message = data.message || '';
        taskObj.filePath = data.file_path || '';
        updateQueueItemDOM(taskObj);

        if (data.status === 'completed' || data.status === 'failed') {
            clearInterval(taskObj.intervalId);
            taskObj.intervalId = null;
        }
    })
    .catch(function() {});
}

function renderQueueList() {
    els.queueList.innerHTML = '';

    if (state.activeTasks.length === 0) {
        els.queueList.innerHTML = '<div class="queue-empty">暂无下载任务</div>';
        els.queueCount.textContent = '0';
        return;
    }

    var activeCount = state.activeTasks.filter(function(t) {
        return t.status !== 'completed' && t.status !== 'failed';
    }).length;
    els.queueCount.textContent = activeCount;

    state.activeTasks.forEach(function(task) {
        els.queueList.appendChild(createQueueItemElement(task));
    });
}

function createQueueItemElement(task) {
    var div = document.createElement('div');
    div.className = 'queue-item';
    div.dataset.taskId = task.taskId;

    if (task.status === 'completed') div.classList.add('completed');
    if (task.status === 'failed') div.classList.add('failed');

    var icons = {
        preparing: '⏳', fetching: '🔍', downloading: '⬇️',
        downloading_audio: '🎵', merging: '🔧', processing: '⚙️',
        completed: '✅', failed: '❌'
    };

    var icon = icons[task.status] || '⏳';
    var pct = Math.round(task.progress * 100);

    div.innerHTML =
        '<div class="queue-status-icon">' + icon + '</div>' +
        '<div class="queue-info">' +
            '<div class="queue-title" title="' + escapeHtml(task.title) + '">' + escapeHtml(task.title) + '</div>' +
            '<div class="queue-progress-bar">' +
                '<div class="queue-progress-fill' +
                    (task.status === 'completed' ? ' completed' : '') +
                    (task.status === 'failed' ? ' failed' : '') +
                '" style="width:' + pct + '%"></div>' +
            '</div>' +
        '</div>' +
        '<div class="queue-percent">' + pct + '%</div>' +
        '<div class="queue-actions">' +
            (task.status === 'completed' ? '<button class="queue-action-btn download" onclick="window._downloadFile(\'' + task.taskId + '\')">下载</button>' : '') +
        '</div>';

    return div;
}

function updateQueueItemDOM(taskObj) {
    var existing = document.querySelector('.queue-item[data-task-id="' + taskObj.taskId + '"]');
    if (!existing) {
        renderQueueList();
        return;
    }

    var icons = {
        preparing: '⏳', fetching: '🔍', downloading: '⬇️',
        downloading_audio: '🎵', merging: '🔧', processing: '⚙️',
        completed: '✅', failed: '❌'
    };

    var icon = icons[taskObj.status] || '⏳';
    var pct = Math.round(taskObj.progress * 100);

    existing.className = 'queue-item';
    if (taskObj.status === 'completed') existing.classList.add('completed');
    if (taskObj.status === 'failed') existing.classList.add('failed');

    var iconEl = existing.querySelector('.queue-status-icon');
    var fillEl = existing.querySelector('.queue-progress-fill');
    var pctEl = existing.querySelector('.queue-percent');
    var actionsEl = existing.querySelector('.queue-actions');

    if (iconEl) iconEl.textContent = icon;
    if (fillEl) {
        fillEl.style.width = pct + '%';
        fillEl.className = 'queue-progress-fill' +
            (taskObj.status === 'completed' ? ' completed' : '') +
            (taskObj.status === 'failed' ? ' failed' : '');
    }
    if (pctEl) pctEl.textContent = pct + '%';
    if (actionsEl) {
        actionsEl.innerHTML = taskObj.status === 'completed'
            ? '<button class="queue-action-btn download" onclick="window._downloadFile(\'' + taskObj.taskId + '\')">下载</button>'
            : '';
    }

    var activeCount = state.activeTasks.filter(function(t) {
        return t.status !== 'completed' && t.status !== 'failed';
    }).length;
    els.queueCount.textContent = activeCount;
}

window._downloadFile = function(taskId) {
    var a = document.createElement('a');
    a.href = '/api/download/' + taskId;
    a.download = '';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
};

function formatDuration(seconds) {
    if (!seconds || seconds <= 0) return '-';
    var h = Math.floor(seconds / 3600);
    var m = Math.floor((seconds % 3600) / 60);
    var s = seconds % 60;
    if (h > 0) return h + ':' + pad(m) + ':' + pad(s);
    return m + ':' + pad(s);
}

function pad(n) { return n < 10 ? '0' + n : '' + n; }

function escapeHtml(str) {
    if (!str) return '';
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function showLanHint() {
    els.lanHint.textContent = 'Web 界面: ' + window.location.origin + '/web/';
}

document.addEventListener('DOMContentLoaded', init);
})();
