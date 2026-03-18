import React, { useState, useRef, useMemo, useEffect } from 'react';
import styles from './GuidedFlow.module.css';
import { FiSend, FiArrowRight, FiCommand, FiCheckCircle, FiDollarSign, FiInfo } from 'react-icons/fi';
import { GenerationParams } from '@/types';

interface Message {
  id: string;
  sender: 'ai' | 'user';
  text: string;
}

interface Question {
  key: keyof GenerationParams;
  text: string;
  examples: string[];
  options?: string[];
}

// Questions asked in the flow. currentLocation, stage, audience, targetCities are
// derived automatically from answers rather than asked explicitly.
const questions: Question[] = [
  {
    key: 'originCountry',
    text: 'Which origin country should we target for this batch?',
    examples: ['India', 'China', 'Nigeria', 'Philippines', 'Bangladesh', 'Diverse Global Students']
  },
  {
    key: 'fields',
    text: 'Which domain or field of study are we focusing on?',
    examples: [
      'Any Domain (all fields)',
      'Computer Science / Software Engineering',
      'Data Science / AI / Machine Learning',
      'Cybersecurity / Cloud / DevOps',
      'Business Analytics / Finance / Fintech',
      'Product Management / UX Design',
      'Electrical / Mechanical Engineering',
      'Bio-Medical / Healthcare / Pharma',
      'Marketing / Operations / Consulting'
    ]
  },
  {
    key: 'graduationYear',
    text: 'Which graduation cohort(s) should we target?',
    options: [
      '2024 & 2025 (recent grads — high urgency)',
      '2025 & 2026 (graduating this year + next)',
      '2026 & 2027 (current students — internship prep)',
      '2024, 2025 & 2026 (all recent cohorts)'
    ],
    examples: []
  },
  {
    key: 'visaStatus',
    text: 'Which destination country are these candidates in?',
    options: [
      'United States (OPT / CPT / H1B)',
      'United Kingdom (Graduate Visa / Tier 2)',
      'Canada (PGWP / Express Entry)',
      'Ireland / Australia / UAE / Europe'
    ],
    examples: []
  },
  {
    key: 'opportunityTypes',
    text: 'Which role type are we recruiting / sourcing leads for?',
    options: [
      'Internships (students actively seeking)',
      'Entry-level Full-time (new grads)',
      'Experienced Hire / Lateral Switch',
      'Upskilling / Bootcamp / Research'
    ],
    examples: []
  },
  {
    key: 'leadCount',
    text: 'How many vetted leads (quality score ≥6) should the agent find? (max 100 per run)',
    examples: ['25', '50', '75', '100']
  }
];

interface GuidedFlowProps {
  onComplete: (params: GenerationParams) => void;
}

