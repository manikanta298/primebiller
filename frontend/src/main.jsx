import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const features = [
  ['warehouse', 'Multi-godown inventory'],
  ['box', 'Batch & expiry tracking'],
  ['invoice', 'GST ready invoices'],
  ['stock', 'Real-time stock visibility'],
  ['growth', 'Built for growing businesses'],
];

function Logo() {
  return (
    <div className="brand" aria-label="Girder">
      <svg className="brand-mark" viewBox="0 0 48 48" aria-hidden="true">
        <path d="M24 4 41 14v20L24 44 7 34V14L24 4Z" fill="none" stroke="currentColor" strokeWidth="4"/>
        <path d="m14 17 10 6 10-6M14 31l10 6 10-6M24 23v14" fill="none" stroke="currentColor" strokeWidth="4" strokeLinejoin="round"/>
      </svg>
      <span>Girder</span>
    </div>
  );
}

function FeatureIcon({ type }) {
  const common = { width: 21, height: 21, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' };
  if (type === 'warehouse') return <svg {...common}><path d="M3 10 12 4l9 6v10H3z"/><path d="M7 21v-7h10v7M8 10h.01M12 10h.01M16 10h.01"/></svg>;
  if (type === 'box') return <svg {...common}><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/></svg>;
  if (type === 'invoice') return <svg {...common}><path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z"/><path d="M9 8h6M9 12h6M9 16h3"/></svg>;
  if (type === 'stock') return <svg {...common}><path d="M4 19V5M4 19h16"/><path d="m7 15 4-4 3 2 5-6"/></svg>;
  return <svg {...common}><path d="M4 17 10 11l4 4 6-7"/><path d="M15 8h5v5"/></svg>;
}

function MailIcon() {
  return <svg className="field-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4 7 8 6 8-6"/></svg>;
}

function LockIcon() {
  return <svg className="field-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>;
}

function EyeIcon({ hidden }) {
  return hidden
    ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 4.3A11.7 11.7 0 0 1 12 4c5.5 0 9 5 9 8a8.6 8.6 0 0 1-2.1 3.8M6.3 6.3C4.2 7.8 3 10.1 3 12c0 3 3.5 8 9 8 1 0 2-.2 2.9-.5"/></svg>
    : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12s3.5-7 9-7 9 7 9 7-3.5 7-9 7-9-7-9-7Z"/><circle cx="12" cy="12" r="2.5"/></svg>;
}

function GoogleIcon() {
  return <svg className="google-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.4a4.7 4.7 0 0 1-2 3.1v2.6h3.2c1.9-1.8 3-4.3 3-7.5Z"/><path fill="#34A853" d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.6c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.2H3.1v2.7A10 10 0 0 0 12 22Z"/><path fill="#FBBC05" d="M6.4 13.8a6 6 0 0 1 0-3.6V7.5H3.1a10 10 0 0 0 0 9l3.3-2.7Z"/><path fill="#EA4335" d="M12 6c1.5 0 2.8.5 3.9 1.6l2.9-2.9C17 3 14.7 2 12 2a10 10 0 0 0-8.9 5.5l3.3 2.7C7.2 7.8 9.4 6 12 6Z"/></svg>;
}

function App() {
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = (event) => {
    event.preventDefault();
  };

  return (
    <main className="login-page">
      <section className="promo-panel" aria-label="Girder product introduction">
        <div className="promo-overlay" />
        <div className="promo-content">
          <Logo />
          <p className="eyebrow promo-eyebrow">INVENTORY <span>•</span> ORDERS <span>•</span> INVOICES <span>•</span> GROWTH</p>

          <div className="promo-copy">
            <h1>Everything<br />your business<br />keeps moving.</h1>
            <p>Manage inventory, sales orders, delivery challans,<br className="desktop-only" /> GST invoices and more — all in one place.</p>
            <ul className="feature-list">
              {features.map(([icon, label]) => (
                <li key={label}><span className="feature-icon"><FeatureIcon type={icon} /></span><span>{label}</span></li>
              ))}
            </ul>
          </div>

          <div className="promo-footer">
            <span className="footer-rule" />
            <p>STOCK TODAY. A STRONGER TOMORROW.</p>
          </div>
        </div>
      </section>

      <section className="form-panel" aria-label="Sign in">
        <div className="top-action">
          <span>New to Girder?</span>
          <button type="button" className="contact-button">Contact us</button>
        </div>

        <div className="form-wrap">
          <p className="eyebrow">WELCOME BACK</p>
          <h2>Sign in to Girder</h2>
          <p className="subtitle">Access your organization and keep things moving.</p>

          <form onSubmit={handleSubmit} noValidate>
            <label htmlFor="email">Email address</label>
            <div className="input-wrap">
              <MailIcon />
              <input id="email" type="email" autoComplete="email" placeholder="you@company.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>

            <div className="password-label-row">
              <label htmlFor="password">Password</label>
              <button type="button" className="forgot-link">Forgot password?</button>
            </div>
            <div className="input-wrap">
              <LockIcon />
              <input id="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" placeholder="Enter your password" value={password} onChange={(e) => setPassword(e.target.value)} />
              <button type="button" className="password-toggle" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword((value) => !value)}><EyeIcon hidden={!showPassword} /></button>
            </div>

            <div className="form-options">
              <label className="remember-label">
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                <span className="checkmark">✓</span>
                <span>Keep me signed in</span>
              </label>
            </div>

            <button type="submit" className="primary-button">Sign in <span aria-hidden="true">→</span></button>
          </form>

          <div className="or-divider"><span>OR</span></div>
          <button type="button" className="google-button"><GoogleIcon /> <span>Continue with Google</span></button>
        </div>

        <div className="legal-row">
          <div><a href="#privacy">Privacy Policy</a><span>•</span><a href="#terms">Terms of Service</a></div>
          <span>v1.0.0</span>
        </div>
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
