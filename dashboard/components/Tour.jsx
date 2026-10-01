'use client';
import { useState } from 'react';
import Link from 'next/link';
import Modal from './Modal';

// Four-step first-run tour (Jira 26b): what the product does and the order to set it up in.
// Shown once on the first visit to the Overview while setup is unfinished; "Take the tour" replays it.
const STEPS = [
  { title: 'Welcome', body: 'This is where you run your bookings. Customers book by phone with your AI agent, or online with your booking link. Everything lands in one calendar.' },
  { title: '1. Add your services', body: 'Tell the system what customers can book, how long it takes and what it costs. The AI and your booking page both read this list.', link: { href: '/services', label: 'Go to Services' } },
  { title: '2. Get your phone line', body: 'Pick a business phone number and an AI voice, then make a test call. The setup guide walks you through each step.', link: { href: '/onboarding', label: 'Open the setup guide' } },
  { title: '3. Share your booking link', body: 'Every business gets a booking page. Copy the link into your website, Instagram or a QR code, and decide if you want to appear in the public directory.', link: { href: '/settings#booking', label: 'Open booking settings' } },
];

export default function Tour({ onClose }) {
  const [i, setI] = useState(0);
  const step = STEPS[i];
  return (
    <Modal title={step.title} onClose={onClose} width={440}>
      <p style={{ margin: '4px 0 12px' }}>{step.body}</p>
      {step.link && <p style={{ margin: '0 0 14px' }}><Link href={step.link.href} onClick={onClose}>{step.link.label}</Link></p>}
      <div className="stepper" role="img" aria-label={`Step ${i + 1} of ${STEPS.length}`}>
        {STEPS.map((_, k) => <div key={k} className={`dot${k < i ? ' done' : k === i ? ' current' : ''}`} />)}
      </div>
      <div className="row" style={{ justifyContent: 'space-between', marginTop: 12 }}>
        <button type="button" className="ghost" onClick={onClose}>Skip tour</button>
        <div className="row">
          {i > 0 && <button type="button" onClick={() => setI(i - 1)}>Back</button>}
          {i < STEPS.length - 1
            ? <button type="button" className="primary" onClick={() => setI(i + 1)}>Next</button>
            : <button type="button" className="primary" onClick={onClose}>Done</button>}
        </div>
      </div>
    </Modal>
  );
}
