'use client';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

export default function PhoneNumberSection() {
  const [phoneNumber, setPhoneNumber] = useState(null);
  const [areaCode, setAreaCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => { api.getPhoneNumber().then((r) => setPhoneNumber(r?.phone_number)).catch((e) => setError(e.message)); }, []);

  async function provision() {
    setLoading(true);
    setError(null);
    try {
      const { phoneNumber: purchased } = await api.provisionPhoneNumber(areaCode ? { areaCode } : {});
      setPhoneNumber(purchased);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card">
      <h2>Your business phone number</h2>
      {phoneNumber ? (
        <p>Customers call <strong>{phoneNumber}</strong> to book.</p>
      ) : (
        <>
          <p className="muted">This buys a real phone number for your business. It is added to your bill.</p>
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <div className="field"><label>Area code (optional)</label><input value={areaCode} onChange={(e) => setAreaCode(e.target.value)} placeholder="e.g. 415" /></div>
            <button className="primary" onClick={provision} disabled={loading}>{loading ? 'Getting your number...' : 'Get a phone number'}</button>
          </div>
        </>
      )}
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}