export default function GuidedFlow({ onComplete }: GuidedFlowProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [messages, setMessages] = useState<Message[]>([
    { id: '1', sender: 'ai', text: questions[0].text }
  ]);
  const [inputValue, setInputValue] = useState('');
  const [answers, setAnswers] = useState<Partial<GenerationParams>>({});
  const latestAnswers = useRef<Partial<GenerationParams>>({});
  const [isGenerating, setIsGenerating] = useState(false);
  const [aiBudget, setAiBudget] = useState<{ total: number; apify: number; ai: number; complexity: string } | null>(null);
  const [isEstimating, setIsEstimating] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to latest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const currentQuestion = questions[currentStep];

  const handleSend = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    // Validate: free-text questions require at least 2 characters
    if (!currentQuestion?.options && trimmed.length < 2) return;
    
    // Add user message
    const newMessages = [
      ...messages,
      { id: Date.now().toString(), sender: 'user' as const, text }
    ];
    
    setMessages(newMessages);
    setInputValue('');

    // Clamp leadCount to 100 max
    const value = currentQuestion.key === 'leadCount'
      ? String(Math.min(100, Math.max(1, parseInt(text.match(/\d+/)?.[0] || '50', 10) || 50)))
      : text;
    const newAnswers = { ...answers, [currentQuestion.key]: value };
    setAnswers(newAnswers);
    latestAnswers.current = newAnswers; // #6: keep ref in sync

    if (currentStep < questions.length - 1) {
      // Simulate slight delay for AI typing feel
      setTimeout(() => {
        setMessages(prev => [
          ...prev,
          { id: (Date.now() + 1).toString(), sender: 'ai', text: questions[currentStep + 1].text }
        ]);
        setCurrentStep(currentStep + 1);
      }, 500);
    } else {
      // Flow complete - Start AI Estimation
      setIsEstimating(true);
      setMessages(prev => [
        ...prev,
        { id: (Date.now() + 1).toString(), sender: 'ai', text: "Analyzing your requirements to estimate the discovery budget and server resources..." }
      ]);

      // Call AI Estimation API
      fetch('/api/estimate-budget', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ params: newAnswers })
      })
      .then(res => res.json())
      .then(estimate => {
        setAiBudget(estimate);
        setIsEstimating(false);
        
        setTimeout(() => {
          setMessages(prev => [
            ...prev,
            { id: (Date.now() + 2).toString(), sender: 'ai', text: `Based on your target audience, this is a ${estimate.complexity}-complexity discovery. I've calculated the budget in the sidebar. Ready to initiate the discovery strategy?` }
          ]);
        }, 1000);
      })
      .catch(err => {
        // #12: show fallback budget and let the user proceed — estimation is not blocking
        console.error('Estimation failed:', err);
        const count = parseInt((newAnswers.leadCount as string) || '100', 10) || 100;
        setAiBudget({ total: count * 0.007, apify: count * 0.005, ai: count * 0.002, complexity: 'Medium' });
        setIsEstimating(false);
        setTimeout(() => {
          setMessages(prev => [
            ...prev,
            { id: (Date.now() + 2).toString(), sender: 'ai', text: "Budget estimation unavailable — using standard rates. You can still proceed with discovery." }
          ]);
        }, 500);
      });
    }
  };

  const handleBeginDiscovery = () => {
    setIsGenerating(true);
    setTimeout(() => {
      const a = latestAnswers.current;
      const oppType = (a.opportunityTypes || '').toLowerCase();
      const isIntern  = oppType.includes('intern');
      const isLateral = oppType.includes('lateral');

      // Derive fields not asked explicitly in the flow
      const derived: Partial<GenerationParams> = {
        audience: isIntern
          ? 'Current Students / Masters Students (Seeking Internships)'
          : isLateral
          ? 'Working Professionals (3-7 yrs exp, career switch)'
          : 'Recent Graduates / Early Professionals (Job Hunting)',
        currentLocation: a.visaStatus || 'United States',
        stage: isIntern
          ? 'Current Student (Seeking Internships)'
          : isLateral
          ? 'Working Professional (3-7 yrs exp)'
          : 'Recent Graduate (Job Hunting)',
        targetCities: 'All major tech hubs',
      };

      onComplete({ ...derived, ...a } as GenerationParams);
    }, 800);
  };

  const currentLeadGoal = useMemo(() => {
    const raw = answers.leadCount as string;
    if (!raw) return 100;
    const match = raw.match(/\d+/);
    return match ? parseInt(match[0]) : 100;
  }, [answers.leadCount]);
  const apifyCost = aiBudget?.apify ?? (currentLeadGoal * 0.005);
  const aiCost = aiBudget?.ai ?? (currentLeadGoal * 0.002);
  const totalCost = aiBudget?.total ?? (apifyCost + aiCost);

  return (
    <div className={styles.flowContainer}>
      <div className={styles.chatArea}>
        <div className={styles.chatHeader}>
          <div className={styles.aiAvatar}>
            <img src="/logo.png" alt="Branding" width={24} height={24} />
          </div>
          <div>
            <h3>CareerX Agent</h3>
            <p className="text-secondary text-sm">Online • Ready to discover leads</p>
          </div>
        </div>

        <div className={styles.messageList}>
          {messages.map((msg) => (
            <div key={msg.id} className={`${styles.messageWrapper} ${msg.sender === 'user' ? styles.userWrapper : styles.aiWrapper}`}>
              <div className={`${styles.message} ${msg.sender === 'user' ? styles.userMessage : styles.aiMessage}`}>
                {msg.text}
              </div>
            </div>
          ))}
          {isGenerating && (
            <div className={`${styles.messageWrapper} ${styles.aiWrapper}`}>
              <div className={`${styles.message} ${styles.aiMessage} ${styles.typingIndicator}`}>
                <span></span><span></span><span></span>
              </div>
            </div>
          )}
          
          {aiBudget && !isGenerating && (
            <div className={styles.confirmAction}>
              <button className="btn btn-primary" onClick={handleBeginDiscovery}>
                Initiate Discovery Agent <FiArrowRight className="ml-2" />
              </button>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {!isGenerating && currentQuestion && (
          <div className={styles.inputArea}>
            {currentQuestion.options ? (
              <div className={styles.optionsGrid}>
                {currentQuestion.options.map(opt => (
                  <button 
                    key={opt}
                    className={styles.optionBtn}
                    onClick={() => handleSend(opt)}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            ) : (
              <div className="flex-col gap-2">
                {currentQuestion.examples && currentQuestion.examples.length > 0 && (
                  <div className={styles.examples}>
                    <span className="text-sm text-secondary">Examples: </span>
                    <div className={styles.exampleChips}>
                      {currentQuestion.examples.map(ex => (
                        <button key={ex} className={styles.chip} onClick={() => handleSend(ex)}>
                          {ex}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <div className={styles.inputForm}>
                  <input
                    type="text"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSend(inputValue);
                    }}
                    placeholder="Type your answer here..."
                    className={styles.textInput}
                    autoFocus
                  />
                  <button 
                    className={styles.sendBtn}
                    onClick={() => handleSend(inputValue)}
                    disabled={!inputValue.trim()}
                  >
                    <FiSend />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      
      <div className={styles.sidebar}>
        <div className={styles.progressCard}>
          <h3>Discovery Setup Context</h3>
          <p className="text-sm text-secondary mb-4">I use this information to calculate the best platforms and search terms to discover your ideal candidates.</p>
          
          <ul className={styles.progressList}>
            {questions.map((q, idx) => (
              <li key={q.key} className={`${styles.progressItem} ${idx < currentStep ? styles.completed : idx === currentStep ? styles.active : ''}`}>
                <div className={styles.stepIndicator}>
                  {idx < currentStep ? <FiCheckCircle /> : <span>{idx + 1}</span>}
                </div>
                <div className={styles.stepContent}>
                  <span className={styles.stepLabel}>{q.text}</span>
                  {idx < currentStep && <span className={styles.stepAnswer}>{answers[q.key]}</span>}
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className={styles.costCard}>
           <div className={styles.costHeader}>
             <FiDollarSign size={18} color="var(--accent-primary)" />
             <div className="flex-col">
               <h3>Estimated Discovery Budget</h3>
               <span className="text-xs text-secondary">
                 {isEstimating ? 'AI Estimating...' : 
                  aiBudget ? `${aiBudget.complexity} Complexity` : 
                  'Awaiting specs...'}
               </span>
             </div>
           </div>
           
           <div className={styles.meterContainer}>
             <div className={styles.meterLabels}>
               <span className="text-xs text-secondary">Total Est. Cost</span>
               <span className={`font-semibold text-primary ${isEstimating ? 'animate-pulse' : ''}`} style={{ fontSize: '1.25rem' }}>
                 {isEstimating ? '---' : `$${totalCost.toFixed(2)}`}
               </span>
             </div>
             <div className={styles.meterTrack}>
                <div 
                  className={`${styles.meterFill} ${isEstimating ? styles.meterLoading : ''}`} 
                  style={{ width: isEstimating ? '100%' : `${Math.min((currentLeadGoal / 1000) * 100, 100)}%` }}
                ></div>
             </div>
           </div>

           <div className={styles.costBreakdown}>
             <div className={styles.breakdownItem}>
                <div className={styles.breakdownDot} style={{ background: 'var(--accent-primary)' }}></div>
                <div className="flex-between flex-1">
                  <span>Apify Scraper</span>
                  <span className="font-medium">${apifyCost.toFixed(2)}</span>
                </div>
             </div>
             <div className={styles.breakdownItem}>
                <div className={styles.breakdownDot} style={{ background: 'var(--accent-secondary)' }}></div>
                <div className="flex-between flex-1">
                  <span>AI Qualification</span>
                  <span className="font-medium">${aiCost.toFixed(2)}</span>
                </div>
             </div>
           </div>

           <div className={styles.costInfo}>
             <FiInfo size={14} className="mt-1" />
             <p>Estimates include API credits and platform fees. Final cost scales with profile complexity.</p>
           </div>
        </div>
      </div>
    </div>
  );
}
