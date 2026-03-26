'use client';

import { useState, useEffect, useRef } from 'react';
import GuidedFlow from '@/components/GuidedFlow';
import LeadTable from '@/components/LeadTable';
import ErrorBoundary from '@/components/ErrorBoundary';
import { GenerationParams, Lead, PipelineStats, RejectedLead, SearchHistoryEntry } from '@/types';
import { FiLoader, FiCheckCircle, FiAlertTriangle, FiRefreshCw, FiClock, FiZap, FiGlobe, FiFilter } from 'react-icons/fi';
import { apiFetch } from '@/lib/api-client';
import styles from './page.module.css';

const SESSION_KEY = 'careerx_session';
const HISTORY_KEY = 'careerx_history';

export default function Home() {
  const [phase, setPhase]               = useState<'gathering' | 'processing' | 'results' | 'error'>('gathering');
  const [agentLog, setAgentLog]         = useState<string[]>([]);
  const [activePlatform, setActivePlatform] = useState<string | null>(null);
  const [leads, setLeads]               = useState<Lead[]>([]);
  const [rejectedLeads, setRejectedLeads] = useState<RejectedLead[]>([]);
  const [isExporting, setIsExporting]   = useState(false);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const exportTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [mockWarning, setMockWarning]   = useState<string | null>(null);
  const [stats, setStats]               = useState<PipelineStats | null>(null);
  const [searchHistory, setSearchHistory] = useState<SearchHistoryEntry[]>([]);
  const [elapsed, setElapsed]           = useState(0);
  const timerRef                        = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Restore session on mount ──────────────────────────────────────────────
  useEffect(() => {
    try {
      const saved = localStorage.getItem(SESSION_KEY);
      if (saved) {
        const { leads: l, stats: s, mockWarning: m } = JSON.parse(saved);
        if (l?.length) { setLeads(l); setStats(s || null); setMockWarning(m || null); setPhase('results'); }
      }
      const hist = localStorage.getItem(HISTORY_KEY);
      if (hist) setSearchHistory(JSON.parse(hist));
    } catch { /* ignore corrupt localStorage */ }

    // Sync state across tabs — if another tab updates feedback/status, reflect it here
    const onStorage = (e: StorageEvent) => {
      if (e.key === SESSION_KEY && e.newValue) {
        try {
          const { leads: l, stats: s, mockWarning: m } = JSON.parse(e.newValue);
          if (l?.length) { setLeads(l); setStats(s || null); setMockWarning(m || null); }
        } catch { /* ignore */ }
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // ── Persist session whenever leads change ─────────────────────────────────
  useEffect(() => {
    if (leads.length > 0) {
      try {
        localStorage.setItem(SESSION_KEY, JSON.stringify({ leads, stats, mockWarning }));
      } catch { /* storage full, ignore */ }
    }
  }, [leads, stats, mockWarning]);

  // ── Elapsed timer helpers ─────────────────────────────────────────────────
  const startTimer = () => {
    setElapsed(0);
    timerRef.current = setInterval(() => setElapsed(s => s + 1), 1000);
  };
  const stopTimer = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  };
  useEffect(() => () => {
    stopTimer();
    if (exportTimerRef.current) clearTimeout(exportTimerRef.current);
  }, []);

  const fmtElapsed = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  // ── Agent pipeline (SSE streaming from /api/run-agent) ───────────────────
  const handleFlowComplete = async (params: GenerationParams) => {
    setPhase('processing');
    setErrorMessage('');
    setMockWarning(null);
    setStats(null);
    setElapsed(0);
    setAgentLog([]);
    setActivePlatform(null);
    startTimer();

    const addLog = (msg: string) => setAgentLog(prev => [...prev.slice(-19), msg]);

    try {
      const res = await apiFetch('/api/run-agent', {
        method: 'POST',
        body: JSON.stringify({ params }),
      });

      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        throw new Error(`Server error ${res.status}: ${errBody || res.statusText}`);
      }
      if (!res.body) throw new Error('No response body from agent');

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let   buffer  = '';

      // Timeout: abort if no data received for 2 minutes
      let lastDataAt = Date.now();
      const SSE_TIMEOUT_MS = 120_000;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        lastDataAt = Date.now();
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          let parsed: { event?: string; data?: Record<string, unknown> };
          try {
            parsed = JSON.parse(line.slice(6));
          } catch {
            continue; // skip malformed SSE lines
          }
          const { event, data } = parsed;
          if (!event || !data) continue;

          if (event === 'progress') {
            addLog(String(data.message ?? ''));
          } else if (event === 'tool_start') {
            setActivePlatform(String(data.platform ?? ''));
            addLog(`Searching ${data.platform}…`);
          } else if (event === 'tool_done') {
            addLog(`${data.platform}: ${data.qualifiedNew} new leads (total ${data.totalQualified})`);
          } else if (event === 'cost_estimate') {
            addLog(`Tokens: ${Number(data.inputTokens ?? 0).toLocaleString()} in / ${Number(data.outputTokens ?? 0).toLocaleString()} out · ~$${data.estimatedCostUsd} est.`);
          } else if (event === 'complete') {
            stopTimer();
            const rawLeads = Array.isArray(data.leads) ? data.leads as Lead[] : [];
            // Deduplicate by id to prevent React duplicate-key warnings
            const seenIds = new Set<string>();
            const finalLeads = rawLeads.filter(l => {
              if (!l || typeof l.id !== 'string') return false;
              if (seenIds.has(l.id)) return false;
              seenIds.add(l.id);
              return true;
            });
            const pipelineStats: PipelineStats = (data.stats as PipelineStats) || { scraped: finalLeads.length, qualified: finalLeads.length, rejected: 0 };
            setLeads(finalLeads);
            setRejectedLeads(Array.isArray(data.rejectedLeads) ? data.rejectedLeads as RejectedLead[] : []);
            setStats(pipelineStats);
            if (data.isMock) setMockWarning(String(data.mockReason ?? 'Demo data shown'));

            const entry: SearchHistoryEntry = {
              id: Date.now().toString(),
              timestamp: new Date().toISOString(),
              params,
              qualifiedCount: pipelineStats.qualified,
            };
            setSearchHistory(prev => {
              const updated = [entry, ...prev].slice(0, 5);
              try { localStorage.setItem(HISTORY_KEY, JSON.stringify(updated)); } catch { /* ignore */ }
              return updated;
            });

            setPhase('results');
          } else if (event === 'error') {
            throw new Error(String(data.message ?? 'Agent error'));
          }
        }

        // Check for stale connection
        if (Date.now() - lastDataAt > SSE_TIMEOUT_MS) {
          throw new Error('Connection timed out — no data received for 2 minutes.');
        }
      }
    } catch (err: unknown) {
      stopTimer();
      const message = err instanceof Error ? err.message : 'An unexpected error occurred.';
      setErrorMessage(message);
      setPhase('error');
    }
  };

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleStatusChange = (leadId: string, status: Lead['status']) => {
    setLeads(prev => {
      const updated = prev.map(l => l.id === leadId ? { ...l, status } : l);
      // Auto-push to sheet when contacted — use updated list to avoid stale closure
      if (status === 'contacted') {
        const lead = updated.find(l => l.id === leadId);
        if (lead) {
          apiFetch('/api/export-sheets', {
            method: 'POST',
            body: JSON.stringify({ leads: [lead] }),
          }).catch(e => console.error('Auto-sheet push failed:', e));
        }
      }
      return updated;
    });
  };

  const handleExportSheets = async (filteredLeads: Lead[]) => {
    setIsExporting(true);
    setExportMessage(null);
    try {
      const res = await apiFetch('/api/export-sheets', {
        method: 'POST',
        body: JSON.stringify({ leads: filteredLeads, rejectedLeads }),
      });
      const data = await res.json();
      if (res.ok) {
        let msg: string;
        const rejNote = data.rejectedExportedCount > 0 ? ` · ${data.rejectedExportedCount} rejected → "Rejected Leads" tab` : '';
        if (data.exportedCount === 0) {
          msg = `All leads already in sheet — nothing new to export${rejNote}`;
        } else if (data.duplicatesFound > 0) {
          msg = `Exported ${data.exportedCount} leads (${data.duplicatesFound} already in sheet)${rejNote}`;
        } else {
          msg = `Exported ${data.exportedCount} leads to Google Sheets${rejNote}`;
        }
        setExportMessage(msg);
        if (exportTimerRef.current) clearTimeout(exportTimerRef.current);
        exportTimerRef.current = setTimeout(() => setExportMessage(null), 4000);
      } else {
        throw new Error(data.error || 'Export failed');
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Export failed';
      console.error('Export error:', err);
      setExportMessage(`Export failed: ${message}`);
      if (exportTimerRef.current) clearTimeout(exportTimerRef.current);
      exportTimerRef.current = setTimeout(() => setExportMessage(null), 5000);
    } finally {
      setIsExporting(false);
    }
  };

  const handleLeadFeedback = async (lead: Lead, feedback: Lead['feedback']) => {
    setLeads(prev => prev.map(l => l.id === lead.id ? { ...l, feedback } : l));
    try {
      await apiFetch('/api/lead-feedback', {
        method: 'POST',
        body: JSON.stringify({ leadId: lead.id, linkedinUrl: lead.linkedinUrl, feedback, name: lead.name }),
      });
    } catch (e) { console.error('Failed to send feedback:', e); }
  };

  const handleNewSearch = () => {
    setPhase('gathering');
    localStorage.removeItem(SESSION_KEY);
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="container">

      {/* ── Gathering ── */}
      {phase === 'gathering' && (
        <div className={`${styles.gatheringLayout} animate-fade-in`}>
          {/* Header */}
          <div className={styles.compactHeader}>
            <div className={styles.heroBadge}>
              <FiZap size={11} />
              <span>AI-Powered Lead Discovery</span>
            </div>
            <h1 className="text-gradient">Find Your Ideal Candidates</h1>
            <p className="text-secondary text-sm" style={{ marginBottom: '0.5rem' }}>
              Multi-platform sourcing across LinkedIn, GitHub, Google & Reddit — qualified by Claude AI.
            </p>
            <div className={styles.heroStats}>
              <span className={styles.heroStat}><FiGlobe size={11} /> 4 Platforms</span>
              <span className={styles.heroStat}><FiFilter size={11} /> 50+ Signals</span>
              <span className={styles.heroStat}><FiZap size={11} /> Real-time Streaming</span>
            </div>
          </div>

          {/* Search history - compact chips */}
          {searchHistory.length > 0 && (
            <div className={styles.historyBarCompact}>
              {searchHistory.map(h => (
                <button
                  key={h.id}
                  className={styles.historyChip}
                  onClick={() => handleFlowComplete(h.params)}
                  title={`${new Date(h.timestamp).toLocaleDateString()} · ${h.qualifiedCount} leads`}
                >
                  {h.params.fields} · {h.qualifiedCount} leads
                </button>
              ))}
            </div>
          )}

          <div className={styles.flowWrapper}>
            <ErrorBoundary>
              <GuidedFlow onComplete={handleFlowComplete} />
            </ErrorBoundary>
          </div>
        </div>
      )}

      {/* ── Processing ── */}
      {phase === 'processing' && (
        <div className={`${styles['processing-container']} animate-fade-in`}>
          <div className={`glass-panel ${styles['processing-card']}`}>
            <div className={styles['processing-header']}>
              <div className={styles.pulseRing}></div>
              <FiLoader className={styles.spinner} size={48} />
              <h2 style={{ marginTop: '1.5rem' }} className="text-gradient">Agent at Work</h2>
              <p style={{ color: 'var(--text-secondary)' }}>
                {activePlatform
                  ? `Searching ${activePlatform}…`
                  : 'Claude is deciding which platforms to search…'}
              </p>
              {elapsed > 0 && (
                <div className={styles.elapsedBadge} style={{ marginTop: '0.5rem' }}>
                  <FiClock size={11} /> {fmtElapsed(elapsed)}
                </div>
              )}
            </div>

            {agentLog.length > 0 && (
              <div className={styles.terminalFeed}>
                {agentLog.map((msg, i) => (
                  <div key={i} className={`${styles.terminalLine} ${i === agentLog.length - 1 ? styles.terminalLineActive : ''}`}>
                    <span className={styles.terminalPrompt}>
                      {i === agentLog.length - 1 ? <FiLoader size={11} className={styles.spinner} /> : <FiCheckCircle size={11} color="#10b981" />}
                    </span>
                    <span>{msg}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Error ── */}
      {phase === 'error' && (
        <div className={`${styles['processing-container']} animate-fade-in`}>
          <div className={`glass-panel ${styles['processing-card']} ${styles['error-card']}`}>
            <FiAlertTriangle size={64} color="#ef4444" />
            <h2 className="text-gradient" style={{ marginTop: '1.5rem' }}>Discovery Interrupted</h2>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '2rem' }}>{errorMessage}</p>
            <button className="btn btn-primary" onClick={() => setPhase('gathering')}>
              <FiRefreshCw className="mr-2" /> Try Again
            </button>
          </div>
        </div>
      )}

      {/* ── Results ── */}
      {phase === 'results' && (
        <div className="animate-fade-in">
          {mockWarning && (
            <div className={styles.mockBanner}>
              <FiAlertTriangle size={15} />
              <strong>Demo data shown</strong> — {mockWarning}
            </div>
          )}

          {exportMessage && (
            <div className={`${styles.exportToast} ${exportMessage.startsWith('Export failed') ? styles.exportToastError : ''}`}>
              <FiCheckCircle size={18} /> {exportMessage}
            </div>
          )}

          <div className={styles.resultsHeader}>
            <div>
              <h1 className="text-gradient">Qualified Leads Found</h1>
              <p style={{ color: 'var(--text-secondary)' }}>Quality Score threshold (≥6) applied. Adjust with the score slider below.</p>
            </div>
            <button className="btn btn-secondary" onClick={handleNewSearch}>
              Start New Search
            </button>
          </div>

          <ErrorBoundary>
            <LeadTable
              leads={leads}
              onExportSheets={handleExportSheets}
              onFeedback={handleLeadFeedback}
              onStatusChange={handleStatusChange}
              isExporting={isExporting}
              stats={stats ?? undefined}
            />
          </ErrorBoundary>
        </div>
      )}
    </div>
  );
}
