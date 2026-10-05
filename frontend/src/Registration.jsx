import React, { useState } from 'react';
import { auth } from './auth';
import './styles.css';

export default function Registration({ onRegistered, onBackToLogin }) {
  const [step, setStep] = useState('details');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const requestOtp = async (event) => {
    event.preventDefault();
    setError('');
    setMessage('');
    setBusy(true);
    try {
      await auth.requestRegistrationOtp({ name, email, password });
      setStep('otp');
      setMessage('Your 6-digit verification code has been generated. Check the Render API logs.');
    } catch (err) {
      setError(err.message || 'Unable to start registration.');
    } finally {
      setBusy(false);
    }
  };

  const completeRegistration = async (event) => {
    event.preventDefault();
    setError('');
    setMessage('');
    setBusy(true);
    try {
      const result = await auth.register({ name, email, password, otp });
      onRegistered?.(result.session);
    } catch (err) {
      setError(err.message || 'Unable to complete registration.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="login-page">
      <section className="promo-panel" aria-label="PrimeBiller introduction">
        <div className="promo-overlay" />
        <div className="promo-content">
          <div className="brand" aria-label="Girder">
            <span>Girder</span>
          </div>
          <p className="eyebrow promo-eyebrow">SECURE <span>•</span> SIMPLE <span>•</span> BUSINESS READY</p>
          <div className="promo-copy">
            <h1>Start your<br />business<br />workspace.</h1>
            <p>Create the first account to become the permanent master administrator.</p>
          </div>
        </div>
      </section>

      <section className="form-panel" aria-label="Create account">
        <div className="top-action">
          <span>Already registered?</span>
          <button type="button" className="contact-button" onClick={onBackToLogin}>Sign in</button>
        </div>

        <div className="form-wrap">
          <p className="eyebrow">CREATE ACCOUNT</p>
          <h2>{step === 'details' ? 'Register your workspace' : 'Verify your email'}</h2>
          <p className="subtitle">
            {step === 'details'
              ? 'The first successfully verified registration becomes the permanent master admin.'
              : <>Enter the 6-digit OTP printed in the Render API logs for <strong>{email}</strong>.</>}
          </p>

          {step === 'details' ? (
            <form onSubmit={requestOtp} noValidate>
              <label htmlFor="register-name">Full name</label>
              <input id="register-name" type="text" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} />

              <label htmlFor="register-email">Email address</label>
              <input id="register-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />

              <label htmlFor="register-password">Password</label>
              <input id="register-password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />

              <button type="submit" className="primary-button" disabled={busy}>
                {busy ? 'Generating OTP…' : 'Continue'} <span aria-hidden="true">→</span>
              </button>
            </form>
          ) : (
            <form onSubmit={completeRegistration} noValidate>
              <label htmlFor="register-otp">6-digit OTP</label>
              <input
                id="register-otp"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                required
              />
              <button type="submit" className="primary-button" disabled={busy || otp.length !== 6}>
                {busy ? 'Creating account…' : 'Create account'} <span aria-hidden="true">→</span>
              </button>
              <button type="button" className="forgot-link" onClick={() => setStep('details')}>Edit registration details</button>
            </form>
          )}

          <div role="alert">{error && <p className="auth-feedback error">{error}</p>}</div>
          <div role="status" aria-live="polite">{message && !error && <p className="auth-feedback success">{message}</p>}</div>
        </div>

        <div className="legal-row">
          <div><a href="#privacy">Privacy Policy</a><span>•</span><a href="#terms">Terms of Service</a></div>
          <span>v1.0.0</span>
        </div>
      </section>
    </main>
  );
}
