// StudyTrack Frontend Logic

const state = {
  selectedDate: getTodayStr(),
  dayData: null,
  reportRange: 'all',
  customStartDate: '',
  customEndDate: '',
  isSavingSession: false,
  isSavingTimer: false,
  isSavingDailyLog: false,
  liveTimer: {
    running: false,
    paused: false,
    accumulatedMs: 0,
    startTimestamp: null,
    startTimeStr: null,
    dateStr: null,
    intervalId: null
  }
};

function getTodayStr() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatDuration(totalMinutes) {
  const mins = Math.max(0, Math.round(Number(totalMinutes) || 0));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

function formatDecimalHours(totalMinutes) {
  const mins = Math.max(0, Number(totalMinutes) || 0);
  return `${(mins / 60).toFixed(1)} hrs`;
}

function formatSignedPool(signedMinutes, { forcePlus = false } = {}) {
  const mins = Math.round(Number(signedMinutes) || 0);
  const abs = Math.abs(mins);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  const base = `${h}h ${String(m).padStart(2, '0')}m`;
  if (mins < 0) return `-${base}`;
  if (mins > 0 && forcePlus) return `+${base}`;
  return base;
}

function formatSignedDecimalHours(signedMinutes) {
  const mins = Number(signedMinutes) || 0;
  const sign = mins < 0 ? '-' : '';
  return `${sign}${(Math.abs(mins) / 60).toFixed(1)} hrs`;
}

function formatTime12h(time24) {
  if (!time24 || !time24.includes(':')) return time24 || '—';
  const [hStr, mStr] = time24.split(':');
  let h = parseInt(hStr, 10);
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  if (h === 0) h = 12;
  return `${String(h).padStart(2, '0')}:${mStr} ${ampm}`;
}

function formatHumanDate(dateStr) {
  if (!dateStr) return '';
  const today = getTodayStr();
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const formatted = dt.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
  if (dateStr === today) return `Today (${formatted})`;
  return formatted;
}

function parseTimeToMins(t) {
  if (!t || !t.includes(':')) return null;
  const [h, m] = t.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

function minsToTime24(totalMins) {
  const normalized = ((totalMins % 1440) + 1440) % 1440;
  const h = Math.floor(normalized / 60);
  const m = normalized % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function calcDiffMinutes(startStr, endStr) {
  const s = parseTimeToMins(startStr);
  const e = parseTimeToMins(endStr);
  if (s === null || e === null) return null;
  let diff = e - s;
  if (diff <= 0) diff += 1440;
  return diff;
}

function showToast(message) {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 3200);
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Initialize default form times
function setDefaultFormTimes() {
  const startInput = document.getElementById('startTimeInput');
  const endInput = document.getElementById('endTimeInput');
  if (!startInput.value) startInput.value = '09:00';
  if (!endInput.value) endInput.value = '10:00';
  updateDurationPreview();
}

function updateDurationPreview() {
  const start = document.getElementById('startTimeInput').value;
  const end = document.getElementById('endTimeInput').value;
  const badge = document.getElementById('sessionDurationPreview');
  const diff = calcDiffMinutes(start, end);
  if (diff !== null && diff > 0) {
    badge.textContent = `Duration: ${formatDuration(diff)} (${formatDecimalHours(diff)})`;
  } else {
    badge.textContent = 'Select valid times';
  }
}

// Fetch Storage Info
async function refreshStorageInfo() {
  try {
    const res = await fetch('/api/storage-info');
    if (!res.ok) return;
    const info = await res.json();
    const badgeText = document.getElementById('dbStatusText');
    const badge = document.getElementById('dbStatusBadge');
    badgeText.textContent = `SQLite Saved (${info.total_saved_sessions} sessions • ${info.total_saved_days} days)`;
    badge.title = `Permanent Database File: ${info.db_path} (${(info.file_size_bytes / 1024).toFixed(1)} KB)`;
  } catch (e) {
    console.error(e);
  }
}

// Fetch Subject Autocomplete Suggestions
async function refreshSubjects() {
  try {
    const res = await fetch('/api/subjects');
    if (!res.ok) return;
    const subjects = await res.json();
    const defaults = [
      'Mathematics',
      'Physics',
      'Chemistry',
      'Biology',
      'Computer Science',
      'English',
      'Revision / Practice'
    ];
    const merged = Array.from(new Set([...subjects, ...defaults]));
    const datalist = document.getElementById('subjectSuggestions');
    datalist.innerHTML = merged.map(s => `<option value="${escapeHtml(s)}"></option>`).join('');
  } catch (e) {
    console.error(e);
  }
}

// Load Data for Selected Date
async function loadSelectedDay() {
  try {
    document.getElementById('selectedDateInput').value = state.selectedDate;
    document.getElementById('selectedDateHuman').textContent = formatHumanDate(state.selectedDate);

    const res = await fetch(`/api/day/${state.selectedDate}`);
    if (!res.ok) throw new Error('Failed to load day data');
    const data = await res.json();
    state.dayData = data;

    renderDayKpis(data);
    renderPendingForm(data);
    renderDayTimeline(data);

    // Suggest next session start time based on last session end time
    if (!document.getElementById('editingSessionId').value) {
      if (data.last_end) {
        const lastEndMins = parseTimeToMins(data.last_end);
        document.getElementById('startTimeInput').value = data.last_end;
        document.getElementById('endTimeInput').value = minsToTime24((lastEndMins || 540) + 60);
        updateDurationPreview();
      }
    }
  } catch (err) {
    console.error(err);
    showToast('Error loading day data');
  }
}

function renderDayKpis(data) {
  document.getElementById('dayStudiedValue').textContent = formatDuration(data.total_studied_minutes);
  document.getElementById('dayStudiedSub').textContent =
    `${data.session_count} session${data.session_count === 1 ? '' : 's'} (${formatDecimalHours(data.total_studied_minutes)})`;

  const pendingMins = data.pending_minutes || 0;
  const extraMins = data.extra_minutes || 0;
  const netMins = data.net_pool_change_minutes ?? (pendingMins - extraMins);
  const dayValEl = document.getElementById('dayPendingValue');
  const daySubEl = document.getElementById('dayPendingSub');
  const dayCard = document.getElementById('dayEndKpiCard');

  dayCard.classList.remove('kpi-pool-ahead');

  if (!data.has_pending_entry) {
    dayValEl.textContent = '0h 00m';
    daySubEl.textContent = 'Enter pending or extra hours at end of day';
  } else if (extraMins > 0 && pendingMins === 0) {
    dayValEl.textContent = `-${formatDuration(extraMins)} Extra`;
    dayCard.classList.add('kpi-pool-ahead');
    daySubEl.textContent = data.daily_note
      ? `Decreases pending pool • Note: ${data.daily_note}`
      : `Decreases pending pool (${formatDecimalHours(extraMins)} extra)`;
  } else if (pendingMins > 0 && extraMins === 0) {
    dayValEl.textContent = `+${formatDuration(pendingMins)} Pending`;
    daySubEl.textContent = data.daily_note
      ? `Increases pending pool • Note: ${data.daily_note}`
      : `Increases pending pool (${formatDecimalHours(pendingMins)})`;
  } else if (pendingMins > 0 && extraMins > 0) {
    dayValEl.textContent = `Net ${formatSignedPool(netMins, { forcePlus: true })}`;
    if (netMins < 0) dayCard.classList.add('kpi-pool-ahead');
    daySubEl.textContent = `Pending +${formatDuration(pendingMins)} / Extra -${formatDuration(extraMins)}` +
      (data.daily_note ? ` • ${data.daily_note}` : '');
  } else {
    dayValEl.textContent = '0h 00m (On Target)';
    daySubEl.textContent = data.daily_note
      ? `Note: ${data.daily_note}`
      : 'Stipulated hours matched for this day';
  }

  if (data.first_start && data.last_end) {
    document.getElementById('dayWindowValue').textContent =
      `${formatTime12h(data.first_start)} – ${formatTime12h(data.last_end)}`;
  } else {
    document.getElementById('dayWindowValue').textContent = 'No sessions yet';
  }

  document.getElementById('dayBreaksSub').textContent =
    `${formatDuration(data.total_break_minutes)} breaks between sessions (${data.breaks.length} gap${data.breaks.length === 1 ? '' : 's'})`;
}

function updatePoolImpactPreview() {
  const preview = document.getElementById('dailyPoolImpactPreview');
  if (!preview) return;

  const pH = Math.max(0, parseInt(document.getElementById('pendingHoursInput').value, 10) || 0);
  const pM = Math.max(0, parseInt(document.getElementById('pendingMinutesInput').value, 10) || 0);
  const eH = Math.max(0, parseInt(document.getElementById('extraHoursInput').value, 10) || 0);
  const eM = Math.max(0, parseInt(document.getElementById('extraMinutesInput').value, 10) || 0);

  const formPending = pH * 60 + pM;
  const formExtra = eH * 60 + eM;
  const formNet = formPending - formExtra;

  const currentAllTimePool = state.dayData ? (state.dayData.all_time_pool_minutes || 0) : 0;
  const savedTodayNet = state.dayData
    ? ((state.dayData.pending_minutes || 0) - (state.dayData.extra_minutes || 0))
    : 0;
  const otherDaysPool = currentAllTimePool - savedTodayNet;
  const projectedPool = otherDaysPool + formNet;

  preview.classList.remove('impact-ahead', 'impact-pending', 'impact-neutral');

  const todayNetLabel = formNet === 0
    ? '0h 00m (No change)'
    : (formNet > 0
      ? `+${formatDuration(formNet)} (increases pool)`
      : `-${formatDuration(Math.abs(formNet))} (decreases pool)`);

  let projectedText;
  if (projectedPool < 0) {
    preview.classList.add('impact-ahead');
    projectedText = `<strong>${escapeHtml(formatSignedPool(projectedPool))}</strong> — ${escapeHtml(formatDuration(Math.abs(projectedPool)))} more than stipulated!`;
  } else if (projectedPool > 0) {
    preview.classList.add('impact-pending');
    projectedText = `<strong>${escapeHtml(formatSignedPool(projectedPool))}</strong> remaining in pending pool`;
  } else {
    preview.classList.add('impact-neutral');
    projectedText = `<strong>0h 00m</strong> — Stipulated hours matched`;
  }

  preview.innerHTML = `
    <div>Today's Net Effect: <strong>${escapeHtml(todayNetLabel)}</strong></div>
    <div>Projected Pending Hours Pool: ${projectedText}</div>
  `;
}

function renderPendingForm(data) {
  const pMins = data.pending_minutes || 0;
  const eMins = data.extra_minutes || 0;

  document.getElementById('pendingHoursInput').value = Math.floor(pMins / 60);
  document.getElementById('pendingMinutesInput').value = pMins % 60;
  document.getElementById('extraHoursInput').value = Math.floor(eMins / 60);
  document.getElementById('extraMinutesInput').value = eMins % 60;
  document.getElementById('dailyNoteInput').value = data.daily_note || '';

  const badge = document.getElementById('pendingSavedBadge');
  if (data.has_pending_entry) {
    const net = pMins - eMins;
    badge.textContent = net === 0
      ? 'Saved: 0h 00m'
      : `Saved Net: ${formatSignedPool(net, { forcePlus: true })}`;
  } else {
    badge.textContent = 'Not Logged Yet';
  }

  updatePoolImpactPreview();
}

function renderDayTimeline(data) {
  const track = document.getElementById('visualBarTrack');
  const labels = document.getElementById('visualBarLabels');
  const list = document.getElementById('dailyTimelineList');
  const footer = document.getElementById('dailySummaryFooter');

  // Build segments for proportional visual bar
  const segments = [];
  const breaksByAfterId = new Map();
  for (const b of data.breaks) {
    breaksByAfterId.set(b.after_session_id, b);
  }

  for (const s of data.sessions) {
    segments.push({
      type: 'study',
      minutes: s.duration_minutes,
      label: `${s.subject} (${formatDuration(s.duration_minutes)})`,
      title: `Studied ${s.subject}: ${formatTime12h(s.start_time)} – ${formatTime12h(s.end_time)} (${formatDuration(s.duration_minutes)})`
    });
    const brk = breaksByAfterId.get(s.id);
    if (brk) {
      segments.push({
        type: 'break',
        minutes: brk.duration_minutes,
        label: `Break ${formatDuration(brk.duration_minutes)}`,
        title: `Break between sessions: ${formatTime12h(brk.from_time)} – ${formatTime12h(brk.to_time)} (${formatDuration(brk.duration_minutes)})`
      });
    }
  }

  if (data.pending_minutes > 0) {
    segments.push({
      type: 'pending',
      minutes: data.pending_minutes,
      label: `Pending: +${formatDuration(data.pending_minutes)}`,
      title: `End-of-Day Pending Time (+Pool): ${formatDuration(data.pending_minutes)}`
    });
  }

  if (data.extra_minutes > 0) {
    segments.push({
      type: 'extra',
      minutes: data.extra_minutes,
      label: `Extra: -${formatDuration(data.extra_minutes)}`,
      title: `End-of-Day Extra Study Time (-Pool): ${formatDuration(data.extra_minutes)}`
    });
  }

  const totalBarMins = segments.reduce((acc, seg) => acc + seg.minutes, 0);
  if (totalBarMins === 0) {
    track.innerHTML = `<div class="bar-segment" style="flex:1 1 0%; background:#e2e8f0; color:#64748b;">No study sessions or pending/extra hours logged for ${escapeHtml(data.date)} yet</div>`;
    labels.innerHTML = `<span>Start of Day</span><span>End of Day</span>`;
  } else {
    track.innerHTML = segments.map(seg => {
      const share = seg.minutes / totalBarMins;
      const cls = seg.type === 'study'
        ? 'seg-study'
        : (seg.type === 'break'
          ? 'seg-break'
          : (seg.type === 'extra' ? 'seg-extra' : 'seg-pending'));
      const displayLabel = share >= 0.09 ? seg.label : '';
      return `<div class="bar-segment ${cls}" style="flex:${Math.max(1, seg.minutes)} 1 0%;" title="${escapeHtml(seg.title)}">${escapeHtml(displayLabel)}</div>`;
    }).join('');

    const startLabel = data.first_start ? `First Start: ${formatTime12h(data.first_start)}` : 'No sessions';
    const endLabel = data.last_end ? `Last End: ${formatTime12h(data.last_end)}` : '';
    const runningPool = data.running_pool_minutes ?? 0;
    const poolLabel = runningPool < 0
      ? `Pool: ${formatSignedPool(runningPool)} (${formatDuration(Math.abs(runningPool))} ahead)`
      : `Pending Pool: ${formatSignedPool(runningPool)}`;
    labels.innerHTML = `<span>${escapeHtml(startLabel)}</span><span>${escapeHtml(endLabel)}</span><span>${escapeHtml(poolLabel)}</span>`;
  }

  // Render chronological list of sessions & breaks
  if (data.sessions.length === 0) {
    list.innerHTML = `
      <div class="timeline-empty">
        <p><strong>No study sessions entered for ${escapeHtml(formatHumanDate(data.date))} yet.</strong></p>
        <p style="margin-top:4px; font-size:0.84rem;">Use the form on the left to enter your study start &amp; end time, or start the live study timer.</p>
      </div>
    `;
  } else {
    const htmlItems = [];
    for (const s of data.sessions) {
      htmlItems.push(`
        <div class="timeline-item-study">
          <div class="session-main">
            <div class="session-time-row">
              <span class="session-time-badge">🕒 ${escapeHtml(formatTime12h(s.start_time))} – ${escapeHtml(formatTime12h(s.end_time))}</span>
              <span class="session-duration-pill">${escapeHtml(formatDuration(s.duration_minutes))}</span>
              <span class="session-subject-pill">📘 ${escapeHtml(s.subject)}</span>
            </div>
            ${s.notes ? `<div class="session-notes">📝 ${escapeHtml(s.notes)}</div>` : ''}
          </div>
          <div class="session-actions">
            <button type="button" class="btn btn-outline btn-sm" onclick="startEditSession(${s.id})">✏️ Edit</button>
            <button type="button" class="btn btn-outline btn-sm" onclick="deleteSession(${s.id})" style="color:var(--danger);">🗑️ Delete</button>
          </div>
        </div>
      `);

      const brk = breaksByAfterId.get(s.id);
      if (brk) {
        htmlItems.push(`
          <div class="timeline-item-break">
            <span>⏸ Break / Gap Between Study Sessions (${escapeHtml(formatTime12h(brk.from_time))} – ${escapeHtml(formatTime12h(brk.to_time))})</span>
            <span>${escapeHtml(formatDuration(brk.duration_minutes))} gap</span>
          </div>
        `);
      }
    }
    list.innerHTML = htmlItems.join('');
  }

  // Render Daily Summary Footer
  const dayNet = data.net_pool_change_minutes ?? ((data.pending_minutes || 0) - (data.extra_minutes || 0));
  const runningPool = data.running_pool_minutes ?? 0;
  const dayNetColor = dayNet < 0 ? 'var(--extra)' : (dayNet > 0 ? 'var(--pending)' : 'var(--text-muted)');
  const dayNetDisplay = dayNet === 0
    ? '0h 00m'
    : `${formatSignedPool(dayNet, { forcePlus: true })} (${formatSignedDecimalHours(dayNet)})`;
  const poolColor = runningPool < 0 ? 'var(--extra)' : (runningPool > 0 ? 'var(--pending)' : 'var(--studied)');
  const poolDisplay = runningPool < 0
    ? `${formatSignedPool(runningPool)} (${formatDuration(Math.abs(runningPool))} ahead!)`
    : `${formatSignedPool(runningPool)} (${formatSignedDecimalHours(runningPool)})`;

  footer.innerHTML = `
    <div class="footer-metric">
      <span>When Studied</span>
      <strong style="color:var(--text);">
        ${data.first_start ? `${escapeHtml(formatTime12h(data.first_start))} – ${escapeHtml(formatTime12h(data.last_end))}` : 'No sessions'}
      </strong>
    </div>
    <div class="footer-metric">
      <span>How Much Studied</span>
      <strong style="color:var(--studied);">
        ${escapeHtml(formatDuration(data.total_studied_minutes))} (${escapeHtml(formatDecimalHours(data.total_studied_minutes))})
      </strong>
    </div>
    <div class="footer-metric">
      <span>Day Pending / Extra</span>
      <strong style="color:${dayNetColor};">
        ${escapeHtml(dayNetDisplay)}
      </strong>
    </div>
    <div class="footer-metric">
      <span>Pending Pool (As of Day)</span>
      <strong style="color:${poolColor};">
        ${escapeHtml(poolDisplay)}
      </strong>
    </div>
  `;
}

// Load Full Report
async function loadReport() {
  try {
    const params = new URLSearchParams();
    const today = new Date();

    if (state.reportRange === '7d') {
      const start = new Date(today);
      start.setDate(start.getDate() - 6);
      params.set('startDate', start.toISOString().slice(0, 10));
      params.set('endDate', getTodayStr());
    } else if (state.reportRange === '30d') {
      const start = new Date(today);
      start.setDate(start.getDate() - 29);
      params.set('startDate', start.toISOString().slice(0, 10));
      params.set('endDate', getTodayStr());
    } else if (state.reportRange === 'month') {
      const y = today.getFullYear();
      const m = String(today.getMonth() + 1).padStart(2, '0');
      params.set('startDate', `${y}-${m}-01`);
      params.set('endDate', getTodayStr());
    } else if (state.reportRange === 'custom') {
      if (state.customStartDate) params.set('startDate', state.customStartDate);
      if (state.customEndDate) params.set('endDate', state.customEndDate);
    }

    const res = await fetch(`/api/report?${params.toString()}`);
    if (!res.ok) throw new Error('Failed to load report');
    const report = await res.json();

    // Also update All-Time KPI card if range is 'all', or fetch all-time separately
    if (state.reportRange === 'all') {
      updateAllTimeKpi(report.totals);
    } else {
      fetch('/api/report').then(r => r.json()).then(allRep => updateAllTimeKpi(allRep.totals)).catch(() => {});
    }

    renderReportSection(report);
  } catch (err) {
    console.error(err);
  }
}

function updateAllTimeKpi(totals) {
  if (!totals) return;
  const pool = totals.all_time_pending_pool_minutes ?? totals.net_pool_minutes ?? 0;
  const poolCard = document.getElementById('poolKpiCard');
  const poolValEl = document.getElementById('allTimePoolValue');
  const poolSubEl = document.getElementById('allTimePoolSub');

  poolCard.classList.remove('kpi-pool-ahead', 'kpi-pool-pending');
  poolValEl.textContent = `${formatSignedPool(pool)} (${formatSignedDecimalHours(pool)})`;

  if (pool < 0) {
    poolCard.classList.add('kpi-pool-ahead');
    poolSubEl.textContent = `✨ ${formatDuration(Math.abs(pool))} more than stipulated! • Studied: ${formatDuration(totals.total_studied_minutes)}`;
  } else if (pool > 0) {
    poolCard.classList.add('kpi-pool-pending');
    poolSubEl.textContent = `⏳ Pending in pool • Studied: ${formatDuration(totals.total_studied_minutes)}`;
  } else {
    poolSubEl.textContent = `✅ On target (0 pending) • Studied: ${formatDuration(totals.total_studied_minutes)}`;
  }
}

function renderReportSection(report) {
  const { totals, days, subjects } = report;

  document.getElementById('repTotalStudied').textContent =
    `${formatDuration(totals.total_studied_minutes)} (${formatDecimalHours(totals.total_studied_minutes)})`;
  document.getElementById('repAvgStudied').textContent =
    `Daily Avg: ${formatDuration(totals.average_studied_minutes_per_day)}`;

  const totalPending = totals.total_pending_minutes || 0;
  const totalExtra = totals.total_extra_minutes || 0;
  document.getElementById('repPendingExtraBreakdown').textContent =
    `Pending: +${formatDuration(totalPending)}`;
  document.getElementById('repExtraMeta').textContent =
    `Extra: -${formatDuration(totalExtra)} (reduces pool)`;

  const isAllTime = state.reportRange === 'all';
  const poolMins = isAllTime
    ? (totals.all_time_pending_pool_minutes ?? totals.net_pool_minutes ?? 0)
    : (totals.net_pool_minutes ?? 0);
  const allTimePoolMins = totals.all_time_pending_pool_minutes ?? poolMins;

  const repPoolBox = document.getElementById('repPoolBox');
  const repPoolBalance = document.getElementById('repPoolBalance');
  const repPoolStatusMeta = document.getElementById('repPoolStatusMeta');

  repPoolBox.classList.remove('stat-ahead', 'stat-pending');
  repPoolBalance.textContent = `${formatSignedPool(poolMins)} (${formatSignedDecimalHours(poolMins)})`;

  if (poolMins < 0) {
    repPoolBox.classList.add('stat-ahead');
    repPoolStatusMeta.textContent = isAllTime
      ? `✨ ${formatDuration(Math.abs(poolMins))} more than stipulated!`
      : `✨ ${formatDuration(Math.abs(poolMins))} ahead in period • All-Time Pool: ${formatSignedPool(allTimePoolMins)}`;
  } else if (poolMins > 0) {
    repPoolBox.classList.add('stat-pending');
    repPoolStatusMeta.textContent = isAllTime
      ? `⏳ Pending hours remaining in pool`
      : `⏳ +${formatDuration(poolMins)} in period • All-Time Pool: ${formatSignedPool(allTimePoolMins)}`;
  } else {
    repPoolStatusMeta.textContent = isAllTime
      ? '✅ Stipulated hours matched (0 pending)'
      : `✅ 0h 00m net in period • All-Time Pool: ${formatSignedPool(allTimePoolMins)}`;
  }

  document.getElementById('repTotalDays').textContent =
    `${totals.total_days_logged} Day${totals.total_days_logged === 1 ? '' : 's'}`;
  document.getElementById('repTotalSessions').textContent =
    `${totals.total_sessions} study session${totals.total_sessions === 1 ? '' : 's'} logged`;

  // Render Subject Breakdown
  const subjBox = document.getElementById('subjectBreakdownBox');
  const subjList = document.getElementById('subjectBarsList');
  if (!subjects || subjects.length === 0) {
    subjBox.style.display = 'none';
  } else {
    subjBox.style.display = 'block';
    subjList.innerHTML = subjects.map(s => {
      const share = totals.total_studied_minutes > 0
        ? Math.round((s.total_minutes / totals.total_studied_minutes) * 100)
        : 0;
      return `
        <div class="subject-bar-item">
          <div class="subject-bar-top">
            <span>📘 ${escapeHtml(s.subject)}</span>
            <span>${escapeHtml(formatDuration(s.total_minutes))} (${share}%)</span>
          </div>
          <div class="subject-bar-fill-wrap">
            <div class="subject-bar-fill" style="width:${share}%"></div>
          </div>
        </div>
      `;
    }).join('');
  }

  // Render Day-by-Day Table
  const tbody = document.getElementById('reportTableBody');
  if (!days || days.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align:center; padding:28px; color:var(--text-muted);">
          No study records found for this period. Add your first study session above!
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = days.map(day => {
    const sessionsHtml = day.sessions.length === 0
      ? `<span style="color:var(--text-muted); font-size:0.82rem;">No study sessions logged</span>`
      : `<div class="session-chip-list">
          ${day.sessions.map(s => `
            <div class="session-mini-item">
              <span class="session-mini-time">${escapeHtml(formatTime12h(s.start_time))} – ${escapeHtml(formatTime12h(s.end_time))}</span>
              <span>(${escapeHtml(formatDuration(s.duration_minutes))})</span>
              <span class="session-mini-subj">• ${escapeHtml(s.subject)}</span>
              ${s.notes ? `<span style="color:var(--text-muted);">— ${escapeHtml(s.notes)}</span>` : ''}
            </div>
          `).join('')}
        </div>`;

    const studiedBadge = day.total_studied_minutes > 0
      ? `<span class="pill-studied">${escapeHtml(formatDuration(day.total_studied_minutes))} (${escapeHtml(formatDecimalHours(day.total_studied_minutes))})</span>`
      : `<span class="pill-zero">0h 00m</span>`;

    const breakText = day.total_break_minutes > 0
      ? `${escapeHtml(formatDuration(day.total_break_minutes))} (${day.breaks.length} gap${day.breaks.length === 1 ? '' : 's'})`
      : `<span style="color:var(--text-muted);">0h 00m</span>`;

    const eodParts = [];
    if ((day.pending_minutes || 0) > 0) {
      eodParts.push(`<span class="pill-pending">⏳ +${escapeHtml(formatDuration(day.pending_minutes))} Pending</span>`);
    }
    if ((day.extra_minutes || 0) > 0) {
      eodParts.push(`<span class="pill-extra">🌟 -${escapeHtml(formatDuration(day.extra_minutes))} Extra</span>`);
    }
    let eodHtml;
    if (eodParts.length > 0) {
      eodHtml = `<div style="display:flex; flex-direction:column; gap:4px; align-items:flex-start;">${eodParts.join('')}</div>`;
    } else if (day.has_pending_entry) {
      eodHtml = `<span class="pill-studied">✅ 0h 00m (On Target)</span>`;
    } else {
      eodHtml = `<span class="pill-zero">Not entered</span>`;
    }

    const poolMinsDay = day.running_pool_minutes ?? 0;
    let poolBadge;
    if (poolMinsDay < 0) {
      poolBadge = `<span class="pill-extra">🌟 ${escapeHtml(formatSignedPool(poolMinsDay))} (${escapeHtml(formatDuration(Math.abs(poolMinsDay)))} ahead)</span>`;
    } else if (poolMinsDay > 0) {
      poolBadge = `<span class="pill-pending">⏳ ${escapeHtml(formatSignedPool(poolMinsDay))}</span>`;
    } else {
      poolBadge = `<span class="pill-zero">0h 00m</span>`;
    }

    return `
      <tr>
        <td>
          <strong>${escapeHtml(formatHumanDate(day.date))}</strong>
          <div style="font-size:0.76rem; color:var(--text-muted);">${escapeHtml(day.date)}</div>
        </td>
        <td>${sessionsHtml}</td>
        <td>${studiedBadge}</td>
        <td>${breakText}</td>
        <td>${eodHtml}</td>
        <td>${poolBadge}</td>
        <td>${day.daily_note ? escapeHtml(day.daily_note) : '<span style="color:var(--text-muted);">—</span>'}</td>
        <td class="no-print">
          <button type="button" class="btn btn-outline btn-sm" onclick="jumpToDate('${escapeHtml(day.date)}')">View / Edit</button>
        </td>
      </tr>
    `;
  }).join('');
}

// Jump to specific date from report table
window.jumpToDate = function(dateStr) {
  state.selectedDate = dateStr;
  cancelEditSession();
  loadSelectedDay();
  window.scrollTo({ top: 0, behavior: 'smooth' });
};

// Edit Session Handler
window.startEditSession = function(sessionId) {
  if (!state.dayData) return;
  const session = state.dayData.sessions.find(s => s.id === sessionId);
  if (!session) return;

  document.getElementById('editingSessionId').value = session.id;
  document.getElementById('startTimeInput').value = session.start_time;
  document.getElementById('endTimeInput').value = session.end_time;
  document.getElementById('subjectInput').value = session.subject || '';
  document.getElementById('notesInput').value = session.notes || '';

  document.getElementById('sessionFormTitle').textContent = '✏️ Edit Study Session';
  document.getElementById('saveSessionBtn').textContent = '💾 Update Study Session';
  document.getElementById('cancelEditSessionBtn').style.display = 'inline-flex';
  updateDurationPreview();
  document.getElementById('startTimeInput').focus();
};

function cancelEditSession() {
  document.getElementById('editingSessionId').value = '';
  document.getElementById('notesInput').value = '';
  document.getElementById('sessionFormTitle').textContent = '📝 Enter Study Start & End Time';
  document.getElementById('saveSessionBtn').textContent = '➕ Add Study Session';
  document.getElementById('cancelEditSessionBtn').style.display = 'none';
}

// Delete Session Handler
window.deleteSession = async function(sessionId) {
  if (!confirm('Delete this study session?')) return;
  try {
    const res = await fetch(`/api/sessions/${sessionId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete session');
    showToast('Study session deleted');
    await Promise.all([loadSelectedDay(), loadReport(), refreshStorageInfo()]);
  } catch (err) {
    showToast('Error deleting study session');
  }
};

// Live Timer Logic (with localStorage state persistence across refreshes)
function getTimerElapsedMs() {
  if (!state.liveTimer.running) return 0;
  const activeChunk = state.liveTimer.paused ? 0 : Math.max(0, Date.now() - (state.liveTimer.startTimestamp || Date.now()));
  return (state.liveTimer.accumulatedMs || 0) + activeChunk;
}

function persistTimerState() {
  if (!state.liveTimer.running) {
    localStorage.removeItem('studytrack_active_timer');
    return;
  }
  localStorage.setItem('studytrack_active_timer', JSON.stringify({
    running: state.liveTimer.running,
    paused: state.liveTimer.paused,
    accumulatedMs: state.liveTimer.accumulatedMs,
    startTimestamp: state.liveTimer.startTimestamp,
    startTimeStr: state.liveTimer.startTimeStr,
    dateStr: state.liveTimer.dateStr,
    subject: document.getElementById('timerSubjectInput').value,
    notes: document.getElementById('timerNotesInput').value
  }));
}

function initLiveTimer() {
  const saved = localStorage.getItem('studytrack_active_timer');
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (parsed && parsed.running && parsed.startTimeStr) {
        state.liveTimer.running = true;
        state.liveTimer.paused = Boolean(parsed.paused);
        state.liveTimer.accumulatedMs = Number(parsed.accumulatedMs) || 0;
        state.liveTimer.startTimestamp = parsed.startTimestamp || Date.now();
        state.liveTimer.startTimeStr = parsed.startTimeStr;
        state.liveTimer.dateStr = parsed.dateStr;
        document.getElementById('timerSubjectInput').value = parsed.subject || '';
        document.getElementById('timerNotesInput').value = parsed.notes || '';
        startTimerInterval();
      }
    } catch (e) {
      localStorage.removeItem('studytrack_active_timer');
    }
  }
}

function startTimerInterval() {
  const badge = document.getElementById('timerStateBadge');
  const pauseBtn = document.getElementById('pauseTimerBtn');

  if (state.liveTimer.paused) {
    badge.textContent = '⏸ Paused';
    badge.classList.remove('running');
    pauseBtn.textContent = '▶ Resume';
  } else {
    badge.textContent = '● Recording Live';
    badge.classList.add('running');
    pauseBtn.textContent = '⏸ Pause';
  }

  document.getElementById('startTimerBtn').style.display = 'none';
  pauseBtn.style.display = 'inline-flex';
  document.getElementById('stopTimerBtn').style.display = 'inline-flex';
  document.getElementById('cancelTimerBtn').style.display = 'inline-flex';
  document.getElementById('liveTimerMeta').textContent =
    `Started at ${formatTime12h(state.liveTimer.startTimeStr)} (${state.liveTimer.dateStr})`;

  const updateTick = () => {
    const elapsedSec = Math.max(0, Math.floor(getTimerElapsedMs() / 1000));
    const h = String(Math.floor(elapsedSec / 3600)).padStart(2, '0');
    const m = String(Math.floor((elapsedSec % 3600) / 60)).padStart(2, '0');
    const s = String(elapsedSec % 60).padStart(2, '0');
    document.getElementById('liveTimerClock').textContent = `${h}:${m}:${s}`;
  };

  updateTick();
  if (state.liveTimer.intervalId) clearInterval(state.liveTimer.intervalId);
  if (!state.liveTimer.paused) {
    state.liveTimer.intervalId = setInterval(updateTick, 1000);
  }
}

function resetTimerUI() {
  if (state.liveTimer.intervalId) clearInterval(state.liveTimer.intervalId);
  state.liveTimer = {
    running: false,
    paused: false,
    accumulatedMs: 0,
    startTimestamp: null,
    startTimeStr: null,
    dateStr: null,
    intervalId: null
  };
  localStorage.removeItem('studytrack_active_timer');

  const badge = document.getElementById('timerStateBadge');
  badge.textContent = 'Ready';
  badge.classList.remove('running');
  document.getElementById('liveTimerClock').textContent = '00:00:00';
  document.getElementById('liveTimerMeta').textContent = 'Click Start when you begin studying';
  document.getElementById('startTimerBtn').style.display = 'inline-flex';
  document.getElementById('pauseTimerBtn').style.display = 'none';
  document.getElementById('stopTimerBtn').style.display = 'none';
  document.getElementById('stopTimerBtn').disabled = false;
  document.getElementById('cancelTimerBtn').style.display = 'none';
}

// Event Listeners Setup
document.addEventListener('DOMContentLoaded', () => {
  setDefaultFormTimes();
  initLiveTimer();

  // Initial Data Load
  loadSelectedDay();
  loadReport();
  refreshStorageInfo();
  refreshSubjects();

  // Date Picker Navigation
  document.getElementById('selectedDateInput').addEventListener('change', (e) => {
    if (e.target.value) {
      state.selectedDate = e.target.value;
      cancelEditSession();
      loadSelectedDay();
    }
  });

  document.getElementById('prevDayBtn').addEventListener('click', () => {
    const [y, m, d] = state.selectedDate.split('-').map(Number);
    const dt = new Date(y, m - 1, d - 1);
    state.selectedDate = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    cancelEditSession();
    loadSelectedDay();
  });

  document.getElementById('nextDayBtn').addEventListener('click', () => {
    const [y, m, d] = state.selectedDate.split('-').map(Number);
    const dt = new Date(y, m - 1, d + 1);
    state.selectedDate = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    cancelEditSession();
    loadSelectedDay();
  });

  document.getElementById('goTodayBtn').addEventListener('click', () => {
    state.selectedDate = getTodayStr();
    cancelEditSession();
    loadSelectedDay();
  });

  // Start & End Time Change -> Live Duration Preview
  document.getElementById('startTimeInput').addEventListener('input', updateDurationPreview);
  document.getElementById('endTimeInput').addEventListener('input', updateDurationPreview);

  // Prevent Enter key inside time pickers from accidentally submitting the form mid-entry
  ['startTimeInput', 'endTimeInput'].forEach(id => {
    document.getElementById(id).addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (id === 'startTimeInput') {
          document.getElementById('endTimeInput').focus();
        } else {
          document.getElementById('subjectInput').focus();
        }
      }
    });
  });

  // Quick Duration Chip Buttons
  document.querySelectorAll('[data-add-mins]').forEach(btn => {
    btn.addEventListener('click', () => {
      const addMins = parseInt(btn.getAttribute('data-add-mins'), 10);
      const startVal = document.getElementById('startTimeInput').value || '09:00';
      const startMins = parseTimeToMins(startVal) ?? 540;
      document.getElementById('endTimeInput').value = minsToTime24(startMins + addMins);
      updateDurationPreview();
    });
  });

  // Quick Pending Time Chip Buttons
  document.querySelectorAll('[data-pending-mins]').forEach(btn => {
    btn.addEventListener('click', () => {
      const totalMins = parseInt(btn.getAttribute('data-pending-mins'), 10);
      document.getElementById('pendingHoursInput').value = Math.floor(totalMins / 60);
      document.getElementById('pendingMinutesInput').value = totalMins % 60;
      updatePoolImpactPreview();
    });
  });

  // Quick Extra Time Chip Buttons
  document.querySelectorAll('[data-extra-mins]').forEach(btn => {
    btn.addEventListener('click', () => {
      const totalMins = parseInt(btn.getAttribute('data-extra-mins'), 10);
      document.getElementById('extraHoursInput').value = Math.floor(totalMins / 60);
      document.getElementById('extraMinutesInput').value = totalMins % 60;
      updatePoolImpactPreview();
    });
  });

  // Live preview update when typing pending/extra hours or minutes
  ['pendingHoursInput', 'pendingMinutesInput', 'extraHoursInput', 'extraMinutesInput'].forEach(id => {
    document.getElementById(id).addEventListener('input', updatePoolImpactPreview);
  });

  // Cancel Edit Session Button
  document.getElementById('cancelEditSessionBtn').addEventListener('click', cancelEditSession);

  // Submit Study Session Form (Create or Update)
  document.getElementById('studySessionForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (state.isSavingSession) return;

    const editingId = document.getElementById('editingSessionId').value;
    const start_time = document.getElementById('startTimeInput').value;
    const end_time = document.getElementById('endTimeInput').value;
    const subject = document.getElementById('subjectInput').value.trim() || 'General Study';
    const notes = document.getElementById('notesInput').value.trim();

    if (start_time === end_time) {
      showToast('End time must be different from start time');
      return;
    }

    state.isSavingSession = true;
    const saveBtn = document.getElementById('saveSessionBtn');
    saveBtn.disabled = true;

    try {
      const url = editingId ? `/api/sessions/${editingId}` : '/api/sessions';
      const method = editingId ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: state.selectedDate,
          start_time,
          end_time,
          subject,
          notes,
          source: editingId ? 'manual_edit' : 'manual_form'
        })
      });

      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || 'Failed to save session');
        return;
      }

      showToast(editingId ? 'Study session updated!' : 'Study session saved to database!');
      cancelEditSession();
      await Promise.all([loadSelectedDay(), loadReport(), refreshStorageInfo(), refreshSubjects()]);
    } catch (err) {
      showToast('Error saving study session');
    } finally {
      state.isSavingSession = false;
      saveBtn.disabled = false;
    }
  });

  // Submit End-of-Day Pending & Extra Hours Form
  document.getElementById('dailyPendingForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (state.isSavingDailyLog) return;

    const pHours = Math.max(0, parseInt(document.getElementById('pendingHoursInput').value, 10) || 0);
    const pMins = Math.max(0, parseInt(document.getElementById('pendingMinutesInput').value, 10) || 0);
    const eHours = Math.max(0, parseInt(document.getElementById('extraHoursInput').value, 10) || 0);
    const eMins = Math.max(0, parseInt(document.getElementById('extraMinutesInput').value, 10) || 0);

    const pending_minutes = pHours * 60 + pMins;
    const extra_minutes = eHours * 60 + eMins;
    const daily_note = document.getElementById('dailyNoteInput').value.trim();

    state.isSavingDailyLog = true;
    const saveBtn = document.getElementById('saveDailyLogBtn');
    saveBtn.disabled = true;

    try {
      const res = await fetch(`/api/daily-log/${state.selectedDate}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pending_minutes, extra_minutes, daily_note })
      });

      if (!res.ok) throw new Error('Failed to save daily log');
      const net = pending_minutes - extra_minutes;
      showToast(`Saved end-of-day log (Net pool change: ${formatSignedPool(net, { forcePlus: true })})!`);
      await Promise.all([loadSelectedDay(), loadReport(), refreshStorageInfo()]);
    } catch (err) {
      showToast('Error saving end-of-day pending / extra hours');
    } finally {
      state.isSavingDailyLog = false;
      saveBtn.disabled = false;
    }
  });

  // Live Timer Controls
  document.getElementById('startTimerBtn').addEventListener('click', () => {
    const now = new Date();
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    const startTimeStr = `${h}:${m}`;

    state.liveTimer.running = true;
    state.liveTimer.paused = false;
    state.liveTimer.accumulatedMs = 0;
    state.liveTimer.startTimestamp = Date.now();
    state.liveTimer.startTimeStr = startTimeStr;
    state.liveTimer.dateStr = state.selectedDate;

    persistTimerState();
    startTimerInterval();
    showToast(`Live study timer started at ${formatTime12h(startTimeStr)}`);
  });

  document.getElementById('pauseTimerBtn').addEventListener('click', () => {
    if (!state.liveTimer.running) return;
    if (!state.liveTimer.paused) {
      state.liveTimer.accumulatedMs += Math.max(0, Date.now() - (state.liveTimer.startTimestamp || Date.now()));
      state.liveTimer.startTimestamp = null;
      state.liveTimer.paused = true;
      showToast('Timer paused');
    } else {
      state.liveTimer.startTimestamp = Date.now();
      state.liveTimer.paused = false;
      showToast('Timer resumed');
    }
    persistTimerState();
    startTimerInterval();
  });

  document.getElementById('stopTimerBtn').addEventListener('click', async () => {
    if (!state.liveTimer.running || state.isSavingTimer) return;

    const totalElapsedMs = getTimerElapsedMs();
    const totalElapsedSec = Math.floor(totalElapsedMs / 1000);

    // Prevent accidental < 1 minute sessions from being silently added
    if (totalElapsedSec < 60) {
      const saveAnyway = confirm(
        `The timer only ran for ${totalElapsedSec} second${totalElapsedSec === 1 ? '' : 's'} (under 1 minute).\n\nClick OK to save it as a 1-minute session, or Cancel to keep timing (use Discard to cancel without saving).`
      );
      if (!saveAnyway) return;
    }

    state.isSavingTimer = true;
    const stopBtn = document.getElementById('stopTimerBtn');
    stopBtn.disabled = true;

    const now = new Date();
    const elapsedMins = Math.max(1, Math.round(totalElapsedMs / 60000));
    const startMins = parseTimeToMins(state.liveTimer.startTimeStr) ?? (now.getHours() * 60 + now.getMinutes());
    const endTimeStr = minsToTime24(startMins + elapsedMins);

    const subject = document.getElementById('timerSubjectInput').value.trim() || 'General Study';
    const notes = document.getElementById('timerNotesInput').value.trim();
    const sessionDate = state.liveTimer.dateStr || state.selectedDate;

    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: sessionDate,
          start_time: state.liveTimer.startTimeStr,
          end_time: endTimeStr,
          subject,
          notes,
          source: 'live_timer',
          elapsed_seconds: totalElapsedSec
        })
      });

      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || 'Failed to save timer session');
        return;
      }

      resetTimerUI();
      document.getElementById('timerNotesInput').value = '';
      showToast(`Saved live session (${formatDuration(elapsedMins)})!`);
      await Promise.all([loadSelectedDay(), loadReport(), refreshStorageInfo(), refreshSubjects()]);
    } catch (err) {
      showToast('Error saving live timer session');
    } finally {
      state.isSavingTimer = false;
      stopBtn.disabled = false;
    }
  });

  document.getElementById('cancelTimerBtn').addEventListener('click', () => {
    if (confirm('Discard the running timer without saving?')) {
      resetTimerUI();
    }
  });

  // Report Range Filter Pills
  document.querySelectorAll('.filter-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      state.reportRange = pill.getAttribute('data-range');
      loadReport();
    });
  });

  document.getElementById('applyCustomRangeBtn').addEventListener('click', () => {
    const s = document.getElementById('reportStartDate').value;
    const e = document.getElementById('reportEndDate').value;
    document.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
    state.reportRange = 'custom';
    state.customStartDate = s;
    state.customEndDate = e;
    loadReport();
  });

  // Restore JSON Backup
  const restoreBtn = document.getElementById('restoreBackupBtn');
  const restoreInput = document.getElementById('restoreFileInput');
  restoreBtn.addEventListener('click', () => restoreInput.click());
  restoreInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      const res = await fetch('/api/import/json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Import failed');
      showToast(`Restored ${result.imported_sessions} sessions & ${result.imported_logs} daily logs!`);
      await Promise.all([loadSelectedDay(), loadReport(), refreshStorageInfo(), refreshSubjects()]);
    } catch (err) {
      showToast('Invalid backup JSON file');
    } finally {
      restoreInput.value = '';
    }
  });

  // Print Report
  document.getElementById('printReportBtn').addEventListener('click', () => {
    window.print();
  });

  // Open Database Folder in Windows Explorer
  document.getElementById('dbStatusBadge').addEventListener('click', async () => {
    try {
      const res = await fetch('/api/open-db-folder', { method: 'POST' });
      const data = await res.json();
      if (data.db_path) {
        showToast(`Opened folder for: ${data.db_path}`);
      }
    } catch (e) {
      console.error(e);
    }
  });
});
