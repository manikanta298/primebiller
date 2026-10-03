import React, { useEffect, useRef, useState } from 'react';
import { auth } from './auth';
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

const DEMO_EMAIL = import.meta.env.VITE_DEMO_EMAIL || 'manikantakambala12@gmail.com';

export default function Login({ onSignedIn }) {
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [email, setEmail] = useState(DEMO_EMAIL);
  const [password, setPassword] = useState('');
  const [authMessage, setAuthMessage] = useState('');
  const [authError, setAuthError] = useState('');
  const [isSigningIn, setIsSigningIn] = useState(false);

  const [resetOpen, setResetOpen] = useState(false);
  const [resetStep, setResetStep] = useState('request');
  const [resetEmail, setResetEmail] = useState(DEMO_EMAIL);
  const [resetOtp, setResetOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [resetMessage, setResetMessage] = useState('');
  const [resetError, setResetError] = useState('');
  const [isResetting, setIsResetting] = useState(false);

  // Dev/test bypass: the panel only renders when the API reports it is enabled.
  const [devEnabled, setDevEnabled] = useState(false);
  const [devKey, setDevKey] = useState('');
  const [devError, setDevError] = useState('');
  const [isDevSigningIn, setIsDevSigningIn] = useState(false);

  useEffect(() => {
    let mounted = true;
    auth.devBypassStatus().then((d) => { if (mounted) setDevEnabled(Boolean(d?.enabled)); }).catch(() => {});
    return () => { mounted = false; };
  }, []);

  const handleDevSignIn = async (event) => {
    event.preventDefault();
    setDevError('');
    setIsDevSigningIn(true);
    try {
      const session = await auth.devSignIn(devKey);
      setDevKey('');
      location.hash = '#/dashboard';
      onSignedIn?.(session);
    } catch (error) {
      setDevError(error.message || 'Unable to sign in with the dev key.');
    } finally {
      setIsDevSigningIn(false);
    }
  };

  const dialogRef = useRef(null);
  const resetEmailRef = useRef(null);
  const resetOtpRef = useRef(null);
  const newPasswordRef = useRef(null);
  const successButtonRef = useRef(null);
  const forgotLinkRef = useRef(null);
  const promoRef = useRef(null);
  const formPanelRef = useRef(null);

  // Hide everything behind the dialog from assistive tech and the tab order while it is open.
  useEffect(() => {
    const panels = [promoRef.current, formPanelRef.current].filter(Boolean);
    panels.forEach((el) => (resetOpen ? el.setAttribute('inert', '') : el.removeAttribute('inert')));
    return () => panels.forEach((el) => el.removeAttribute('inert'));
  }, [resetOpen]);

  // Move keyboard / screen-reader focus into the dialog, and to the right control whenever the step changes.
  // Without this the focused button is unmounted on a step change and focus drops to <body>.
  useEffect(() => {
    if (!resetOpen) return undefined;
    const target =
      resetStep === 'otp' ? resetOtpRef.current : resetStep === 'success' ? successButtonRef.current : resetEmailRef.current;
    const frame = requestAnimationFrame(() => target?.focus());
    return () => cancelAnimationFrame(frame);
  }, [resetOpen, resetStep]);

  const handleDialogKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      closePasswordReset();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = dialogRef.current?.querySelectorAll(
      'button:not([disabled]), input:not([disabled]), [href], select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    if (!focusable?.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setAuthMessage('');
    setAuthError('');
    setIsSigningIn(true);

    try {
      const session = await auth.signIn({ email, password, rememberMe: remember });
      setAuthMessage('Signed in successfully.');
      if (!location.hash || location.hash === '#') location.hash = '#/dashboard';
      onSignedIn?.(session);
    } catch (error) {
      setAuthError(error.message || 'Unable to sign in. Please check your email and password.');
    } finally {
      setIsSigningIn(false);
    }
  };

  const openPasswordReset = () => {
    setResetEmail(email || DEMO_EMAIL);
    setResetOtp('');
    setNewPassword('');
    setResetStep('request');
    setResetMessage('');
    setResetError('');
    setResetOpen(true);
  };

  const closePasswordReset = () => {
    if (isResetting) return;
    setResetOpen(false);
    requestAnimationFrame(() => forgotLinkRef.current?.focus());
  };

  const requestPasswordReset = async (event) => {
    event.preventDefault();
    setResetMessage('');
    setResetError('');
    setIsResetting(true);

    try {
      await auth.requestPasswordReset(resetEmail);
      setResetStep('otp');
      setResetMessage('A one-time password was sent to your email.');
    } catch (error) {
      setResetError(error.message || 'Unable to send the reset OTP.');
    } finally {
      setIsResetting(false);
    }
  };

  const confirmPasswordReset = async (event) => {
    event.preventDefault();
    setResetMessage('');
    setResetError('');

    if (!/^\d{6}$/.test(resetOtp)) {
      setResetError('Enter the 6-digit code from your email.');
      resetOtpRef.current?.focus();
      return;
    }
    if (newPassword.length < 8) {
      setResetError('New password must be at least 8 characters.');
      newPasswordRef.current?.focus();
      return;
    }

    setIsResetting(true);

    try {
      const data = await auth.resetPassword({
        email: resetEmail,
        otp: resetOtp,
        password: newPassword,
      });
      setPassword('');
      setNewPassword('');
      setResetOtp('');

      if (data?.session) {
        // The server signed the user in with a fresh session: hand it to the app and go to the dashboard.
        setResetOpen(false);
        location.hash = '#/dashboard';
        onSignedIn?.(data.session);
        return;
      }

      // Fallback if the server did not return a session.
      setResetStep('success');
      setResetMessage('Password reset successfully. You can now sign in.');
    } catch (error) {
      setResetError(error.message || 'Invalid or expired OTP.');
      resetOtpRef.current?.focus();
    } finally {
      setIsResetting(false);
    }
  };

  return (
    <main className="login-page">
      <section ref={promoRef} className="promo-panel" aria-label="Girder product introduction">
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

      <section ref={formPanelRef} className="form-panel" aria-label="Sign in">
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
              <button type="button" ref={forgotLinkRef} className="forgot-link" onClick={openPasswordReset}>Forgot password?</button>
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

            <button type="submit" className="primary-button" disabled={isSigningIn}>
              {isSigningIn ? 'Signing in…' : 'Sign in'} <span aria-hidden="true">→</span>
            </button>
            <div role="alert">{authError && <p className="auth-feedback error">{authError}</p>}</div>
            <div role="status" aria-live="polite">{authMessage && !authError && <p className="auth-feedback success">{authMessage}</p>}</div>
          </form>

          <div className="or-divider"><span>OR</span></div>
          <button type="button" className="google-button"><GoogleIcon /> <span>Continue with Google</span></button>

          {devEnabled && (
            <form className="dev-bypass" onSubmit={handleDevSignIn} aria-labelledby="dev-bypass-title">
              <h3 id="dev-bypass-title">Developer access (testing only)</h3>
              <p id="dev-bypass-hint" className="reset-hint">Skips email and password. Disable DEV_BYPASS_KEY before going live.</p>
              <label htmlFor="dev-key">Dev access key</label>
              <input id="dev-key" type="password" autoComplete="off" value={devKey} onChange={(e) => setDevKey(e.target.value)} aria-describedby="dev-bypass-hint" required />
              <button type="submit" className="dev-bypass-button" disabled={isDevSigningIn || !devKey} aria-busy={isDevSigningIn}>
                {isDevSigningIn ? 'Signing in…' : 'Open dashboard'}
              </button>
              <div role="alert">{devError && <p className="auth-feedback error">{devError}</p>}</div>
            </form>
          )}
        </div>

        <div className="legal-row">
          <div><a href="#privacy">Privacy Policy</a><span>•</span><a href="#terms">Terms of Service</a></div>
          <span>v1.0.0</span>
        </div>
      </section>

      {resetOpen && (
        <div className="reset-modal-backdrop" role="presentation" onMouseDown={closePasswordReset}>
          <section
            ref={dialogRef}
            className="reset-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="reset-title"
            aria-describedby="reset-copy"
            onMouseDown={(event) => event.stopPropagation()}
            onKeyDown={handleDialogKeyDown}
          >
            <button type="button" className="reset-close" onClick={closePasswordReset} aria-label="Close password reset">
              <span aria-hidden="true">×</span>
            </button>

            {resetStep === 'request' && (
              <>
                <p className="eyebrow">ACCOUNT RECOVERY</p>
                <h3 id="reset-title">Reset your password</h3>
                <p id="reset-copy" className="reset-copy">We’ll send a one-time password to your registered email address.</p>
                <form onSubmit={requestPasswordReset}>
                  <label htmlFor="reset-email">Email address</label>
                  <input
                    id="reset-email"
                    ref={resetEmailRef}
                    type="email"
                    autoComplete="email"
                    value={resetEmail}
                    onChange={(event) => setResetEmail(event.target.value)}
                    required
                  />
                  <button className="reset-primary" type="submit" disabled={isResetting} aria-busy={isResetting}>
                    {isResetting ? 'Sending OTP…' : 'Send OTP'}
                  </button>
                </form>
              </>
            )}

            {resetStep === 'otp' && (
              <>
                <p className="eyebrow">VERIFY OTP</p>
                <h3 id="reset-title">Enter your OTP</h3>
                <p id="reset-copy" className="reset-copy">
                  Enter the 6-digit code sent to <strong>{resetEmail}</strong>. The code expires in 5 minutes.
                </p>
                <form onSubmit={confirmPasswordReset}>
                  <label htmlFor="reset-otp">One-time password</label>
                  <input
                    id="reset-otp"
                    ref={resetOtpRef}
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    pattern="[0-9]{6}"
                    aria-describedby="reset-otp-hint"
                    aria-invalid={Boolean(resetError) && !/^\d{6}$/.test(resetOtp) ? 'true' : undefined}
                    value={resetOtp}
                    onChange={(event) => setResetOtp(event.target.value.replace(/\D/g, '').slice(0, 6))}
                    required
                  />
                  <span id="reset-otp-hint" className="reset-hint">6 digits, numbers only.</span>
                  <label htmlFor="new-password">New password</label>
                  <input
                    id="new-password"
                    ref={newPasswordRef}
                    aria-describedby="new-password-hint"
                    type="password"
                    autoComplete="new-password"
                    minLength={8}
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                    required
                  />
                  <span id="new-password-hint" className="reset-hint">At least 8 characters.</span>
                  <button className="reset-primary" type="submit" disabled={isResetting} aria-busy={isResetting}>
                    {isResetting ? 'Resetting…' : 'Reset password'}
                  </button>
                </form>
              </>
            )}

            {resetStep === 'success' && (
              <>
                <p className="eyebrow">PASSWORD UPDATED</p>
                <h3 id="reset-title">You’re all set</h3>
                <p id="reset-copy" className="reset-copy">Your password has been reset successfully.</p>
                <button
                  type="button"
                  ref={successButtonRef}
                  className="reset-primary"
                  onClick={() => {
                    setResetOpen(false);
                    setResetStep('request');
                    requestAnimationFrame(() => document.getElementById('password')?.focus());
                  }}
                >
                  Back to sign in
                </button>
              </>
            )}

            <div role="alert">{resetError && <p className="auth-feedback error">{resetError}</p>}</div>
            <div role="status" aria-live="polite">{resetMessage && !resetError && <p className="auth-feedback success">{resetMessage}</p>}</div>
          </section>
        </div>
      )}
    </main>
  );
}

