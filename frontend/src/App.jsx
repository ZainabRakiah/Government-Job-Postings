import { useState, useEffect, useCallback } from 'react';
import './App.css';

const PORTAL_MAPPING = {
  'upsc-recruitment': 'UPSC',
  'upsc-active-exams': 'UPSC',
  'ssc-notices': 'SSC',
  'ibps-recruitment': 'IBPS',
  'ncs-government-jobs': 'NCS',
  'employment-news': 'Employment News',
};

const PORTAL_FULL_NAMES = {
  'UPSC': 'Union Public Service Commission',
  'SSC': 'Staff Selection Commission',
  'IBPS': 'Institute of Banking Personnel Selection',
  'NCS': 'National Career Service',
  'Employment News': 'Employment News — Ministry of I&B'
};

const PORTAL_LOGOS = {
  'UPSC': '🏛️',
  'SSC': '📝',
  'IBPS': '🏦',
  'NCS': '💼',
  'Employment News': '📰'
};

function App() {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedJob, setSelectedJob] = useState(null);
  const [alertEnabled, setAlertEnabled] = useState(true);
  const [emailDigest, setEmailDigest] = useState('Daily');

  const API_BASE = 'http://localhost:5000/api';

  // Fetch jobs
  const fetchJobs = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch a larger limit to group them by portal on the dashboard
      const res = await fetch(`${API_BASE}/jobs?limit=100`);
      const data = await res.json();
      if (data && data.data) {
        setJobs(data.data);
      }
    } catch (err) {
      console.error('Error fetching jobs:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Check backend sync status
  const checkSyncStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/jobs/sync/status`);
      const data = await res.json();
      setSyncing(data.syncInProgress);
      return data.syncInProgress;
    } catch (err) {
      console.error('Error checking sync status:', err);
      return false;
    }
  }, []);

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  // Poll sync status if syncing
  useEffect(() => {
    let intervalId;
    if (syncing) {
      intervalId = setInterval(async () => {
        const stillSyncing = await checkSyncStatus();
        if (!stillSyncing) {
          clearInterval(intervalId);
          fetchJobs();
        }
      }, 5000);
    }
    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [syncing, checkSyncStatus, fetchJobs]);

  // Check sync status on mount
  useEffect(() => {
    checkSyncStatus();
  }, [checkSyncStatus]);

  // Trigger sync
  const triggerSync = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      const res = await fetch(`${API_BASE}/jobs/sync`, { method: 'POST' });
      if (res.ok) {
        console.log('Sync started successfully');
      } else {
        setSyncing(false);
      }
    } catch (err) {
      console.error('Error triggering sync:', err);
      setSyncing(false);
    }
  };

  // Client-side filtering logic
  const filteredJobs = jobs.filter(job => {
    const query = searchQuery.toLowerCase();
    return (
      job.shortTitle.toLowerCase().includes(query) ||
      job.department.toLowerCase().includes(query) ||
      (job.qualification && job.qualification.toLowerCase().includes(query)) ||
      (job.jobLocation && job.jobLocation.toLowerCase().includes(query))
    );
  });

  // Group jobs by portal name
  const groupedJobs = filteredJobs.reduce((acc, job) => {
    const portalName = PORTAL_MAPPING[job.sourceSiteId] || 'Others';
    if (!acc[portalName]) {
      acc[portalName] = [];
    }
    acc[portalName].push(job);
    return acc;
  }, {});

  // Scroll function for rows
  const scrollRow = (id, direction) => {
    const container = document.getElementById(id);
    if (container) {
      const amount = 300;
      container.scrollBy({
        left: direction === 'left' ? -amount : amount,
        behavior: 'smooth'
      });
    }
  };

  // Stats calculation
  const newJobsTodayCount = jobs.filter(j => {
    const today = new Date().toDateString();
    return new Date(j.fetchedAt).toDateString() === today;
  }).length;

  const activePortalsCount = new Set(
    jobs.map(j => PORTAL_MAPPING[j.sourceSiteId]).filter(Boolean)
  ).size;

  return (
    <div className="dashboard-wrapper">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="brand-section">
          <div className="brand-logo">💼</div>
          <div className="brand-info">
            <h2>GovtJob Radar</h2>
            <span>AI Job Intelligence</span>
          </div>
        </div>

        {/* Main Nav */}
        <div className="nav-group">
          <ul className="nav-list">
            <li className="nav-item active">
              <div className="nav-item-left">
                <span className="nav-item-icon">📊</span>
                <span>Dashboard</span>
              </div>
            </li>
            <li className="nav-item">
              <div className="nav-item-left">
                <span className="nav-item-icon">💼</span>
                <span>All Jobs</span>
              </div>
              <span className="nav-badge">{jobs.length}</span>
            </li>
          </ul>
        </div>

        {/* Job Portals Filter list */}
        <div className="nav-group">
          <div className="nav-group-title">Job Portals</div>
          <ul className="nav-list">
            {Object.keys(PORTAL_FULL_NAMES).map(key => {
              const count = jobs.filter(j => PORTAL_MAPPING[j.sourceSiteId] === key).length;
              return (
                <li key={key} className="nav-item" onClick={() => setSearchQuery(key)}>
                  <div className="nav-item-left">
                    <span className="nav-item-icon">{PORTAL_LOGOS[key] || '🏢'}</span>
                    <span>{key}</span>
                  </div>
                  <span className="nav-badge">{count}</span>
                </li>
              );
            })}
          </ul>
        </div>

        {/* Preferences Toggle */}
        <div className="nav-group" style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '16px' }}>
          <div className="nav-group-title">Preferences</div>
          <div className="pref-row">
            <span>Job Alerts</span>
            <label className="toggle-switch">
              <input 
                type="checkbox" 
                checked={alertEnabled}
                onChange={(e) => setAlertEnabled(e.target.checked)}
              />
              <span className="slider"></span>
            </label>
          </div>
          <div className="pref-row">
            <span>Email Digest</span>
            <span className="digest-badge" onClick={() => setEmailDigest(d => d === 'Daily' ? 'Weekly' : 'Daily')}>
              {emailDigest} →
            </span>
          </div>
        </div>

        {/* Stay Updated Card */}
        <div className="sidebar-promo-card">
          <h4>Stay Updated 🚀</h4>
          <p>Get instant email alerts for latest government openings.</p>
          <button className="btn-promo">Manage Alerts</button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="main-content">
        {/* Header */}
        <header className="top-header">
          <div className="search-box">
            <span className="search-icon">🔍</span>
            <input 
              type="text" 
              placeholder="Search by job title, keyword, department..." 
              className="header-search-input"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <div className="header-actions">
            <button className="btn-filter" onClick={triggerSync} disabled={syncing}>
              {syncing ? <span className="spinner"></span> : '🔄'}
              <span>{syncing ? 'Syncing...' : 'Sync Database'}</span>
            </button>
            <button className="btn-sort" onClick={() => setSearchQuery('')}>Reset Filters</button>
            <div className="user-avatar">AU</div>
          </div>
        </header>

        {/* Stats Section */}
        <div className="stats-header-row">
          <div className="stats-title">
            Latest Government Job Openings
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: 'var(--color-secondary)' }}></span>
          </div>
          <span className="stats-last-updated">Last updated: Just now</span>
        </div>

        {/* Stats Grid */}
        <section className="stats-grid">
          <div className="stat-card">
            <div className="stat-icon-box new-jobs">💼</div>
            <div className="stat-info">
              <span className="stat-value">{newJobsTodayCount}</span>
              <span className="stat-label">New Jobs Today</span>
              <span className="stat-trend">{newJobsTodayCount > 0 ? '↑ Active today' : 'No new jobs today'}</span>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon-box active-jobs">🗂️</div>
            <div className="stat-info">
              <span className="stat-value">{filteredJobs.length}</span>
              <span className="stat-label">Active Jobs Found</span>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon-box portals">🏛️</div>
            <div className="stat-info">
              <span className="stat-value">{activePortalsCount}</span>
              <span className="stat-label">Active Portals Scraped</span>
            </div>
          </div>
        </section>

        {/* Loading and Empty State */}
        {loading ? (
          <div className="loading-container" style={{ minHeight: '300px' }}>
            <span className="spinner" style={{ width: '40px', height: '40px', borderColor: 'var(--color-primary)', borderTopColor: 'transparent' }}></span>
            <p style={{ marginTop: '12px' }}>Loading job boards...</p>
          </div>
        ) : Object.keys(groupedJobs).length === 0 ? (
          <div className="empty-state">
            <h3>No job listings match your filters</h3>
            <p>Try clearing your search keyword or run "Sync Database" to fetch fresh data.</p>
          </div>
        ) : (
          /* Portal Grouped Rows */
          Object.entries(groupedJobs).map(([portalName, portalJobs]) => {
            const fullName = PORTAL_FULL_NAMES[portalName] || 'Other Government Portals';
            const logo = PORTAL_LOGOS[portalName] || '🏢';
            const rowId = `row-${portalName.replace(/\s+/g, '-')}`;

            return (
              <section key={portalName} className="portal-row-section">
                <div className="portal-row-header">
                  <div className="portal-title-area">
                    <div className="portal-row-logo">{logo}</div>
                    <div>
                      <h3>{portalName}</h3>
                      <span>{fullName}</span>
                    </div>
                  </div>
                  <div className="portal-header-actions">
                    <span className="portal-row-badge">{portalJobs.length} Jobs</span>
                    <button className="btn-view-portal" onClick={() => setSearchQuery(portalName)}>
                      View All {portalName} Jobs →
                    </button>
                  </div>
                </div>

                <div className="portal-cards-row-container">
                  {portalJobs.length > 3 && (
                    <button className="row-scroll-btn left" onClick={() => scrollRow(rowId, 'left')}>‹</button>
                  )}
                  
                  <div className="portal-cards-row" id={rowId}>
                    {portalJobs.map(job => (
                      <article key={job._id} className="gov-job-card" onClick={() => setSelectedJob(job)}>
                        <div>
                          <div className="card-top">
                            <span className="card-badge-new">New</span>
                            <button className="btn-bookmark-card">🔖</button>
                          </div>
                          <h4>{job.shortTitle}</h4>
                          <div className="card-department">{job.department}</div>
                        </div>

                        <div>
                          <div className="card-details-list">
                            <div className="card-detail-item">
                              <span className="card-detail-icon">💰</span>
                              <span>{job.salary && job.salary !== 'Not specified' ? job.salary : 'Pay Scale details inside'}</span>
                            </div>
                            <div className="card-detail-item">
                              <span className="card-detail-icon">🎓</span>
                              <span>{job.qualification || 'Not specified'}</span>
                            </div>
                            <div className="card-detail-item deadline">
                              <span className="card-detail-icon">📅</span>
                              <span>Last Date: {job.applicationDeadline}</span>
                            </div>
                          </div>

                          <div className="card-footer">
                            <button 
                              className="btn-card-action secondary" 
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedJob(job);
                              }}
                            >
                              Details
                            </button>
                            <a 
                              href={`${API_BASE}/jobs/${job._id}/apply`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="btn-card-action primary"
                              onClick={(e) => e.stopPropagation()}
                            >
                              Apply
                            </a>
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>

                  {portalJobs.length > 3 && (
                    <button className="row-scroll-btn right" onClick={() => scrollRow(rowId, 'right')}>›</button>
                  )}
                </div>
              </section>
            );
          })
        )}
      </main>

      {/* Details Modal */}
      {selectedJob && (
        <div className="modal-overlay" onClick={() => setSelectedJob(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setSelectedJob(null)}>&times;</button>
            <h3 className="modal-title">{selectedJob.shortTitle}</h3>
            <p className="modal-subtitle">{selectedJob.department}</p>
            
            <div className="modal-details-grid">
              <div className="modal-detail-item">
                <span className="modal-detail-label">Qualification</span>
                <span className="modal-detail-value">{selectedJob.qualification}</span>
              </div>
              <div className="modal-detail-item">
                <span className="modal-detail-label">Vacancies</span>
                <span className="modal-detail-value">{selectedJob.vacancies}</span>
              </div>
              <div className="modal-detail-item">
                <span className="modal-detail-label">Salary / Pay Scale</span>
                <span className="modal-detail-value">{selectedJob.salary}</span>
              </div>
              <div className="modal-detail-item">
                <span className="modal-detail-label">Age Criteria</span>
                <span className="modal-detail-value">{selectedJob.ageLimit}</span>
              </div>
              <div className="modal-detail-item">
                <span className="modal-detail-label">Location</span>
                <span className="modal-detail-value">{selectedJob.jobLocation}</span>
              </div>
              <div className="modal-detail-item">
                <span className="modal-detail-label">Last Date</span>
                <span className="modal-detail-value">{selectedJob.applicationDeadline}</span>
              </div>
            </div>

            {selectedJob.eligibilityCriteria && selectedJob.eligibilityCriteria !== 'Not specified' && (
              <div style={{ marginBottom: '16px' }}>
                <h4 style={{ fontSize: '14px', marginBottom: '4px', color: 'var(--text-primary)' }}>Eligibility & Requirements</h4>
                <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>{selectedJob.eligibilityCriteria}</p>
              </div>
            )}

            {selectedJob.officialNotificationPdf && selectedJob.officialNotificationPdf !== 'Not specified' && (
              <div style={{ marginBottom: '24px' }}>
                <h4 style={{ fontSize: '14px', marginBottom: '4px', color: 'var(--text-primary)' }}>Official Document</h4>
                <p>
                  <a 
                    href={selectedJob.officialNotificationPdf} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    style={{ color: 'var(--color-primary)', fontWeight: '700', fontSize: '13px', textDecoration: 'underline' }}
                  >
                    View Official PDF Notification
                  </a>
                </p>
              </div>
            )}

            <div style={{ display: 'flex', gap: '12px' }}>
              <a 
                href={`${API_BASE}/jobs/${selectedJob._id}/apply`} 
                target="_blank" 
                rel="noopener noreferrer"
                className="btn-card-action primary"
                style={{ flex: 1, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
              >
                Go to Application Portal
              </a>
              <button 
                className="btn-card-action secondary" 
                onClick={() => setSelectedJob(null)}
                style={{ width: '100px' }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
