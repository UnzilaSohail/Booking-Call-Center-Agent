import { Check, Mic } from 'lucide-react';

// An animated "AI receptionist on a call" panel used on the sign-in and sign-up pages: the voice wave breathes and
// the conversation types in line by line, ending in a booking. It is decoration that explains the product in
// five seconds, so it is hidden from screen readers and stops moving for "reduce motion".
const LINES = [
  ['ai', 'Thanks for calling Glow Studio. How can I help?'],
  ['caller', 'Hi, can I get a haircut tomorrow afternoon?'],
  ['ai', 'Of course. I have 2:30 PM with Sam. Shall I book it?'],
  ['caller', 'Yes please.'],
  ['ai', "Done! You're booked. I've texted you a confirmation."],
];

export default function CallPreview() {
  return (
    <div className="call-card" aria-hidden="true">
      <div className="row" style={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'nowrap', marginBottom: 14 }}>
        <div className="row" style={{ alignItems: 'center', gap: 10, flexWrap: 'nowrap' }}>
          <span style={{ width: 34, height: 34, borderRadius: 12, background: 'rgba(255,255,255,.16)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><Mic size={17} /></span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14 }}>AI receptionist</div>
            <div style={{ fontSize: 12, opacity: 0.8 }}><span className="live-dot" style={{ width: 8, height: 8, marginRight: 6 }} />Live call</div>
          </div>
        </div>
        <span className="wave">{Array.from({ length: 12 }, (_, i) => <span key={i} style={{ '--i': i }} />)}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {LINES.map(([who, text], i) => <div key={i} className={`bubble ${who}`} style={{ '--i': i }}>{text}</div>)}
      </div>
      <div className="row" style={{ marginTop: 14, gap: 8 }}>
        <span className="bubble" style={{ '--i': 5.4, background: 'rgba(34,197,94,.22)', display: 'inline-flex', gap: 6, alignItems: 'center' }}><Check size={14} /> Booking created</span>
        <span className="bubble" style={{ '--i': 5.9, background: 'rgba(34,197,94,.22)', display: 'inline-flex', gap: 6, alignItems: 'center' }}><Check size={14} /> Confirmation sent</span>
      </div>
    </div>
  );
}
