/* ═══════════════════════════════════════════════════════
   app.js — Main App Controller
   Manages screen routing and session state.
   Loaded last — depends on simulation.js, hazardMap.js, dashboard.js
   ═══════════════════════════════════════════════════════ */

var App = (function () {

  var currentScreen = 'landing';
  var sessions = [];

  // Load persisted sessions from localStorage
  (function loadSessions() {
    try {
      var stored = localStorage.getItem('climateshield_sessions');
      if (stored) sessions = JSON.parse(stored);
    } catch (e) { sessions = []; }
  })();

  function saveSessions() {
    try { localStorage.setItem('climateshield_sessions', JSON.stringify(sessions)); } catch (e) {}
  }

  // ─── Screen Management ────────────────────────────────
  function show(name) {
    var screens = document.querySelectorAll('.screen');
    screens.forEach(function (s) { s.classList.remove('active'); });

    var target = document.getElementById('screen-' + name);
    if (!target) return;
    target.classList.add('active');
    currentScreen = name;

    // Lazy-init screens on first visit
    if (name === 'simulation') {
      Simulation.init();
    } else if (name === 'hazardmap') {
      setTimeout(function () { HazardMap.init(); }, 50); // let DOM render
    } else if (name === 'dashboard') {
      Dashboard.render(sessions);
    }

    // Scroll to top
    target.scrollTop = 0;
  }

  // ─── Session Management ───────────────────────────────
  function saveSession(result) {
    sessions.push(result);
    saveSessions();
  }

  function getSessions() {
    return sessions;
  }

  function clearSessions() {
    if (confirm('Clear all session history? This cannot be undone.')) {
      sessions = [];
      saveSessions();
      Dashboard.render(sessions);
    }
  }

  function deleteSession(index) {
    if (index < 0 || index >= sessions.length) return;
    if (confirm('Delete this attempt? This cannot be undone.')) {
      sessions.splice(index, 1);
      saveSessions();
      Dashboard.render(sessions);
    }
  }

  // ─── Landing page scenario chips ─────────────────────
  document.querySelectorAll('.scenario-chip').forEach(function (chip) {
    chip.addEventListener('click', function () {
      document.querySelectorAll('.scenario-chip').forEach(function (c) { c.classList.remove('active'); });
      chip.classList.add('active');
    });
  });

  // ─── Keyboard shortcut: Escape goes back ─────────────
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && currentScreen === 'simulation') {
      // Handled by PointerLock — don't navigate away
    }
  });

  // ─── Public API ───────────────────────────────────────
  return {
    show: show,
    saveSession: saveSession,
    getSessions: getSessions,
    clearSessions: clearSessions,
    deleteSession: deleteSession,
    get currentScreen() { return currentScreen; }
  };

})();
