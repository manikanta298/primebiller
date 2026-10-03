import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { auth } from './auth';
import Login from './Login.jsx';
import Shell from './Shell.jsx';
import './styles.css';
import './girder.css';

function Root() {
  const [session, setSession] = useState(null);
  const [isPending, setIsPending] = useState(true);
  const [route, setRoute] = useState(location.hash.slice(1) || '/dashboard');

  useEffect(() => {
    let mounted = true;
    auth.getSession()
      .then((data) => { if (mounted) setSession(data); })
      .catch(() => { if (mounted) setSession(null); })
      .finally(() => { if (mounted) setIsPending(false); });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    const h = () => setRoute(location.hash.slice(1) || '/dashboard');
    addEventListener('hashchange', h);
    return () => removeEventListener('hashchange', h);
  }, []);

  const handleSignedIn = (nextSession) => setSession(nextSession);
  const handleSignOut = async () => {
    try { await auth.signOut(); } finally { setSession(null); }
  };

  if (isPending) return null;
  if (!session) return <Login onSignedIn={handleSignedIn} />;
  return <Shell route={route} user={session.user} onSignOut={handleSignOut} />;
}

createRoot(document.getElementById('root')).render(<Root />);
