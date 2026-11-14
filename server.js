const express = require('express');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const { DatabaseSync } = require('node:sqlite');

/**
 * Parse "HH:MM" into minutes since 00:00
 */
function parseTimeToMinutes(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return null;
  const match = timeStr.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/**
 * Calculate duration in minutes between start_time and end_time.
 * If end_time is earlier than start_time, assumes session crossed midnight.
 */
function calculateDurationMinutes(startTime, endTime) {
  const startMins = parseTimeToMinutes(startTime);
  const endMins = parseTimeToMinutes(endTime);
  if (startMins === null || endMins === null) return null;
  let diff = endMins - startMins;
  if (diff <= 0) {
    diff += 24 * 60;
  }
  return diff;
}

/**
 * Compute breaks (gaps) between chronologically sorted sessions on the same day.
 */
function computeDailyBreaks(sessions) {
  const sorted = [...sessions].sort((a, b) => a.start_time.localeCompare(b.start_time));
  const breaks = [];

  for (let i = 0; i < sorted.length - 1; i++) {
    const currentEnd = parseTimeToMinutes(sorted[i].end_time);
    const nextStart = parseTimeToMinutes(sorted[i + 1].start_time);
    if (currentEnd !== null && nextStart !== null && nextStart > currentEnd) {
      breaks.push({
        from_time: sorted[i].end_time,
        to_time: sorted[i + 1].start_time,
        duration_minutes: nextStart - currentEnd,
        after_session_id: sorted[i].id,
        before_session_id: sorted[i + 1].id
      });
    }
  }
  return breaks;
}

/**
 * Build structured summary object for a single date
 */
function buildDaySummary(date, sessions, dailyLog, runningPoolMinutes = 0, allTimePoolMinutes = 0) {
  const sortedSessions = [...sessions].sort((a, b) => a.start_time.localeCompare(b.start_time));
  const breaks = computeDailyBreaks(sortedSessions);
  const totalStudiedMinutes = sortedSessions.reduce((sum, s) => sum + (s.duration_minutes || 0), 0);
  const totalBreakMinutes = breaks.reduce((sum, b) => sum + (b.duration_minutes || 0), 0);
  const pendingMinutes = dailyLog ? (dailyLog.pending_minutes || 0) : 0;
  const extraMinutes = dailyLog ? (dailyLog.extra_minutes || 0) : 0;
  const netPoolChangeMinutes = pendingMinutes - extraMinutes;
  const dailyNote = dailyLog ? (dailyLog.daily_note || '') : '';
  const hasPendingEntry = Boolean(dailyLog);

  return {
    date,
    sessions: sortedSessions,
    breaks,
    total_studied_minutes: totalStudiedMinutes,
    total_break_minutes: totalBreakMinutes,
    pending_minutes: pendingMinutes,
    extra_minutes: extraMinutes,
    net_pool_change_minutes: netPoolChangeMinutes,
    running_pool_minutes: runningPoolMinutes,
    all_time_pool_minutes: allTimePoolMinutes,
    daily_note: dailyNote,
    has_pending_entry: hasPendingEntry,
    first_start: sortedSessions.length > 0 ? sortedSessions[0].start_time : null,
    last_end: sortedSessions.length > 0 ? sortedSessions[sortedSessions.length - 1].end_time : null,
    session_count: sortedSessions.length
  };
}

function getDefaultDataDir() {
  if (process.env.APPDATA) {
    return path.join(process.env.APPDATA, 'StudyTrack', 'data');
  }
  return path.join(__dirname, 'data');
}

function startServer(options = {}) {
  const dataDir = options.dataDir || process.env.STUDYTRACK_DATA_DIR || getDefaultDataDir();
  const requestedPort = options.port !== undefined ? options.port : (process.env.PORT || 4567);

  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const DB_PATH = path.join(dataDir, 'study_tracker.db');
  const LOG_PATH = path.join(dataDir, 'activity.log');
  const db = new DatabaseSync(DB_PATH);

  function writeAuditLog(action, details = {}) {
    try {
      const entry = JSON.stringify({
        ts: new Date().toISOString(),
        local_time: new Date().toLocaleString(),
        action,
        ...details
      });
      fs.appendFileSync(LOG_PATH, entry + '\n', 'utf8');
    } catch (e) {
      // ignore logging errors
    }
  }

  // Configure SQLite for durability and concurrency
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS study_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      duration_minutes INTEGER NOT NULL,
      subject TEXT DEFAULT 'General Study',
      notes TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_date ON study_sessions(date, start_time);

    CREATE TABLE IF NOT EXISTS daily_logs (
      date TEXT PRIMARY KEY,
      pending_minutes INTEGER NOT NULL DEFAULT 0,
      extra_minutes INTEGER NOT NULL DEFAULT 0,
      daily_note TEXT DEFAULT '',
      updated_at TEXT DEFAULT (datetime('now', 'localtime'))
    );
  `);

  // Backward-compatible schema migration for existing student databases
  const dailyLogCols = db.prepare('PRAGMA table_info(daily_logs)').all();
  if (!dailyLogCols.some(c => c.name === 'extra_minutes')) {
    db.exec('ALTER TABLE daily_logs ADD COLUMN extra_minutes INTEGER NOT NULL DEFAULT 0;');
  }

  /**
   * Compute cumulative Pending Hours Pool up to each date (or overall).
   * Pending hours increase the pool (+), extra hours decrease the pool (-).
   */
  function getPoolStats() {
    const allLogs = db.prepare(
      'SELECT date, pending_minutes, extra_minutes FROM daily_logs ORDER BY date ASC'
    ).all();

    let allTimePoolMinutes = 0;
    for (const row of allLogs) {
      allTimePoolMinutes += (row.pending_minutes || 0) - (row.extra_minutes || 0);
    }

    function getRunningPoolUpTo(targetDate) {
      let sum = 0;
      for (const row of allLogs) {
        if (row.date <= targetDate) {
          sum += (row.pending_minutes || 0) - (row.extra_minutes || 0);
        } else {
          break;
        }
      }
      return sum;
    }

    return { allTimePoolMinutes, getRunningPoolUpTo };
  }

  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.use(express.static(path.join(__dirname, 'public')));

  // GET storage status info
  app.get('/api/storage-info', (req, res) => {
    try {
      const stats = fs.existsSync(DB_PATH) ? fs.statSync(DB_PATH) : null;
      const sessionCountRow = db.prepare('SELECT COUNT(*) as count FROM study_sessions').get();
      const dayCountRow = db.prepare(`
        SELECT COUNT(DISTINCT date) as count FROM (
          SELECT date FROM study_sessions
          UNION
          SELECT date FROM daily_logs
        )
      `).get();

      res.json({
        db_path: DB_PATH,
        file_size_bytes: stats ? stats.size : 0,
        total_saved_sessions: sessionCountRow ? sessionCountRow.count : 0,
        total_saved_days: dayCountRow ? dayCountRow.count : 0
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST open database folder in Windows Explorer
  app.post('/api/open-db-folder', (req, res) => {
    try {
      if (process.platform === 'win32') {
        execFile('explorer.exe', [`/select,${DB_PATH}`]);
      }
      res.json({ success: true, db_path: DB_PATH });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET distinct subjects for autocomplete
  app.get('/api/subjects', (req, res) => {
    try {
      const rows = db.prepare(`
        SELECT DISTINCT subject
        FROM study_sessions
        WHERE subject IS NOT NULL AND TRIM(subject) != ''
        ORDER BY subject ASC
      `).all();
      res.json(rows.map(r => r.subject));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET data for a specific date
  app.get('/api/day/:date', (req, res) => {
    try {
      const { date } = req.params;
      const sessions = db.prepare(`
        SELECT id, date, start_time, end_time, duration_minutes, subject, notes, created_at
        FROM study_sessions
        WHERE date = ?
        ORDER BY start_time ASC, id ASC
      `).all(date);

      const dailyLog = db.prepare(`
        SELECT date, pending_minutes, extra_minutes, daily_note, updated_at
        FROM daily_logs
        WHERE date = ?
      `).get(date);

      const runningRow = db.prepare(
        'SELECT COALESCE(SUM(pending_minutes - extra_minutes), 0) AS pool FROM daily_logs WHERE date <= ?'
      ).get(date);
      const allTimeRow = db.prepare(
        'SELECT COALESCE(SUM(pending_minutes - extra_minutes), 0) AS pool FROM daily_logs'
      ).get();

      res.json(
        buildDaySummary(
          date,
          sessions,
          dailyLog,
          runningRow ? runningRow.pool : 0,
          allTimeRow ? allTimeRow.pool : 0
        )
      );
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST create a new study session
  app.post('/api/sessions', (req, res) => {
    try {
      const { date, start_time, end_time, subject, notes, source, elapsed_seconds } = req.body;
      if (!date || !start_time || !end_time) {
        return res.status(400).json({ error: 'Date, start time, and end time are required.' });
      }

      const durationMinutes = calculateDurationMinutes(start_time, end_time);
      if (durationMinutes === null || durationMinutes <= 0) {
        return res.status(400).json({ error: 'Invalid start or end time format (use HH:MM).' });
      }

      const cleanSubject = (subject && subject.trim()) ? subject.trim() : 'General Study';
      const cleanNotes = (notes && notes.trim()) ? notes.trim() : '';

      // Prevent duplicate identical time slots on the same day
      const existingSameSlot = db.prepare(`
        SELECT id, subject FROM study_sessions
        WHERE date = ? AND start_time = ? AND end_time = ?
      `).get(date, start_time, end_time);

      if (existingSameSlot) {
        writeAuditLog('SESSION_DUPLICATE_BLOCKED', {
          source: source || 'unknown',
          date,
          start_time,
          end_time,
          subject: cleanSubject,
          existing_id: existingSameSlot.id
        });
        return res.status(409).json({
          error: `A study session for ${start_time} – ${end_time} is already logged for ${date}.`
        });
      }

      const stmt = db.prepare(`
        INSERT INTO study_sessions (date, start_time, end_time, duration_minutes, subject, notes)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      const result = stmt.run(date, start_time, end_time, durationMinutes, cleanSubject, cleanNotes);

      const created = db.prepare('SELECT * FROM study_sessions WHERE id = ?').get(result.lastInsertRowid);
      writeAuditLog('SESSION_CREATED', {
        source: source || 'unknown',
        elapsed_seconds,
        session: created
      });
      res.status(201).json(created);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // PUT update an existing study session
  app.put('/api/sessions/:id', (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const { date, start_time, end_time, subject, notes } = req.body;

      if (!date || !start_time || !end_time) {
        return res.status(400).json({ error: 'Date, start time, and end time are required.' });
      }

      const durationMinutes = calculateDurationMinutes(start_time, end_time);
      if (durationMinutes === null || durationMinutes <= 0) {
        return res.status(400).json({ error: 'Invalid start or end time format (use HH:MM).' });
      }

      const cleanSubject = (subject && subject.trim()) ? subject.trim() : 'General Study';
      const cleanNotes = (notes && notes.trim()) ? notes.trim() : '';

      const stmt = db.prepare(`
        UPDATE study_sessions
        SET date = ?, start_time = ?, end_time = ?, duration_minutes = ?, subject = ?, notes = ?
        WHERE id = ?
      `);
      const result = stmt.run(date, start_time, end_time, durationMinutes, cleanSubject, cleanNotes, id);

      if (result.changes === 0) {
        return res.status(404).json({ error: 'Study session not found.' });
      }

      const updated = db.prepare('SELECT * FROM study_sessions WHERE id = ?').get(id);
      writeAuditLog('SESSION_UPDATED', { id, session: updated });
      res.json(updated);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE a study session
  app.delete('/api/sessions/:id', (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const existing = db.prepare('SELECT * FROM study_sessions WHERE id = ?').get(id);
      const result = db.prepare('DELETE FROM study_sessions WHERE id = ?').run(id);
      if (result.changes === 0) {
        return res.status(404).json({ error: 'Study session not found.' });
      }
      writeAuditLog('SESSION_DELETED', { id, deleted_session: existing });
      res.json({ success: true, id });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // PUT save or update End-of-Day Pending & Extra Hours for a date
  app.put('/api/daily-log/:date', (req, res) => {
    try {
      const { date } = req.params;
      const { pending_minutes, extra_minutes, daily_note } = req.body;

      const pendingMins = Math.max(0, Math.round(Number(pending_minutes) || 0));
      const extraMins = Math.max(0, Math.round(Number(extra_minutes) || 0));
      const note = (daily_note && typeof daily_note === 'string') ? daily_note.trim() : '';

      db.prepare(`
        INSERT INTO daily_logs (date, pending_minutes, extra_minutes, daily_note, updated_at)
        VALUES (?, ?, ?, ?, datetime('now', 'localtime'))
        ON CONFLICT(date) DO UPDATE SET
          pending_minutes = excluded.pending_minutes,
          extra_minutes = excluded.extra_minutes,
          daily_note = excluded.daily_note,
          updated_at = datetime('now', 'localtime')
      `).run(date, pendingMins, extraMins, note);

      const saved = db.prepare('SELECT * FROM daily_logs WHERE date = ?').get(date);
      writeAuditLog('DAILY_LOG_SAVED', {
        date,
        pending_minutes: pendingMins,
        extra_minutes: extraMins,
        net_pool_change_minutes: pendingMins - extraMins,
        daily_note: note
      });
      res.json(saved);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET comprehensive report across a date range (or all time)
  app.get('/api/report', (req, res) => {
    try {
      const { startDate, endDate } = req.query;

      const { allTimePoolMinutes, getRunningPoolUpTo } = getPoolStats();

      let sessionQuery = 'SELECT * FROM study_sessions WHERE 1=1';
      let logQuery = 'SELECT * FROM daily_logs WHERE 1=1';
      const sessionParams = [];
      const logParams = [];

      if (startDate) {
        sessionQuery += ' AND date >= ?';
        logQuery += ' AND date >= ?';
        sessionParams.push(startDate);
        logParams.push(startDate);
      }
      if (endDate) {
        sessionQuery += ' AND date <= ?';
        logQuery += ' AND date <= ?';
        sessionParams.push(endDate);
        logParams.push(endDate);
      }

      sessionQuery += ' ORDER BY date DESC, start_time ASC';
      logQuery += ' ORDER BY date DESC';

      const sessions = db.prepare(sessionQuery).all(...sessionParams);
      const dailyLogs = db.prepare(logQuery).all(...logParams);

      // Group by date
      const dateSet = new Set();
      const sessionsByDate = new Map();
      const logsByDate = new Map();

      for (const s of sessions) {
        dateSet.add(s.date);
        if (!sessionsByDate.has(s.date)) {
          sessionsByDate.set(s.date, []);
        }
        sessionsByDate.get(s.date).push(s);
      }

      for (const l of dailyLogs) {
        dateSet.add(l.date);
        logsByDate.set(l.date, l);
      }

      // Sort dates descending (newest first)
      const sortedDates = Array.from(dateSet).sort((a, b) => b.localeCompare(a));

      const days = sortedDates.map(d =>
        buildDaySummary(
          d,
          sessionsByDate.get(d) || [],
          logsByDate.get(d) || null,
          getRunningPoolUpTo(d),
          allTimePoolMinutes
        )
      );

      // Compute overall totals
      let totalStudiedMinutes = 0;
      let totalPendingMinutes = 0;
      let totalExtraMinutes = 0;
      let totalBreakMinutes = 0;
      let totalSessions = 0;
      const subjectMap = new Map();

      for (const day of days) {
        totalStudiedMinutes += day.total_studied_minutes;
        totalPendingMinutes += day.pending_minutes;
        totalExtraMinutes += day.extra_minutes;
        totalBreakMinutes += day.total_break_minutes;
        totalSessions += day.session_count;

        for (const s of day.sessions) {
          const subj = s.subject || 'General Study';
          if (!subjectMap.has(subj)) {
            subjectMap.set(subj, { subject: subj, total_minutes: 0, session_count: 0 });
          }
          const entry = subjectMap.get(subj);
          entry.total_minutes += s.duration_minutes;
          entry.session_count += 1;
        }
      }

      const subjects = Array.from(subjectMap.values()).sort((a, b) => b.total_minutes - a.total_minutes);

      res.json({
        days,
        totals: {
          total_days_logged: days.length,
          total_sessions: totalSessions,
          total_studied_minutes: totalStudiedMinutes,
          total_pending_minutes: totalPendingMinutes,
          total_extra_minutes: totalExtraMinutes,
          net_pool_minutes: totalPendingMinutes - totalExtraMinutes,
          all_time_pending_pool_minutes: allTimePoolMinutes,
          total_break_minutes: totalBreakMinutes,
          average_studied_minutes_per_day: days.length > 0 ? Math.round(totalStudiedMinutes / days.length) : 0,
          average_pending_minutes_per_day: days.length > 0 ? Math.round(totalPendingMinutes / days.length) : 0,
          average_extra_minutes_per_day: days.length > 0 ? Math.round(totalExtraMinutes / days.length) : 0
        },
        subjects
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET export full database as JSON backup (includes diagnostic activity logs)
  app.get('/api/export/json', (req, res) => {
    try {
      const sessions = db.prepare('SELECT * FROM study_sessions ORDER BY date DESC, start_time ASC').all();
      const dailyLogs = db.prepare('SELECT * FROM daily_logs ORDER BY date DESC').all();
      const { allTimePoolMinutes } = getPoolStats();
      let activityLogs = [];
      if (fs.existsSync(LOG_PATH)) {
        const rawLines = fs.readFileSync(LOG_PATH, 'utf8').trim().split('\n').filter(Boolean);
        activityLogs = rawLines.slice(-500).map(line => {
          try { return JSON.parse(line); } catch (e) { return { raw: line }; }
        });
      }
      const payload = {
        exported_at: new Date().toISOString(),
        version: '1.2',
        pending_pool_minutes: allTimePoolMinutes,
        study_sessions: sessions,
        daily_logs: dailyLogs,
        activity_logs: activityLogs
      };
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="study-tracker-backup-${new Date().toISOString().slice(0, 10)}.json"`);
      res.send(JSON.stringify(payload, null, 2));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST import/restore from JSON backup
  app.post('/api/import/json', (req, res) => {
    try {
      const { study_sessions, daily_logs } = req.body;
      if (!Array.isArray(study_sessions) && !Array.isArray(daily_logs)) {
        return res.status(400).json({ error: 'Invalid backup file format.' });
      }

      let importedSessions = 0;
      let importedLogs = 0;

      if (Array.isArray(study_sessions)) {
        const checkStmt = db.prepare(`
          SELECT id FROM study_sessions
          WHERE date = ? AND start_time = ? AND end_time = ? AND subject = ?
        `);
        const insertStmt = db.prepare(`
          INSERT INTO study_sessions (date, start_time, end_time, duration_minutes, subject, notes)
          VALUES (?, ?, ?, ?, ?, ?)
        `);

        for (const s of study_sessions) {
          if (!s.date || !s.start_time || !s.end_time) continue;
          const dur = calculateDurationMinutes(s.start_time, s.end_time);
          if (!dur) continue;
          const subj = s.subject || 'General Study';
          const existing = checkStmt.get(s.date, s.start_time, s.end_time, subj);
          if (!existing) {
            insertStmt.run(s.date, s.start_time, s.end_time, dur, subj, s.notes || '');
            importedSessions++;
          }
        }
      }

      if (Array.isArray(daily_logs)) {
        const upsertLog = db.prepare(`
          INSERT INTO daily_logs (date, pending_minutes, extra_minutes, daily_note, updated_at)
          VALUES (?, ?, ?, ?, datetime('now', 'localtime'))
          ON CONFLICT(date) DO UPDATE SET
            pending_minutes = excluded.pending_minutes,
            extra_minutes = excluded.extra_minutes,
            daily_note = excluded.daily_note,
            updated_at = datetime('now', 'localtime')
        `);
        for (const l of daily_logs) {
          if (!l.date) continue;
          upsertLog.run(
            l.date,
            Math.max(0, Math.round(Number(l.pending_minutes) || 0)),
            Math.max(0, Math.round(Number(l.extra_minutes) || 0)),
            l.daily_note || ''
          );
          importedLogs++;
        }
      }

      res.json({
        success: true,
        imported_sessions: importedSessions,
        imported_logs: importedLogs
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET export CSV report
  app.get('/api/export/csv', (req, res) => {
    try {
      const sessions = db.prepare('SELECT * FROM study_sessions ORDER BY date DESC, start_time ASC').all();
      const dailyLogs = db.prepare('SELECT * FROM daily_logs ORDER BY date DESC').all();
      const { allTimePoolMinutes, getRunningPoolUpTo } = getPoolStats();

      const dateSet = new Set();
      const sessionsByDate = new Map();
      const logsByDate = new Map();

      for (const s of sessions) {
        dateSet.add(s.date);
        if (!sessionsByDate.has(s.date)) sessionsByDate.set(s.date, []);
        sessionsByDate.get(s.date).push(s);
      }
      for (const l of dailyLogs) {
        dateSet.add(l.date);
        logsByDate.set(l.date, l);
      }

      const sortedDates = Array.from(dateSet).sort((a, b) => b.localeCompare(a));

      const escapeCsv = (val) => {
        const str = String(val ?? '');
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      };

      const formatHrsMins = (mins) => {
        const n = Math.max(0, Math.round(Number(mins) || 0));
        const h = Math.floor(n / 60);
        const m = n % 60;
        return `${h}h ${m}m (${(n / 60).toFixed(2)} hrs)`;
      };

      const formatSignedHrsMins = (mins) => {
        const n = Math.round(Number(mins) || 0);
        const sign = n < 0 ? '-' : '';
        const abs = Math.abs(n);
        const h = Math.floor(abs / 60);
        const m = abs % 60;
        return `${sign}${h}h ${m}m (${(n / 60).toFixed(2)} hrs)`;
      };

      const lines = [
        [
          'Date',
          'Session Start',
          'Session End',
          'Session Duration (Mins)',
          'Session Duration (Formatted)',
          'Subject / Topic',
          'Session Notes',
          'Daily Total Studied',
          'Daily End-of-Day Pending Time',
          'Daily End-of-Day Extra Time',
          'Daily Net Pool Change',
          'Running Pending Pool Balance',
          'End-of-Day Note'
        ].join(',')
      ];

      for (const d of sortedDates) {
        const daySummary = buildDaySummary(
          d,
          sessionsByDate.get(d) || [],
          logsByDate.get(d) || null,
          getRunningPoolUpTo(d),
          allTimePoolMinutes
        );
        if (daySummary.sessions.length === 0) {
          lines.push([
            escapeCsv(d),
            escapeCsv('-'),
            escapeCsv('-'),
            0,
            escapeCsv('0h 0m'),
            escapeCsv('-'),
            escapeCsv('No study sessions logged'),
            escapeCsv(formatHrsMins(daySummary.total_studied_minutes)),
            escapeCsv(formatHrsMins(daySummary.pending_minutes)),
            escapeCsv(formatHrsMins(daySummary.extra_minutes)),
            escapeCsv(formatSignedHrsMins(daySummary.net_pool_change_minutes)),
            escapeCsv(formatSignedHrsMins(daySummary.running_pool_minutes)),
            escapeCsv(daySummary.daily_note)
          ].join(','));
        } else {
          for (const s of daySummary.sessions) {
            lines.push([
              escapeCsv(d),
              escapeCsv(s.start_time),
              escapeCsv(s.end_time),
              s.duration_minutes,
              escapeCsv(formatHrsMins(s.duration_minutes)),
              escapeCsv(s.subject),
              escapeCsv(s.notes),
              escapeCsv(formatHrsMins(daySummary.total_studied_minutes)),
              escapeCsv(formatHrsMins(daySummary.pending_minutes)),
              escapeCsv(formatHrsMins(daySummary.extra_minutes)),
              escapeCsv(formatSignedHrsMins(daySummary.net_pool_change_minutes)),
              escapeCsv(formatSignedHrsMins(daySummary.running_pool_minutes)),
              escapeCsv(daySummary.daily_note)
            ].join(','));
          }
        }
      }

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="study-time-report-${new Date().toISOString().slice(0, 10)}.csv"`);
      res.send(lines.join('\r\n'));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return new Promise((resolve, reject) => {
    const server = app.listen(requestedPort, '127.0.0.1', () => {
      const actualPort = server.address().port;
      console.log(`Student Study Time Tracker running at http://localhost:${actualPort}`);
      console.log(`Permanent SQLite database stored at: ${DB_PATH}`);
      resolve({ server, port: actualPort, dbPath: DB_PATH, db });
    });

    server.on('error', (err) => {
      reject(err);
    });
  });
}

if (require.main === module) {
  startServer().catch(err => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}

module.exports = { startServer };
