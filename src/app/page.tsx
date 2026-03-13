'use client';

import React, { useState } from 'react';
import GuidedFlow from '@/components/GuidedFlow';
import LeadTable from '@/components/LeadTable';
import { GenerationParams, Lead } from '@/types';
import { FiLoader, FiCheckCircle, FiDatabase, FiTarget, FiMessageSquare, FiAlertTriangle, FiRefreshCw } from 'react-icons/fi';
import styles from './page.module.css';

export default function Home() {
  const [phase, setPhase] = useState<'gathering' | 'processing' | 'results' | 'error'>('gathering');
  const [processingStep, setProcessingStep] = useState(0);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [isExporting, setIsExporting] = useState(false);
  const [exportComplete, setExportComplete] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const handleFlowComplete = async (params: GenerationParams) => {
    setPhase('processing');
    setErrorMessage('');
    
    try {
      // Step 1: Generate Strategy
      setProcessingStep(1);
      const strategyRes = await fetch('/api/generate-strategy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params)
      });
      
      if (!strategyRes.ok) {
        const errorData = await strategyRes.json();
        throw new Error(errorData.error || 'Failed to generate strategy');
      }
      const strategy = await strategyRes.json();

      // Step 2: Scrape Profiles from Apify
      setProcessingStep(2);
      const scrapeRes = await fetch('/api/scrape-leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ strategy, params })
      });
      
      if (!scrapeRes.ok) {
        const errorData = await scrapeRes.json();
        throw new Error(errorData.error || 'Failed to scrape leads');
      }
      const { profiles } = await scrapeRes.json();

      // Step 3: Grade and filter via AI
      setProcessingStep(3);
      const qualifyRes = await fetch('/api/qualify-leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profiles: profiles || [], params })
      });
      
      if (!qualifyRes.ok) {
        const errorData = await qualifyRes.json();
        throw new Error(errorData.error || 'Qualification engine failure');
      }
      const data = await qualifyRes.json();
      
      setLeads(data.leads || []);
      
      // Step 4: Done
      setTimeout(() => {
        setPhase('results');
      }, 1000);

    } catch (error: any) {
      console.error('Lead generation failed:', error);
      setErrorMessage(error.message || 'An unexpected error occurred during lead discovery.');
      setPhase('error');
    }
  };

  const handleExportSheets = async (filteredLeads: Lead[]) => {
    setIsExporting(true);
    setExportComplete(false);
    try {
      const res = await fetch('/api/export-sheets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leads: filteredLeads })
      });
      if (res.ok) {
        setExportComplete(true);
        setTimeout(() => setExportComplete(false), 3000);
      } else {
        throw new Error('Export failed');
      }
    } catch (error) {
      console.error('Export error:', error);
      alert('Failed to export to Google Sheets');
    } finally {
      setIsExporting(false);
    }
  };

  const handleLeadFeedback = async (lead: Lead, feedback: Lead['feedback']) => {
    setLeads(prev => prev.map(l => 
      l.id === lead.id ? { ...l, feedback } : l
    ));

    try {
      await fetch('/api/lead-feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId: lead.id, linkedinUrl: lead.linkedinUrl, feedback })
      });
    } catch (e) {
      console.error('Failed to send feedback:', e);
    }
  };

  return (
    <div className="container">
      {phase === 'gathering' && (
        <div className="animate-fade-in">
          <div className={styles.heroSection}>
            <h1 className="text-gradient">CareerXcelerator Discovery</h1>
            <p style={{ color: 'var(--text-secondary)' }}>Identify high-intent candidates globally. Our AI browses platforms, applies strict quality guardrails, and exports vetted leads directly to your workspace.</p>
          </div>
          <GuidedFlow onComplete={handleFlowComplete} />
        </div>
      )}

      {phase === 'processing' && (
        <div className={`${styles['processing-container']} animate-fade-in`}>
          <div className={`glass-panel ${styles['processing-card']}`}>
            <div className={styles['processing-header']}>
              <div className={styles.pulseRing}></div>
              <FiLoader className={styles.spinner} size={48} />
              <h2 style={{ marginTop: '1.5rem' }} className="text-gradient">CareerXcelerator Agent at Work</h2>
              <p style={{ color: 'var(--text-secondary)' }}>Applying strict guardrails and filtering noise...</p>
            </div>

            <div className={styles.processingSteps}>
              <div className={`${styles.step} ${processingStep >= 1 ? styles.stepActive : ''}`}>
                <div className={styles.stepIcon}>{processingStep > 1 ? <FiCheckCircle /> : <FiTarget />}</div>
                <div className={styles.stepText}>
                  <h4>Formulating Search Strategy</h4>
                  <p>Analyzing parameters to find the best platforms and queries</p>
                </div>
              </div>
              <div className={`${styles.step} ${processingStep >= 2 ? styles.stepActive : ''}`}>
                <div className={styles.stepIcon}>{processingStep > 2 ? <FiCheckCircle /> : <FiDatabase />}</div>
                <div className={styles.stepText}>
                  <h4>Gathering Profiles</h4>
                  <p>Running Apify actors to collect potential leads</p>
                </div>
              </div>
              <div className={`${styles.step} ${processingStep >= 3 ? styles.stepActive : ''}`}>
                <div className={styles.stepIcon}>{processingStep > 3 ? <FiCheckCircle /> : <FiMessageSquare />}</div>
                <div className={styles.stepText}>
                  <h4>Strict Qualification (12 Guardrails)</h4>
                  <p>Rejecting irrelevant profiles and scoring for high intent</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

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

      {phase === 'results' && (
        <div className="animate-fade-in">
          {exportComplete && (
            <div className={styles.exportSuccessToast}>
              <FiCheckCircle size={20} /> Successfully exported to Google Sheets!
            </div>
          )}
          
          <div className={styles.resultsHeader}>
            <div>
              <h1 className="text-gradient">Qualified Leads Found</h1>
              <p style={{ color: 'var(--text-secondary)' }}>Quality Score threshold (≥6) applied to all results.</p>
            </div>
            <button className="btn btn-secondary" onClick={() => setPhase('gathering')}>
              Start New Search
            </button>
          </div>
          
          <LeadTable 
            leads={leads} 
            onExportSheets={handleExportSheets} 
            onFeedback={handleLeadFeedback}
          />
        </div>
      )}
    </div>
  );
}
