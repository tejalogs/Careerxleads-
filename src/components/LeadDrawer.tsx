'use client';
import { Lead } from '@/types';
import styles from './LeadTable.module.css';
import {
  FiExternalLink, FiAlertCircle, FiCheck,
  FiThumbsUp, FiThumbsDown, FiUserCheck,
  FiCopy, FiX as FiClose,
} from 'react-icons/fi';

const TIER_META: Record<1 | 2 | 3, { label: string; color: string; bg: string }> = {
  1: { label: 'Hot',  color: '#dc2626', bg: '#fef2f2' },
  2: { label: 'Warm', color: '#d97706', bg: '#fffbeb' },
  3: { label: 'Cold', color: '#64748b', bg: '#f8fafc' },
};

const STATUS_OPTIONS: Lead['status'][] = ['new', 'contacted', 'replied', 'call booked', 'converted'];
const STATUS_COLORS: Record<string, string> = {
  new:         '#64748b',
  contacted:   '#3b82f6',
  replied:     '#f59e0b',
  'call booked': '#8b5cf6',
  converted:   '#10b981',
};

interface LeadDrawerProps {
  lead: Lead;
  editedMessages: Record<string, string>;
  onClose: () => void;
  onEdit: (id: string, text: string) => void;
  onReset: (id: string) => void;
  onStatusChange: (id: string, status: Lead['status']) => void;
  onFeedback: (lead: Lead, fb: Lead['feedback']) => void;
}

