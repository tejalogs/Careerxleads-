'use client';
import { useState, useMemo, useEffect } from 'react';
import styles from './LeadTable.module.css';
import { Lead, PipelineStats } from '@/types';
import {
  FiDownload, FiShare2, FiExternalLink,
  FiThumbsUp, FiThumbsDown, FiUserCheck, FiSearch,
  FiChevronUp, FiChevronDown, FiCopy, FiBarChart2, FiX,
  FiChevronLeft, FiChevronRight, FiEdit2, FiCheck,
} from 'react-icons/fi';
import LeadDrawer from './LeadDrawer';

const PAGE_SIZE = 50;

interface LeadTableProps {
  leads: Lead[];
  onExportSheets: (leads: Lead[]) => void;
  onFeedback: (lead: Lead, feedback: Lead['feedback']) => void;
  onStatusChange: (leadId: string, status: Lead['status']) => void;
  isExporting?: boolean;
  stats?: PipelineStats;
}

const TIER_META: Record<1 | 2 | 3, { label: string; color: string; bg: string; title: string }> = {
  1: { label: 'Hot',  color: '#dc2626', bg: '#fef2f2', title: 'Hot lead (score≥8 + high intent)' },
  2: { label: 'Warm', color: '#d97706', bg: '#fffbeb', title: 'Warm lead (score 6-7 or intent≥2)' },
  3: { label: 'Cold', color: '#64748b', bg: '#f8fafc', title: 'Cold lead (score 5-6)' },
};

const PLATFORM_META: Record<string, { label: string; color: string }> = {
  LinkedIn: { label: 'LI', color: '#0a66c2' },
  Google:   { label: 'GG', color: '#ea4335' },
  GitHub:   { label: 'GH', color: '#6e5494' },
  Reddit:   { label: 'RD', color: '#ff4500' },
};

const STATUS_OPTIONS: Lead['status'][] = ['new', 'contacted', 'replied', 'call booked', 'converted'];
const STATUS_COLORS: Record<string, string> = {
  new:         '#64748b',
  contacted:   '#3b82f6',
  replied:     '#f59e0b',
  'call booked': '#8b5cf6',
  converted:   '#10b981',
};

type SortKey = 'qualityScore' | 'intentScore' | 'graduationYear' | 'name';

