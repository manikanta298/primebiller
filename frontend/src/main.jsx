import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { authClient } from './auth-client';
import Login from './Login.jsx';
import Shell from './Shell.jsx';
import './styles.css';
import './girder.css';

function Root() {
  const { data: session, isPending, refetch } = authClient.useSession();
  const [route, setRoute] = useState(location.hash.slice(1) || '/dashboard');
  useEffect(() => {
    const h = () => setRoute(location.hash.slice(1) || '/dashboard');
    addEventListener('hashchange', h); return () => removeEventListener('hashchange', h);
  }, []);
  if (isPending) return null;
  if (!session) return <Login onSignedIn={refetch} />;
  return <Shell route={route} user={session.user} onSignOut={async () => { await authClient.signOut(); refetch(); }} />;
}

createRoot(document.getElementById('root')).render(<Root />);