export default function LeadDrawer({ lead, editedMessages, onClose, onEdit, onReset, onStatusChange, onFeedback }: LeadDrawerProps) {
  const outreachText = editedMessages[lead.id] ?? lead.outreachMessage;
  const statusColor = STATUS_COLORS[lead.status || 'new'];
  const tierMeta = lead.tier ? TIER_META[lead.tier] : null;

  return (
    <>
      <div className={styles.drawerOverlay} onClick={onClose} />
      <div className={styles.drawer} role="dialog" aria-modal="true" aria-label={`Lead details for ${lead.name}`}>
        <div className={styles.drawerHeader}>
          <div style={{ minWidth: 0 }}>
            <a href={lead.linkedinUrl} target="_blank" rel="noopener noreferrer" className={styles.drawerName}>
              {lead.name} <FiExternalLink size={12} aria-label="(opens in new tab)" />
            </a>
            {(lead.university || lead.degree || lead.fieldOfStudy) && (
              <p className={styles.drawerSub}>{[lead.university, lead.degree, lead.fieldOfStudy].filter(Boolean).join(' · ')}</p>
            )}
            {(lead.location || lead.graduationYear) && (
              <p className={styles.drawerSub}>{[lead.location, lead.graduationYear].filter(Boolean).join(' · ')}</p>
            )}
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexShrink: 0 }}>
            {tierMeta && (
              <span style={{ padding: '2px 9px', borderRadius: '4px', fontSize: '0.72rem', fontWeight: 700, background: tierMeta.bg, color: tierMeta.color, border: `1px solid ${tierMeta.color}40` }}>
                {tierMeta.label}
              </span>
            )}
            <button className={styles.drawerClose} onClick={onClose} aria-label="Close drawer"><FiClose size={15} /></button>
          </div>
        </div>

        {lead.headline && <p className={styles.drawerHeadline}>{lead.headline}</p>}

        <div className={styles.drawerSection}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <span className={styles.drawerSectionLabel}>Outreach Message</span>
            {editedMessages[lead.id] && (
              <button style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', background: 'none', border: 'none', cursor: 'pointer' }}
                onClick={() => onReset(lead.id)}>Reset</button>
            )}
          </div>
          <textarea
            className={styles.drawerTextarea}
            value={outreachText}
            onChange={e => onEdit(lead.id, e.target.value)}
            rows={9}
            aria-label="Outreach message"
          />
        </div>

        {(lead.email || lead.phone) && (
          <div className={styles.drawerSection}>
            <span className={styles.drawerSectionLabel}>Contact</span>
            <div style={{ marginTop: '0.4rem', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              {lead.email && (
                <div className={styles.emailCell}>
                  <span className={styles.emailText}>{lead.email}</span>
                  <button className={styles.copyBtn} onClick={() => navigator.clipboard.writeText(lead.email!)} title="Copy email"><FiCopy size={11} /></button>
                </div>
              )}
              {lead.phone && (
                <div className={styles.emailCell}>
                  <span className={styles.emailText} style={{ color: '#16a34a' }}>📱 {lead.phone}</span>
                  <button className={styles.copyBtn} onClick={() => navigator.clipboard.writeText(lead.phone!)} title="Copy WhatsApp / phone"><FiCopy size={11} /></button>
                </div>
              )}
            </div>
          </div>
        )}

        <div className={styles.drawerSection}>
          <span className={styles.drawerSectionLabel}>Status</span>
          <select
            className={styles.statusSelect}
            value={lead.status || 'new'}
            onChange={e => onStatusChange(lead.id, e.target.value as Lead['status'])}
            style={{ marginTop: '0.4rem', width: '100%', borderColor: `${statusColor}80`, color: statusColor, backgroundColor: `${statusColor}12` }}
            aria-label={`Status for ${lead.name}`}
          >
            {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        <div className={styles.drawerSection}>
          <span className={styles.drawerSectionLabel}>Feedback</span>
          <div className={styles.feedbackLoop} style={{ marginTop: '0.5rem' }}>
            <button className={`${styles.feedBtn} ${lead.feedback === 'good_lead' ? styles.feedActive : ''}`}
              onClick={() => onFeedback(lead, 'good_lead')} title="Good Lead"><FiThumbsUp size={13} /></button>
            <button className={`${styles.feedBtn} ${lead.feedback === 'irrelevant_lead' ? styles.feedActiveIrrelevant : ''}`}
              onClick={() => onFeedback(lead, 'irrelevant_lead')} title="Irrelevant"><FiThumbsDown size={13} /></button>
            <button className={`${styles.feedBtn} ${lead.feedback === 'converted_lead' ? styles.feedActiveConverted : ''}`}
              onClick={() => onFeedback(lead, 'converted_lead')} title="Converted"><FiUserCheck size={13} /></button>
          </div>
        </div>

        <div className={styles.drawerSection}>
          <span className={styles.drawerSectionLabel}>Review</span>
          <div style={{ marginTop: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
            {lead.reviewFlag === 'review_needed'
              ? <span className={styles.reviewBadge}><FiAlertCircle size={11} /> Needs Review</span>
              : <span className={styles.approvedBadge}><FiCheck size={11} /> Approved</span>}
            {lead.optDaysRemaining !== undefined && lead.optDaysRemaining <= 30 && (
              <span title={`~${lead.optDaysRemaining} days remaining on 90-day OPT unemployment clock — contact TODAY`}
                style={{ fontSize: '0.72rem', fontWeight: 700, color: '#dc2626', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: '4px', padding: '2px 7px' }}>
                🚨 URGENT — {lead.optDaysRemaining}d OPT left
              </span>
            )}
            {lead.struggleScore !== undefined && (
              <span title="Struggle Score: profile-gap signals (grad gap, no internship, visa struggle, thin profile)"
                style={{ fontSize: '0.72rem', fontWeight: 600, color: (lead.struggleScore ?? 0) >= 6 ? '#dc2626' : '#d97706', background: (lead.struggleScore ?? 0) >= 6 ? '#fef2f2' : '#fffbeb', border: `1px solid ${(lead.struggleScore ?? 0) >= 6 ? '#fca5a5' : '#fde68a'}`, borderRadius: '4px', padding: '2px 7px' }}>
                🔥 Struggle {lead.struggleScore}/10{lead.universityTier && ` · Uni T${lead.universityTier}`}
              </span>
            )}
            {lead.networkingScore !== undefined && lead.networkingScore <= 4 && (
              <span title={`Networking Score: ${lead.networkingScore}/10 — service-company trap. Insular Desi network, no product-company exposure. CareerX is their only bridge.`}
                style={{ fontSize: '0.72rem', fontWeight: 600, color: '#7c3aed', background: '#f5f3ff', border: '1px solid #ddd6fe', borderRadius: '4px', padding: '2px 7px' }}>
                🕸 Network Trap {lead.networkingScore}/10
              </span>
            )}
            {(lead.regionalTag || lead.detectedLanguage) && (
              <span title={`Regional tag: ${lead.regionalTag || lead.detectedLanguage} (via 4-signal combinator: undergrad uni > language > org > surname). Regional anchor included in outreach.`}
                style={{ fontSize: '0.72rem', fontWeight: 600, color: '#0369a1', background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: '4px', padding: '2px 7px' }}>
                🗣 {lead.regionalTag || lead.detectedLanguage}
              </span>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
