// Call transcripts are stored as plain text ("AI: ...", "Caller: ..."); show them as a chat. Text that doesn't
// follow that shape falls back to the original preformatted block.
const SPEAKER = /^\s*(AI|Agent|Assistant|Receptionist|Caller|Customer|User)\s*:\s*(.*)$/i;

export default function Transcript({ text }) {
  const msgs = [];
  for (const line of String(text ?? '').split('\n')) {
    const m = SPEAKER.exec(line);
    if (m) msgs.push({ ai: /^(ai|agent|assistant|receptionist)$/i.test(m[1]), text: m[2] });
    else if (line.trim() && msgs.length) msgs[msgs.length - 1].text += `\n${line}`;
    else if (line.trim()) return <div style={{ padding: '10px 12px', whiteSpace: 'pre-wrap', fontSize: 12.5 }}>{text}</div>;
  }
  if (!msgs.length) return null;
  return (
    <div className="chat">
      {msgs.map((m, i) => (
        <div key={i} className={`msg ${m.ai ? 'ai' : 'caller'}`}>
          <div className="who">{m.ai ? 'AI receptionist' : 'Caller'}</div>{m.text}
        </div>
      ))}
    </div>
  );
}
