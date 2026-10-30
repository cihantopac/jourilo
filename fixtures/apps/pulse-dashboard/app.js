// Pulse: a small client-rendered analytics dashboard used as a Jourilo fixture. History API routing, a fake
// session in localStorage (test account only), two products (Analytics, Billing).
(function () {
  var TEST_ACCOUNT = { email: 'demo@example.test', password: 'demo-password' };
  var app = document.getElementById('app');
  var signedIn = function () { return localStorage.getItem('pulse-session') === 'demo'; };
  var go = function (path) { history.pushState({}, '', path); render(); };
  document.addEventListener('click', function (e) {
    var a = e.target.closest('a[data-link]');
    if (a) { e.preventDefault(); go(a.getAttribute('href')); }
  });
  window.addEventListener('popstate', render);

  function header() {
    return '<header><strong>Pulse</strong><nav aria-label="Products">' +
      '<a data-link href="/analytics">Analytics</a> <a data-link href="/billing">Billing</a> <a data-link href="/settings">Settings</a>' +
      '</nav></header>';
  }
  function helpbar() { return '<div class="helpbar" role="complementary" aria-label="Help">Need help? Our team replies within a day. <a href="#chat" style="color:#fff">Open chat</a></div>'; }

  var views = {
    '/login': function () {
      return '<main><h1>Sign in to Pulse</h1><form id="login"><label for="email">Email</label><input id="email" name="email" type="email" autocomplete="username">' +
        '<label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password">' +
        '<p id="login-error" role="alert"></p><p><button class="btn" type="submit">Sign in</button></p></form></main>';
    },
    '/analytics': function () {
      var rows = '';
      for (var i = 1; i <= 14; i++) rows += '<div class="row"><span>Report ' + i + '</span><a data-link href="/analytics/report-' + i + '">Open report ' + i + '</a></div>';
      return header() + '<main><h1>Analytics overview</h1>' +
        '<p><button class="btn" id="refresh" type="button">Refresh data</button> <span id="updated" role="status"></span></p>' +
        // Seeded defect: a custom range picker that traps Tab between its two buttons (WCAG 2.1.2).
        '<div class="range" id="range"><button type="button">Last 7 days</button><button type="button">Last 30 days</button></div>' +
        rows + '</main>' + helpbar();
    },
    '/billing': function () {
      return header() + '<main><h1>Billing</h1><p>Plan: Team, $49 per month.</p><p><a data-link href="/settings">Manage plan</a></p></main>' + helpbar();
    },
    '/settings': function () {
      return header() + '<main><h1>Settings</h1><form id="profile"><label for="name">Display name</label><input id="name" name="name" autocomplete="name" value="Demo">' +
        '<p><button class="btn" type="submit">Save</button></p></form></main>' + helpbar();
    },
  };

  function render() {
    var path = location.pathname.replace(/\/$/, '') || '/';
    if (!signedIn() && path !== '/login') { history.replaceState({}, '', '/login'); path = '/login'; }
    if (signedIn() && (path === '/' || path === '/login')) { history.replaceState({}, '', '/analytics'); path = '/analytics'; }
    var view = views[path] || (path.indexOf('/analytics/') === 0 ? function () { return header() + '<main><h1>' + path.slice(11).replace('-', ' ') + '</h1></main>' + helpbar(); } : null);
    app.innerHTML = view ? view() : header() + '<main><h1>Not found</h1></main>';
    document.title = (document.querySelector('h1') || {}).textContent + ' – Pulse';
    wire();
  }

  function wire() {
    var login = document.getElementById('login');
    if (login) login.addEventListener('submit', function (e) {
      e.preventDefault();
      var ok = login.email.value === TEST_ACCOUNT.email && login.password.value === TEST_ACCOUNT.password;
      if (!ok) { document.getElementById('login-error').textContent = 'Email or password is incorrect.'; return; }
      localStorage.setItem('pulse-session', 'demo');
      go('/analytics');
    });
    var refresh = document.getElementById('refresh');
    // Seeded defect: the click handler blocks the main thread for ~650 ms (slow INP).
    if (refresh) refresh.addEventListener('click', function () {
      var end = performance.now() + 650; while (performance.now() < end) { /* busy */ }
      document.getElementById('updated').textContent = 'Updated just now';
    });
    var range = document.getElementById('range');
    if (range) range.addEventListener('keydown', function (e) {
      if (e.key !== 'Tab') return;
      e.preventDefault();
      var b = range.querySelectorAll('button');
      (document.activeElement === b[0] ? b[1] : b[0]).focus();
    });
  }
  render();
})();
