'use client';

import { useState, useEffect, useRef } from 'react';
import GuidedFlow from '@/components/GuidedFlow';
import LeadTable from '@/components/LeadTable';
import ErrorBoundary from '@/components/ErrorBoundary';
import { GenerationParams, Lead, PipelineStats, SearchHistoryEntry } from '@/types';
import { FiLoader, FiCheckCircle, FiAlertTriangle, FiRefreshCw, FiClock, FiZap, FiGlobe, FiFilter } from 'react-icons/fi';
import styles from './page.module.css';

const SESSION_KEY = 'careerx_session';
const HISTORY_KEY = 'careerx_history';

export default function Home() {
  const [phase, setPhase]               = useState<'gathering' | 'processing' | 'results' | 'error'>('gathering');
  const [agentLog, setAgentLog]         = useState<string[]>([]);
  const [activePlatform, setActivePlatform] = useState<string | null>(null);
  const [leads, setLeads]               = useState<Lead[]>([]);
  const [isExporting, setIsExporting]   = useState(false);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
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
  useEffect(() => () => stopTimer(), []);

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
      const res = await fetch('/api/run-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ params }),
      });

      if (!res.body) throw new Error('No response body from agent');

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let   buffer  = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const { event, data } = JSON.parse(line.slice(6));

            if (event === 'progress') {
              addLog(data.message);
            } else if (event === 'tool_start') {
              setActivePlatform(data.platform);
              addLog(`Searching ${data.platform}…`);
            } else if (event === 'tool_done') {
              addLog(`${data.platform}: ${data.qualifiedNew} new leads (total ${data.totalQualified})`);
            } else if (event === 'cost_estimate') {
              addLog(`Tokens: ${data.inputTokens.toLocaleString()} in / ${data.outputTokens.toLocaleString()} out · ~$${data.estimatedCostUsd} est.`);
            } else if (event === 'complete') {
              stopTimer();
              const finalLeads: Lead[] = data.leads || [];
              const pipelineStats: PipelineStats = data.stats || { scraped: finalLeads.length, qualified: finalLeads.length, rejected: 0 };
              setLeads(finalLeads);
              setStats(pipelineStats);
              if (data.isMock) setMockWarning(data.mockReason || 'Demo data shown');

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
              throw new Error(data.message || 'Agent error');
            }
          } catch (parseErr: any) {
            // Re-throw real errors (from event === 'error' handler), ignore JSON parse noise
            if (parseErr instanceof Error) throw parseErr;
          }
        }
      }
    } catch (error: any) {
      stopTimer();
      setErrorMessage(error.message || 'An unexpected error occurred.');
      setPhase('error');
    }
  };

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleStatusChange = (leadId: string, status: Lead['status']) => {
    setLeads(prev => prev.map(l => l.id === leadId ? { ...l, status } : l));
    if (status === 'contacted') {
      const lead = leads.find(l => l.id === leadId);
      if (lead) {
        fetch('/api/export-sheets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ leads: [{ ...lead, status }] }),
        }).catch(e => console.error('Auto-sheet push failed:', e));
      }
    }
  };

  const handleExportSheets = async (filteredLeads: Lead[]) => {
    setIsExporting(true);
    setExportMessage(null);
    try {
      const res = await fetch('/api/export-sheets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leads: filteredLeads }),
      });
      const data = await res.json();
      if (res.ok) {
        let msg: string;
        if (data.exportedCount === 0) {
          msg = 'All leads already in sheet — nothing new to export';
        } else if (data.duplicatesFound > 0) {
          msg = `Exported ${data.exportedCount} leads (${data.duplicatesFound} already in sheet)`;
        } else {
          msg = `Exported ${data.exportedCount} leads to Google Sheets`;
        }
        setExportMessage(msg);
        setTimeout(() => setExportMessage(null), 4000);
      } else {
        throw new Error(data.error || 'Export failed');
      }
    } catch (error: any) {
      console.error('Export error:', error);
      setExportMessage(`Export failed: ${error.message}`);
      setTimeout(() => setExportMessage(null), 5000);
    } finally {
      setIsExporting(false);
    }
  };

  const handleLeadFeedback = async (lead: Lead, feedback: Lead['feedback']) => {
    setLeads(prev => prev.map(l => l.id === lead.id ? { ...l, feedback } : l));
    try {
      await fetch('/api/lead-feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