export default function LeadTable({
  leads, onExportSheets, onFeedback, onStatusChange, isExporting = false, stats,
}: LeadTableProps) {
  const [minScore, setMinScore]           = useState(6);
  const [filterTier, setFilterTier]       = useState<'all' | '1' | '2' | '3'>('all');
  const [filterReview, setFilterReview]   = useState('all');
  const [filterUniversity, setFilterUniversity] = useState('all');
  const [filterPlatform, setFilterPlatform]     = useState('all');
  const [searchName, setSearchName]       = useState('');
  const [sortBy, setSortBy]               = useState<SortKey>('qualityScore');
  const [sortDir, setSortDir]             = useState<'desc' | 'asc'>('desc');
  const [selectedIds, setSelectedIds]     = useState<Set<string>>(new Set());
  const [editedMessages, setEditedMessages] = useState<Record<string, string>>({});
  const [copiedId, setCopiedId]           = useState<string | null>(null);
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [page, setPage] = useState(0);
  const [drawerLead, setDrawerLead] = useState<Lead | null>(null);

  const tierCounts = useMemo(() => ({
    1: leads.filter(l => l.tier === 1).length,
    2: leads.filter(l => l.tier === 2).length,
    3: leads.filter(l => l.tier === 3).length,
  }), [leads]);

  const universities = useMemo(
    () => Array.from(new Set(leads.map(l => l.university).filter(Boolean))).sort(),
    [leads],
  );
  const platforms = useMemo(
    () => Array.from(new Set(leads.map(l => l.metadata?.platform as string).filter(Boolean))).sort(),
    [leads],
  );

  const filteredLeads = useMemo(() => {
    const result = leads.filter(lead => {
      if ((lead.qualityScore ?? 0) < minScore) return false;
      if (filterTier !== 'all' && (lead.tier == null || lead.tier !== Number(filterTier))) return false;
      if (filterReview !== 'all' && lead.reviewFlag !== filterReview) return false;
      if (filterUniversity !== 'all' && lead.university !== filterUniversity) return false;
      if (filterPlatform !== 'all' && lead.metadata?.platform !== filterPlatform) return false;
      if (searchName && !lead.name.toLowerCase().includes(searchName.toLowerCase())) return false;
      return true;
    });
    result.sort((a, b) => {
      let av: number | string = 0, bv: number | string = 0;
      if (sortBy === 'qualityScore')  { av = a.qualityScore ?? 0; bv = b.qualityScore ?? 0; }
      else if (sortBy === 'intentScore') { av = a.intentScore ?? 0; bv = b.intentScore ?? 0; }
      else if (sortBy === 'graduationYear') { av = a.graduationYear || ''; bv = b.graduationYear || ''; }
      else if (sortBy === 'name')     { av = a.name; bv = b.name; }
      if (sortDir === 'desc') return av < bv ? 1 : av > bv ? -1 : 0;
      return av > bv ? 1 : av < bv ? -1 : 0;
    });
    return result;
  }, [leads, minScore, filterTier, filterReview, filterUniversity, filterPlatform, searchName, sortBy, sortDir]);

  // Reset to first page whenever filtered set changes
  useEffect(() => { setPage(0); }, [filteredLeads]);

  const totalPages = Math.max(1, Math.ceil(filteredLeads.length / PAGE_SIZE));
  const pagedLeads = filteredLeads.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  // Analytics data
  const analytics = useMemo(() => {
    const scoreDist: Record<number, number> = {};
    for (let i = 1; i <= 10; i++) scoreDist[i] = 0;
    const uniCounts: Record<string, number> = {};
    const fieldCounts: Record<string, number> = {};
    const platformCounts: Record<string, number> = {};
    leads.forEach(l => {
      if (l.qualityScore) scoreDist[l.qualityScore] = (scoreDist[l.qualityScore] || 0) + 1;
      if (l.university) uniCounts[l.university] = (uniCounts[l.university] || 0) + 1;
      if (l.fieldOfStudy) fieldCounts[l.fieldOfStudy] = (fieldCounts[l.fieldOfStudy] || 0) + 1;
      const p = (l.metadata?.platform as string) || 'Unknown';
      platformCounts[p] = (platformCounts[p] || 0) + 1;
    });
    return {
      scoreDist,
      topUnis: Object.entries(uniCounts).sort(([, a], [, b]) => b - a).slice(0, 8),
      topFields: Object.entries(fieldCounts).sort(([, a], [, b]) => b - a).slice(0, 6),
      byPlatform: Object.entries(platformCounts).sort(([, a], [, b]) => b - a),
    };
  }, [leads]);

  const handleSortBy = (col: SortKey) => {
    if (sortBy === col) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortBy(col); setSortDir('desc'); }
  };

  const allSelected = filteredLeads.length > 0 && filteredLeads.every(l => selectedIds.has(l.id));
  const toggleSelectAll = () =>
    setSelectedIds(allSelected ? new Set() : new Set(filteredLeads.map(l => l.id)));
  const toggleSelect = (id: string) =>
    setSelectedIds(prev =>
      prev.has(id)
        ? new Set([...prev].filter(x => x !== id))
        : new Set([...prev, id]),
    );

  const handleBulkStatus = (status: Lead['status']) => {
    selectedIds.forEach(id => onStatusChange(id, status));
    setSelectedIds(new Set());
  };

  const handleCopyEmail = (lead: Lead) => {
    if (!lead.email) return;
    navigator.clipboard.writeText(lead.email);
    setCopiedId(lead.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const exportCSV = () => {
    const headers = [
      'Timestamp', 'Full Name', 'LinkedIn URL', 'University', 'Degree', 'Field Of Study',
      'Graduation Year', 'Location', 'Headline', 'Email', 'Seeking Internship',
      'Seeking Full Time', 'Intent Score', 'Priority', 'Outreach Message', 'Status',
      'Struggle Score', 'Uni Tier', 'Networking Score', 'OPT Days Remaining', 'Regional Tag', 'Phone',
    ];

    const rows = filteredLeads.map(l => {
      const msg = editedMessages[l.id] ?? l.outreachMessage;
      return [
        `"${new Date().toISOString()}"`,                             // A: Timestamp
        `"${(l.name || '').replace(/"/g, '""')}"`,                   // B: Full Name
        `"${(l.linkedinUrl || '').replace(/"/g, '""')}"`,            // C: LinkedIn URL
        `"${(l.university || '').replace(/"/g, '""')}"`,             // D: University
        `"${(l.degree || '').replace(/"/g, '""')}"`,                 // E: Degree
        `"${(l.fieldOfStudy || '').replace(/"/g, '""')}"`,           // F: Field Of Study
        `"${(l.graduationYear || '').replace(/"/g, '""')}"`,         // G: Graduation Year
        `"${(l.location || '').replace(/"/g, '""')}"`,               // H: Location
        `"${(l.headline || '').replace(/"/g, '""')}"`,               // I: Headline
        `"${(l.email || '').replace(/"/g, '""')}"`,                  // J: Email
        l.seekingInternship ? 'Yes' : 'No',                          // K: Seeking Internship
        l.seekingFullTime ? 'Yes' : 'No',                            // L: Seeking Full Time
        l.intentScore ?? '',                                         // M: Intent Score
        l.tier ? TIER_META[l.tier as 1|2|3]?.label ?? '' : '',      // N: Priority
        `"${(msg || '').replace(/"/g, '""').replace(/\n/g, ' ')}"`,  // O: Outreach Message
        l.status || 'new',                                           // P: Status
        l.struggleScore   ?? '',                                     // Q: Struggle Score
        l.universityTier  ?? '',                                     // R: Uni Tier
        l.networkingScore ?? '',                                     // S: Networking Score
        l.optDaysRemaining ?? '',                                    // T: OPT Days Remaining
        `"${String((l.regionalTag || l.detectedLanguage) ?? '').replace(/"/g, '""')}"`, // U: Regional Tag
        `"${String(l.phone ?? '').replace(/"/g, '""')}"`,               // V: Phone (WhatsApp)
      ];
    });

    // BOM prefix for Excel UTF-8 compatibility
    const csv = '\ufeff' + [headers.map(h => `"${h}"`).join(','), ...rows.map(r => r.join(','))].join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a'); a.href = url; a.download = 'careerx_leads.csv'; a.click();
  };

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortBy !== col) return <FiChevronUp style={{ opacity: 0.3, flexShrink: 0 }} size={12} />;
    return sortDir === 'desc'
      ? <FiChevronDown style={{ flexShrink: 0 }} size={12} />
      : <FiChevronUp style={{ flexShrink: 0 }} size={12} />;
  };

  const maxAnalyticsVal = (arr: [string, number][]) => Math.max(...arr.map(([, v]) => v), 1);

  return (
    <>
    <div className={styles.tableContainer}>

      {/* ── Header ── */}
      <div className={styles.tableHeader}>
        <div>
          <h3>Qualified Leads <span className={styles.leadCount}>({filteredLeads.length})</span></h3>
          {stats && (
            <p className={styles.statsLine}>
              {stats.scraped} scraped → {stats.qualified} qualified
              {stats.rejected > 0 && <span className={styles.rejectedCount}> · {stats.rejected} rejected by guardrails</span>}
            </p>
          )}
        </div>
        <div className={styles.actions}>
          <button className="btn btn-secondary" onClick={() => setShowAnalytics(true)}>
            <FiBarChart2 className={styles.mr2} size={15}/> Analytics
          </button>
          <button className="btn btn-secondary" onClick={exportCSV}>
            <FiDownload className={styles.mr2} size={15}/> CSV
          </button>
          <button
            className="btn btn-primary"
            onClick={() => onExportSheets(filteredLeads.map(l => ({ ...l, outreachMessage: editedMessages[l.id] ?? l.outreachMessage })))}
            disabled={isExporting}
          >
            <FiShare2 className={styles.mr2} size={15}/> {isExporting ? 'Exporting…' : 'Export CRM'}
          </button>
        </div>
      </div>

      {/* ── Filters ── */}
      <div className={styles.filtersPanel}>
        <div className={styles.filtersRow}>
          <div className={styles.searchBox}>
            <FiSearch size={13} className={styles.searchIcon} />
            <input
              type="text"
              placeholder="Search name…"
              value={searchName}
              onChange={e => setSearchName(e.target.value)}
              className={styles.searchInput}
              aria-label="Search leads by name"
            />
          </div>
          <div className={styles.scoreSliderWrap}>
            <span className={styles.scoreLabel}>Min Score: <strong>{minScore}</strong></span>
            <input type="range" min={1} max={10} value={minScore}
              onChange={e => setMinScore(Number(e.target.value))} className={styles.scoreSlider} />
          </div>
          <div className={styles.tierPills}>
            {(['all', '1', '2', '3'] as const).map(t => {
              const meta = t !== 'all' ? TIER_META[Number(t) as 1|2|3] : null;
              return (
                <button
                  key={t}
                  className={`${styles.tierPill} ${filterTier === t ? styles.tierPillActive : ''}`}
                  style={filterTier === t && meta ? { borderColor: meta.color, color: meta.color } : {}}
                  onClick={() => setFilterTier(t)}
                >
                  {t === 'all' ? 'All' : meta!.label}
                  <span className={styles.tierPillCount}>{t === 'all' ? leads.length : tierCounts[Number(t) as 1|2|3]}</span>
                </button>
              );
            })}
          </div>
          <select className="input-field" value={filterReview} onChange={e => setFilterReview(e.target.value)}>
            <option value="all">Any Review</option>
            <option value="approved">Approved</option>
            <option value="review_needed">Needs Review</option>
          </select>
          <select className="input-field" value={filterUniversity} onChange={e => setFilterUniversity(e.target.value)}>
            <option value="all">All Universities</option>
            {universities.map(u => <option key={u} value={u}>{u}</option>)}
          </select>
          {platforms.length > 0 && (
            <select className="input-field" value={filterPlatform} onChange={e => setFilterPlatform(e.target.value)}>
              <option value="all">All Platforms</option>
              {platforms.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          )}
        </div>
      </div>

      {/* ── Tier summary bar ── */}
      <div className={styles.summaryBar}>
        {([1, 2, 3] as const).map(t => {
          const meta = TIER_META[t];
          const count = tierCounts[t];
          const pct = leads.length ? Math.round((count / leads.length) * 100) : 0;
          return (
            <div key={t} className={styles.summaryCard}>
              <span className={styles.summaryLabel}>{meta.label}</span>
              <span className={styles.summaryCount} style={{ color: meta.color }}>{count}</span>
              <div className={styles.summaryTrack}>
                <div className={styles.summaryFill} style={{ width: `${pct}%`, background: meta.color }} />
              </div>
              <span className={styles.summaryPct}>{pct}%</span>
            </div>
          );
        })}
        <div className={styles.summaryCard}>
          <span className={styles.summaryLabel}>Total</span>
          <span className={styles.summaryCount} style={{ color: 'var(--text-primary)' }}>{leads.length}</span>
          <div className={styles.summaryTrack}>
            <div className={styles.summaryFill} style={{ width: '100%', background: 'var(--accent-primary)', opacity: 0.4 }} />
          </div>
          <span className={styles.summaryPct}>100%</span>
        </div>
      </div>

      {/* ── Bulk Actions ── */}
      {selectedIds.size > 0 && (
        <div className={styles.bulkBar}>
          <span className={styles.bulkCount}>{selectedIds.size} selected</span>
          <span className={styles.bulkLabel}>Mark as:</span>
          {STATUS_OPTIONS.map(s => (
            <button key={s} className={styles.bulkStatusBtn} onClick={() => handleBulkStatus(s)}>{s}</button>
          ))}
          <button className={styles.bulkClear} onClick={() => setSelectedIds(new Set())}>Clear</button>
        </div>
      )}

      {/* ── Table ── */}
      <div className={styles.tableWrapper}>
        {filteredLeads.length === 0 ? (
          <div className={styles.emptyState}>
            <FiSearch size={32} style={{ opacity: 0.25, marginBottom: '0.75rem' }} />
            <p>No leads match the current filters.</p>
            <button className="btn btn-secondary" style={{ marginTop: '1rem', fontSize: '0.85rem', padding: '0.5rem 1.25rem' }}
              onClick={() => { setMinScore(6); setFilterTier('all'); setFilterReview('all'); setFilterUniversity('all'); setFilterPlatform('all'); setSearchName(''); }}>
              Clear Filters
            </button>
          </div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.checkboxCell}>
                  <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} aria-label="Select all leads" />
                </th>
                <th>Candidate</th>
                <th>Headline &amp; Intent</th>
                <th>Tier</th>
                <th className={styles.sortableHeader} onClick={() => handleSortBy('qualityScore')}>
                  Score <SortIcon col="qualityScore" />
                </th>
                <th>Source</th>
                <th>Status</th>
                <th>Email</th>
                <th>Review</th>
                <th>Feedback</th>
                <th>Outreach</th>
              </tr>
            </thead>
            <tbody>
              {pagedLeads.map(lead => {
                const platform = lead.metadata?.platform as string | undefined;
                const platMeta = platform ? PLATFORM_META[platform] : undefined;
                const statusColor = STATUS_COLORS[lead.status || 'new'];
                const outreachText = editedMessages[lead.id] ?? lead.outreachMessage;

                return (
                  <tr key={lead.id} className={`${styles.tableRow} ${selectedIds.has(lead.id) ? styles.selectedRow : ''}`}>
                    <td className={styles.checkboxCell}>
                      <input type="checkbox" checked={selectedIds.has(lead.id)} onChange={() => toggleSelect(lead.id)} aria-label={`Select ${lead.name}`} />
                    </td>

                    {/* Candidate */}
                    <td>
                      <div className={styles.candidateInfo}>
                        <a href={lead.linkedinUrl} target="_blank" rel="noopener noreferrer" className={styles.candidateName}>
                          {lead.name} <FiExternalLink size={11} aria-label="(opens in new tab)" />
                        </a>
                        <div className={styles.candidateSub}>{lead.university}</div>
                        <div className={styles.candidateSub}>{[lead.degree, lead.fieldOfStudy].filter(Boolean).join(' · ')}</div>
                        {(lead.location || lead.graduationYear) && (
                          <div className={styles.candidateSub}>
                            {[lead.location, lead.graduationYear].filter(Boolean).join(' · ')}
                          </div>
                        )}
                      </div>
                    </td>

                    {/* Headline & Intent */}
                    <td>
                      <div className={styles.intentCell}>
                        <p className={styles.headlineText}>
                          {lead.headline ? (lead.headline.length > 100 ? lead.headline.slice(0, 100) + '…' : lead.headline) : '—'}
                        </p>
                        <div className={styles.intentBadges}>
                          {lead.seekingInternship && <span className={`${styles.intentBadge} ${styles.internBadge}`}>Internship</span>}
                          {lead.seekingFullTime   && <span className={`${styles.intentBadge} ${styles.ftBadge}`}>Full-time</span>}
                          <span className={styles.intentScore} title={`Intent Score: ${lead.intentScore}/3`}>⚡{lead.intentScore ?? '—'}</span>
                        </div>
                      </div>
                    </td>

                    {/* Tier badge */}
                    <td>
                      {lead.tier ? (() => {
                        const t = TIER_META[lead.tier as 1 | 2 | 3];
                        return (
                          <span
                            title={t.title}
                            style={{ display: 'inline-block', padding: '2px 7px', borderRadius: '4px', fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.03em', background: t.bg, color: t.color, border: `1px solid ${t.color}40` }}
                          >
                            {t.label}
                          </span>
                        );
                      })() : <span style={{ color: '#94a3b8' }}>—</span>}
                    </td>

                    {/* Score */}
                    <td>
                      <div className={styles.scoreCell}>
                        <div className={`${styles.scoreBadge} ${(lead.qualityScore ?? 0) >= 8 ? styles.scoreHigh : styles.scoreMedium}`}>
                          {lead.qualityScore}/10
                        </div>
                        <div className={styles.guardrailList}>
                          {lead.qualityBreakdown?.indianOriginConfirmed && <span title="Indian Origin">🇮🇳</span>}
                          {lead.qualityBreakdown?.mastersStudent         && <span title="Masters Student">🎓</span>}
                          {lead.qualityBreakdown?.jobSearchIntent        && <span title="Job Search Intent">🔎</span>}
                          {(lead.struggleScore ?? 0) >= 6               && <span title={`Struggle Score: ${lead.struggleScore}/10 — high-pain lead`}>🔥</span>}
                          {lead.universityTier === 3                    && <span title="Tier 3 university (prime target)">🏛</span>}
                          {lead.universityTier === 4                    && <span title="Tier 4 university (ultra-prime — rarely recruited)">⭐</span>}
                          {lead.networkingScore !== undefined && lead.networkingScore <= 4 && <span title={`Networking Score: ${lead.networkingScore}/10 — service-company trap, insular network`}>🕸</span>}
                          {(lead.regionalTag || lead.detectedLanguage)  && <span title={`Regional: ${lead.regionalTag || lead.detectedLanguage}`}>🗣</span>}
                        </div>
                        {lead.optDaysRemaining !== undefined && lead.optDaysRemaining <= 30 && (
                          <div style={{ marginTop: '4px' }}>
                            <span title={`~${lead.optDaysRemaining} days left on OPT unemployment clock`}
                              style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.04em', color: '#dc2626', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: '4px', padding: '1px 5px', animation: 'pulse 1.5s ease-in-out infinite' }}>
                              🚨 URGENT · {lead.optDaysRemaining}d OPT
                            </span>
                          </div>
                        )}
                      </div>
                    </td>

                    {/* Source platform */}
                    <td>
                      {platMeta ? (
                        <span className={styles.platformBadge}
                          style={{ background: `${platMeta.color}20`, color: platMeta.color, borderColor: `${platMeta.color}50` }}>
                          {platMeta.label}
                        </span>
                      ) : <span className={styles.platformBadge}>—</span>}
                    </td>

                    {/* Status dropdown */}
                    <td>
                      <select
                        className={styles.statusSelect}
                        value={lead.status || 'new'}
                        onChange={e => onStatusChange(lead.id, e.target.value as Lead['status'])}
                        style={{ borderColor: `${statusColor}80`, color: statusColor }}
                        aria-label={`Status for ${lead.name}`}
                      >
                        {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </td>

                    {/* Email + Phone */}
                    <td>
                      {lead.email ? (
                        <div className={styles.emailCell}>
                          <span className={styles.emailText}>{lead.email}</span>
                          <button className={styles.copyBtn} onClick={() => handleCopyEmail(lead)} title="Copy email">
                            {copiedId === lead.id ? <FiCheck size={11} color="#10b981" /> : <FiCopy size={11} />}
                          </button>
                        </div>
                      ) : <span className={styles.emptyDash}>—</span>}
                      {lead.phone && (
                        <div className={styles.emailCell} style={{ marginTop: '3px' }}>
                          <span className={styles.emailText} style={{ color: '#16a34a', fontSize: '0.72rem' }}>📱 {lead.phone}</span>
                          <button className={styles.copyBtn} onClick={() => { navigator.clipboard.writeText(lead.phone!); }} title="Copy phone / WhatsApp">
                            <FiCopy size={11} />
                          </button>
                        </div>
                      )}
                    </td>

                    {/* Feedback */}
                    <td>
                      <div className={styles.feedbackLoop}>
                        <button className={`${styles.feedBtn} ${lead.feedback === 'good_lead' ? styles.feedActive : ''}`}
                          onClick={() => onFeedback(lead, 'good_lead')} title="Good Lead">
                          <FiThumbsUp size={13} />
                        </button>
                        <button className={`${styles.feedBtn} ${lead.feedback === 'irrelevant_lead' ? styles.feedActiveIrrelevant : ''}`}
                          onClick={() => onFeedback(lead, 'irrelevant_lead')} title="Irrelevant">
                          <FiThumbsDown size={13} />
                        </button>
                        <button className={`${styles.feedBtn} ${lead.feedback === 'converted_lead' ? styles.feedActiveConverted : ''}`}
                          onClick={() => onFeedback(lead, 'converted_lead')} title="Converted">
                          <FiUserCheck size={13} />
                        </button>
                      </div>
                    </td>

                    {/* Outreach — opens drawer */}
                    <td className={styles.outreachCell}>
                      <div className={styles.messageCard} onClick={() => setDrawerLead(lead)} title="Click to edit outreach">
                        <span className={styles.messagePreview}>{outreachText}</span>
                        <FiEdit2 size={11} className={styles.editHint} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Pagination ── */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.75rem', padding: '1rem', borderTop: '1px solid var(--border)' }}>
          <button
            className="btn btn-secondary"
            onClick={() => setPage(p => Math.max(0, p - 1))}
            disabled={page === 0}
            style={{ padding: '0.35rem 0.75rem' }}
          >
            <FiChevronLeft size={14} />
          </button>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            Page {page + 1} of {totalPages} &nbsp;·&nbsp; {filteredLeads.length} leads
          </span>
          <button
            className="btn btn-secondary"
            onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            style={{ padding: '0.35rem 0.75rem' }}
          >
            <FiChevronRight size={14} />
          </button>
        </div>
      )}

      {/* ── Analytics Modal ── */}
      {showAnalytics && (
        <div className={styles.modalOverlay} onClick={() => setShowAnalytics(false)} role="dialog" aria-modal="true" aria-labelledby="analytics-modal-title">
          <div className={styles.analyticsModal} onClick={e => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h3 id="analytics-modal-title">Lead Analytics</h3>
              <button className={styles.modalClose} onClick={() => setShowAnalytics(false)} aria-label="Close analytics"><FiX /></button>
            </div>

            <div className={styles.analyticsGrid}>
              {/* By Priority (tier) */}
              <div className={styles.analyticsCard}>
                <h4>By Priority</h4>
                {([1, 2, 3] as const).map(tier => {
                  const meta = TIER_META[tier];
                  const count = tierCounts[tier];
                  return (
                    <div key={tier} className={styles.barRow}>
                      <span className={styles.barLabel} style={{ color: meta.color, fontWeight: 600 }}>{meta.label}</span>
                      <div className={styles.barTrack}>
                        <div className={styles.barFill} style={{ width: `${leads.length ? (count / leads.length) * 100 : 0}%`, background: meta.color }} />
                      </div>
                      <span className={styles.barCount}>{count}</span>
                    </div>
                  );
                })}
              </div>

              {/* Score distribution */}
              <div className={styles.analyticsCard}>
                <h4>Score Distribution</h4>
                {Object.entries(analytics.scoreDist).filter(([, v]) => v > 0).map(([score, count]) => (
                  <div key={score} className={styles.barRow}>
                    <span className={styles.barLabel}>{score}</span>
                    <div className={styles.barTrack}>
                      <div className={styles.barFill} style={{ width: `${(count / leads.length) * 100}%`, background: Number(score) >= 8 ? '#10b981' : '#f59e0b' }} />
                    </div>
                    <span className={styles.barCount}>{count}</span>
                  </div>
                ))}
              </div>

              {/* By platform */}
              <div className={styles.analyticsCard}>
                <h4>By Platform</h4>
                {analytics.byPlatform.map(([platform, count]) => {
                  const meta = PLATFORM_META[platform];
                  return (
                    <div key={platform} className={styles.barRow}>
                      <span className={styles.barLabel} style={{ color: meta?.color }}>{meta?.label || platform}</span>
                      <div className={styles.barTrack}>
                        <div className={styles.barFill} style={{ width: `${(count / leads.length) * 100}%`, background: meta?.color || '#64748b' }} />
                      </div>
                      <span className={styles.barCount}>{count}</span>
                    </div>
                  );
                })}
              </div>

              {/* Top universities */}
              <div className={styles.analyticsCard}>
                <h4>Top Universities</h4>
                {analytics.topUnis.map(([uni, count]) => (
                  <div key={uni} className={styles.barRow}>
                    <span className={styles.barLabel} title={uni}>{uni.length > 22 ? uni.slice(0, 22) + '…' : uni}</span>
                    <div className={styles.barTrack}>
                      <div className={styles.barFill} style={{ width: `${(count / maxAnalyticsVal(analytics.topUnis)) * 100}%` }} />
                    </div>
                    <span className={styles.barCount}>{count}</span>
                  </div>
                ))}
              </div>

              {/* Top fields */}
              <div className={styles.analyticsCard}>
                <h4>By Field of Study</h4>
                {analytics.topFields.map(([field, count]) => (
                  <div key={field} className={styles.barRow}>
                    <span className={styles.barLabel} title={field}>{field.length > 22 ? field.slice(0, 22) + '…' : field}</span>
                    <div className={styles.barTrack}>
                      <div className={styles.barFill} style={{ width: `${(count / maxAnalyticsVal(analytics.topFields)) * 100}%`, background: '#8b5cf6' }} />
                    </div>
                    <span className={styles.barCount}>{count}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>

    {/* ── Outreach Drawer ── */}
    {drawerLead !== null && (
      <LeadDrawer
        lead={drawerLead}
        editedMessages={editedMessages}
        onClose={() => setDrawerLead(null)}
        onEdit={(id, text) => setEditedMessages(prev => ({ ...prev, [id]: text }))}
        onReset={(id) => setEditedMessages(prev => Object.fromEntries(Object.entries(prev).filter(([k]) => k !== id)))}
        onStatusChange={(id, status) => { onStatusChange(id, status); setDrawerLead(prev => prev ? { ...prev, status } : null); }}
        onFeedback={(lead, fb) => { onFeedback(lead, fb); setDrawerLead(prev => prev ? { ...prev, feedback: fb } : null); }}
      />
    )}
    </>
  );
}
