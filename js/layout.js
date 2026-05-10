// Builds the sidebar and topbar for authenticated pages
function buildLayout(activeNav, pageTitle, pageSubtitle = '') {
  requireAuth();
  const user = getCurrentUser();

  const navItems = [
    { id: 'dashboard', href: '/dashboard.html', icon: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/></svg>`, label: 'Dashboard' },
    { id: 'medicines', href: '/medicines.html', icon: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>`, label: 'Medicines' },
    { id: 'reminders', href: '/reminders.html', icon: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>`, label: 'Reminders' },
    { id: 'family', href: '/family.html', icon: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`, label: 'Family' },
    { id: 'logs', href: '/logs.html', icon: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M7 13l3 3 7-7"/></svg>`, label: 'Activity Logs' },
    { id: 'pharmacy', href: '/pharmacy.html', icon: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`, label: 'Pharmacy' },
    { id: 'settings', href: '/settings.html', icon: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.09a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c0 .67.39 1.27 1 1.51H21a2 2 0 1 1 0 4h-.09c-.67 0-1.27.39-1.51 1z"/></svg>`, label: 'Settings' },
  ];

  const navHtml = navItems.map(item => `
    <a href="${item.href}" class="nav-item ${activeNav === item.id ? 'active' : ''}">
      ${item.icon}
      <span>${item.label}</span>
    </a>
  `).join('');

  const sidebarHtml = `
    <aside class="sidebar" id="sidebar">
      <div class="sidebar-logo">
        <img src="assets/Square_LOGO.jpeg" alt="Sevra AI" style="height:40px;border-radius:8px;">
      </div>
      <nav class="sidebar-nav">
        <div class="nav-label">Main Menu</div>
        ${navHtml}
      </nav>
      <div class="sidebar-footer">
        <div class="user-card" onclick="window.location.href='settings.html'">
          <div class="user-avatar">${initials(user?.name || 'U')}</div>
          <div class="user-info">
            <div class="name">${user?.name || 'User'}</div>
            <div class="role">${user?.role || 'admin'}</div>
          </div>
        </div>
        <button class="btn btn-ghost btn-sm" style="width:100%;margin-top:8px;justify-content:flex-start;gap:8px;" onclick="logout()">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
          Sign Out
        </button>
      </div>
    </aside>
    <div class="sidebar-overlay" id="sidebarOverlay" onclick="closeSidebar()"></div>
  `;

  const topbarHtml = `
    <header class="topbar">
      <div style="display:flex;align-items:center;gap:16px;">
        <button class="menu-toggle" onclick="toggleSidebar()">
          <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
        </button>
        <div>
          <div class="topbar-title">${pageTitle}</div>
          ${pageSubtitle ? `<div class="topbar-subtitle">${pageSubtitle}</div>` : ''}
        </div>
      </div>
      <div class="topbar-actions" id="topbarActions"></div>
    </header>
  `;

  // Inject into page
  const layout = document.getElementById('app-layout');
  if (layout) {
    layout.innerHTML = sidebarHtml + `
      <div class="main-content">
        ${topbarHtml}
        <div class="page-body" id="pageBody"></div>
      </div>
    `;
  }
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('sidebarOverlay').classList.toggle('open');
}

function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebarOverlay').classList.remove('open');
}

function logout() {
  localStorage.removeItem('mycare_token');
  localStorage.removeItem('mycare_user');
  window.location.href = 'login.html';
}

// Refresh user from server and update localStorage
async function refreshUser() {
  const res = await api.get('/auth/me');
  if (res && res.ok) {
    localStorage.setItem('mycare_user', JSON.stringify(res.data.user));
    return res.data.user;
  }
  return getCurrentUser();
}
