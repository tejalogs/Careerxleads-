import React, { useState, useMemo } from 'react';
import styles from './LeadTable.module.css';
import { Lead } from '@/types';
import { FiDownload, FiShare2, FiFilter, FiExternalLink, FiMail, FiAlertCircle, FiCheck, FiThumbsUp, FiThumbsDown, FiUserCheck } from 'react-icons/fi';

interface LeadTableProps {
  leads: Lead[];
  onExportSheets: (leads: Lead[]) => void;
  onFeedback: (lead: Lead, feedback: Lead['feedback']) => void;
}

export default function LeadTable({ leads, onExportSheets, onFeedback }: LeadTableProps) {
  const [filterScore, setFilterScore] = useState<string>('all');
  const [filterReview, setFilterReview] = useState<string>('all');
  const [filterUniversity, setFilterUniversity] = useState<string>('all');

  const universities = useMemo(() => Array.from(new Set(leads.map(l => l.university).filter(Boolean))), [leads]);

  const filteredLeads = useMemo(() => {
    return leads.filter(lead => {
      if (filterScore !== 'all' && lead.qualityScore < parseInt(filterScore)) return false;
      if (filterReview !== 'all' && lead.reviewFlag !== filterReview) return false;
      if (filterUniversity !== 'all' && lead.university !== filterUniversity) return false;
      return true;
    });
  }, [leads, filterScore, filterReview, filterUniversity]);

  const exportCSV = () => {
    const headers = ['Name', 'LinkedIn', 'University', 'Field', 'Grad Year', 'Quality Score', 'Review Needed', 'Outreach'];
    const rows = filteredLeads.map(l => [
      `"${l.name}"`, `"${l.linkedinUrl}"`, `"${l.university}"`, `"${l.fieldOfStudy}"`, l.graduationYear, l.qualityScore, l.reviewFlag, `"${l.outreachMessage.replace(/"/g, '""')}"`
    ]);
    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'careerx_leads.csv';
    link.click();
  };

  return (
    <div className={styles.tableContainer}>
      <div className={styles.tableHeader}>
        <div>
          <h3>Qualified Leads ({filteredLeads.length})</h3>
          <p className="text-secondary text-sm">Aggressive filtering applied (Quality ≥ 6)</p>
        </div>
        <div className={styles.actions}>
          <button className="btn btn-secondary" onClick={exportCSV}><FiDownload className="mr-2"/> CSV</button>
          <button className="btn btn-primary" onClick={() => onExportSheets(filteredLeads)}><FiShare2 className="mr-2"/> Export CRM</button>
        </div>
      </div>

      <div className={styles.filtersPanel}>
        <div className={styles.filtersWrapper}>
          <select className="input-field" value={filterScore} onChange={e => setFilterScore(e.target.value)}>
            <option value="all">Any Quality</option>
            <option value="8">High Quality (8+)</option>
            <option value="7">Good Quality (7+)</option>
            <option value="6">Meeting Threshold (6+)</option>
          </select>
          <select className="input-field" value={filterReview} onChange={e => setFilterReview(e.target.value)}>
            <option value="all">Any Review Status</option>
            <option value="approved">Approved</option>
            <option value="review_needed">Needs Review</option>
          </select>
          <select className="input-field" value={filterUniversity} onChange={e => setFilterUniversity(e.target.value)}>
            <option value="all">All Universities</option>
            {universities.map(u => <option key={u} value={u}>{u}</option>)}
          </select>
        </div>
      </div>

      <div className={styles.tableWrapper}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Candidate & University</th>
              <th>Qual Score</th>
              <th>Guardrails</th>
              <th>Status</th>
              <th>Feedback (Loop)</th>
              <th>Outreach</th>
            </tr>
          </thead>
          <tbody>
            {filteredLeads.map(lead => (
              <tr key={lead.id} className={styles.tableRow}>
                <td>
                  <div className={styles.candidateInfo}>
                    <a href={lead.linkedinUrl} target="_blank" className={styles.candidateName}>
                      {lead.name} <FiExternalLink size={12}/>
                    </a>
                    <div className={styles.candidateHeadline}>{lead.university}</div>
                    <div className={styles.fieldItem}>{lead.degree} • {lead.fieldOfStudy} ({lead.graduationYear})</div>
                  </div>
                </td>
                <td>
                  <div className={`${styles.scoreBadge} ${lead.qualityScore >= 8 ? styles.scoreHigh : styles.scoreMedium}`}>
                    {lead.qualityScore}/10
                  </div>
                </td>
                <td>
                  <div className={styles.guardrailList}>
                    {lead.qualityBreakdown.indianOriginConfirmed && <span title="Indian Origin Confirmed">🇮🇳</span>}
                    {lead.qualityBreakdown.mastersStudent && <span title="Masters Student">🎓</span>}
                    {lead.qualityBreakdown.jobSearchIntent && <span title="Job Search Intent">🔎</span>}
                    {lead.qualityBreakdown.nonTier1University && <span title="Tier 2/3/4 University">🏛️</span>}
                  </div>
                </td>
                <td>
                  {lead.reviewFlag === 'review_needed' ? (
                    <span className={styles.reviewBadge}><FiAlertCircle/> Review</span>
                  ) : (
                    <span className={styles.approvedBadge}><FiCheck/> Approved</span>
                  )}
                </td>
                <td>
                  <div className={styles.feedbackLoop}>
                    <button 
                      className={`${styles.feedBtn} ${lead.feedback === 'good_lead' ? styles.feedActive : ''}`}
                      onClick={() => onFeedback(lead, 'good_lead')} title="Good Lead">
                      <FiThumbsUp/>
                    </button>
                    <button 
                      className={`${styles.feedBtn} ${lead.feedback === 'irrelevant_lead' ? styles.feedActiveIrrelevant : ''}`}
                      onClick={() => onFeedback(lead, 'irrelevant_lead')} title="Irrelevant Lead">
                      <FiThumbsDown/>
                    </button>
                    <button 
                      className={`${styles.feedBtn} ${lead.feedback === 'converted_lead' ? styles.feedActiveConverted : ''}`}
                      onClick={() => onFeedback(lead, 'converted_lead')} title="Converted">
                      <FiUserCheck/>
                    </button>
                  </div>
                </td>
                <td className={styles.messageColumn}>
                  <div className={styles.messageCard}>{lead.outreachMessage}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
