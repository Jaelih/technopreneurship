/* ═══════════════════════════════════════════════════════
   dashboard.js — Instructor Dashboard
   Uses global Chart from CDN (Chart.js 4.x)
   ═══════════════════════════════════════════════════════ */

var Dashboard = (function () {

  var chartScores = null;
  var chartDecisions = null;

  // ─── Render ───────────────────────────────────────────
  function render(sessions) {
    renderStats(sessions);
    renderCharts(sessions);
    renderTable(sessions);
    if (sessions.length > 0) {
      renderDecisionBreakdown(sessions[sessions.length - 1]);
    }
  }

  function renderStats(sessions) {
    var total = sessions.length;
    document.getElementById('dash-total').textContent = total;

    if (total === 0) {
      ['dash-avg', 'dash-best', 'dash-pass', 'dash-correct'].forEach(function (id) {
        document.getElementById(id).textContent = '—';
      });
      return;
    }

    var scores = sessions.map(function (s) { return s.score; });
    var avg = Math.round(scores.reduce(function (a, b) { return a + b; }, 0) / total);
    var best = Math.max.apply(null, scores);
    var passed = sessions.filter(function (s) { return s.score >= 75; }).length;
    var passRate = Math.round((passed / total) * 100) + '%';

    var totalDecisions = sessions.reduce(function (sum, s) { return sum + s.decisions.length; }, 0);
    var correctDecisions = sessions.reduce(function (sum, s) {
      return sum + s.decisions.filter(function (d) { return d.correct; }).length;
    }, 0);
    var correctPct = totalDecisions > 0 ? Math.round((correctDecisions / totalDecisions) * 100) + '%' : '—';

    document.getElementById('dash-avg').textContent = avg;
    document.getElementById('dash-best').textContent = best;
    document.getElementById('dash-pass').textContent = passRate;
    document.getElementById('dash-correct').textContent = correctPct;
  }

  function renderCharts(sessions) {
    var chartDefaults = {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: { labels: { color: '#8b949e', font: { size: 12 } } }
      },
      scales: {
        x: { ticks: { color: '#8b949e' }, grid: { color: 'rgba(48,54,61,0.6)' } },
        y: { ticks: { color: '#8b949e' }, grid: { color: 'rgba(48,54,61,0.6)' } }
      }
    };

    // Score history line chart
    var scoreCtx = document.getElementById('chart-scores').getContext('2d');
    if (chartScores) chartScores.destroy();

    var labels, scoreData, maxData;
    if (sessions.length === 0) {
      labels = ['No data yet'];
      scoreData = [0];
      maxData = [100];
    } else {
      labels = sessions.map(function (s, i) {
        var d = new Date(s.date);
        return 'S' + (i + 1) + ' (' + d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }) + ')';
      });
      scoreData = sessions.map(function (s) { return s.score; });
      maxData = sessions.map(function (s) { return s.maxScore; });
    }

    chartScores = new Chart(scoreCtx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Score',
            data: scoreData,
            borderColor: '#1d8cf8',
            backgroundColor: 'rgba(29,140,248,0.15)',
            borderWidth: 2.5,
            pointBackgroundColor: '#1d8cf8',
            pointRadius: 5,
            tension: 0.35,
            fill: true
          },
          {
            label: 'Max Score',
            data: maxData,
            borderColor: 'rgba(0,212,170,0.4)',
            borderWidth: 1.5,
            borderDash: [6, 4],
            pointRadius: 0,
            fill: false
          }
        ]
      },
      options: Object.assign({}, chartDefaults, {
        scales: Object.assign({}, chartDefaults.scales, {
          y: Object.assign({}, chartDefaults.scales.y, { min: 0, max: 100 })
        })
      })
    });

    // Decision accuracy donut chart
    var decCtx = document.getElementById('chart-decisions').getContext('2d');
    if (chartDecisions) chartDecisions.destroy();

    var correct = 0, wrong = 0;
    sessions.forEach(function (s) {
      s.decisions.forEach(function (d) {
        if (d.correct) correct++; else wrong++;
      });
    });

    chartDecisions = new Chart(decCtx, {
      type: 'doughnut',
      data: {
        labels: ['Correct', 'Incorrect'],
        datasets: [{
          data: correct + wrong === 0 ? [1, 0] : [correct, wrong],
          backgroundColor: ['rgba(39,174,96,0.85)', 'rgba(231,76,60,0.85)'],
          borderColor: ['#27ae60', '#e74c3c'],
          borderWidth: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        cutout: '68%',
        plugins: {
          legend: { position: 'bottom', labels: { color: '#8b949e', padding: 12, font: { size: 12 } } }
        }
      }
    });
  }

  function renderTable(sessions) {
    var table = document.getElementById('sessions-table');
    var tbody = document.getElementById('sessions-tbody');
    var empty = document.getElementById('empty-state');

    if (sessions.length === 0) {
      table.classList.add('hidden');
      empty.style.display = '';
      return;
    }

    empty.style.display = 'none';
    table.classList.remove('hidden');
    tbody.innerHTML = '';

    sessions.slice().reverse().forEach(function (s, i) {
      var realIndex = sessions.length - i;
      var sessionIdx = realIndex - 1;
      var d = new Date(s.date);
      var dateStr = d.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
      var timeStr = d.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' });
      var dur = formatDuration(s.duration);
      var pct = Math.round((s.score / s.maxScore) * 100);
      var passed = pct >= 75;
      var survived = s.survived;
      var correctCount = s.decisions.filter(function (d) { return d.correct; }).length;

      var tr = document.createElement('tr');
      tr.innerHTML =
        '<td><strong>#' + realIndex + '</strong></td>' +
        '<td>' + dateStr + ' ' + timeStr + '</td>' +
        '<td>' + dur + '</td>' +
        '<td><strong style="color:' + scoreColor(pct) + '">' + s.score + '</strong> <small style="color:#8b949e">/ ' + s.maxScore + '</small></td>' +
        '<td>' + (survived ? '<span class="pill pill-success">✓ Yes</span>' : '<span class="pill pill-danger">✗ No</span>') + '</td>' +
        '<td>' + correctCount + ' / ' + s.decisions.length + ' correct</td>' +
        '<td>' + (passed ? '<span class="pill pill-success">PASSED</span>' : '<span class="pill pill-danger">FAILED</span>') + '</td>' +
        '<td><button class="btn-delete-row" data-idx="' + sessionIdx + '" title="Delete this attempt" aria-label="Delete attempt #' + realIndex + '">✕</button></td>';
      tbody.appendChild(tr);
    });

    tbody.querySelectorAll('.btn-delete-row').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var idx = parseInt(btn.getAttribute('data-idx'), 10);
        if (!isNaN(idx) && window.App) App.deleteSession(idx);
      });
    });
  }

  function renderDecisionBreakdown(session) {
    var el = document.getElementById('decision-breakdown');
    if (!session || session.decisions.length === 0) {
      el.innerHTML = '<p class="empty-state">Complete a simulation to see decision analysis.</p>';
      return;
    }

    el.innerHTML = '';
    session.decisions.forEach(function (d) {
      var item = document.createElement('div');
      item.className = 'db-item ' + (d.correct ? 'correct' : 'wrong');
      item.innerHTML =
        '<div class="db-icon">' + (d.correct ? '✅' : '❌') + '</div>' +
        '<div class="db-content">' +
          '<div class="db-q">' + stripEmoji(d.question) + '</div>' +
          '<div class="db-choice">Choice: <em>' + d.choice + '</em></div>' +
          '<div class="db-choice" style="margin-top:4px;font-size:11px;">' + d.feedback + '</div>' +
          '<div class="db-choice" style="margin-top:4px;color:#6b7280;">Response at: T+' + Math.round(d.time) + 's | Flood: ' + (d.floodLevel * 100).toFixed(0) + ' cm' + (d.rushed ? ' | ⚡ Rushed' : '') + '</div>' +
        '</div>' +
        '<div class="db-points ' + (d.correct ? 'pos' : 'neg') + '">+' + d.points + 'pts</div>';
      el.appendChild(item);
    });

    // Summary row
    var total = session.decisions.reduce(function (s, d) { return s + d.points; }, 0);
    var max = session.maxScore;
    var summary = document.createElement('div');
    summary.style.cssText = 'text-align:right;padding:10px 0;font-size:14px;font-weight:700;color:#e6edf3;border-top:1px solid #30363d;margin-top:8px;';
    summary.textContent = 'Total: ' + total + ' / ' + max + ' points (' + Math.round(total / max * 100) + '%)';
    el.appendChild(summary);
  }

  // ─── Export CSV ───────────────────────────────────────
  function exportCSV() {
    var sessions = window.App ? App.getSessions() : [];
    if (sessions.length === 0) {
      alert('No sessions to export yet. Complete at least one simulation first.');
      return;
    }

    var rows = [['#', 'Date', 'Duration (s)', 'Score', 'Max Score', '% Score', 'Survived', 'Decisions', 'Correct Decisions', 'Passed']];
    sessions.forEach(function (s, i) {
      var correct = s.decisions.filter(function (d) { return d.correct; }).length;
      var pct = Math.round((s.score / s.maxScore) * 100);
      rows.push([
        i + 1,
        new Date(s.date).toLocaleString('en-PH'),
        Math.round(s.duration),
        s.score,
        s.maxScore,
        pct + '%',
        s.survived ? 'Yes' : 'No',
        s.decisions.length,
        correct,
        pct >= 75 ? 'Pass' : 'Fail'
      ]);
    });

    var csv = rows.map(function (r) { return r.map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(','); }).join('\n');
    var blob = new Blob([csv], { type: 'text/csv' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'climateshield-sessions-' + new Date().toISOString().split('T')[0] + '.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  // ─── Helpers ──────────────────────────────────────────
  function formatDuration(secs) {
    if (!secs) return '—';
    var m = Math.floor(secs / 60);
    var s = Math.floor(secs % 60);
    return (m > 0 ? m + 'm ' : '') + s + 's';
  }

  function scoreColor(pct) {
    if (pct >= 75) return '#27ae60';
    if (pct >= 50) return '#f39c12';
    return '#e74c3c';
  }

  function stripEmoji(str) {
    return str.replace(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu, '').trim();
  }

  // ─── Public API ───────────────────────────────────────
  return {
    render: render,
    exportCSV: exportCSV
  };

})();
