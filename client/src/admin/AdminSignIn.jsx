import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../chrome/Icon.jsx';
import { Button } from '../components/Controls.jsx';
import { NotFoundPage } from '../pages/NotFoundPage.jsx';
import { AuthCard } from '../pages/SignInPages.jsx';
import { passkeyRegister, passkeySignIn, wasCancelled } from '../passkeyClient.js';

/**
 * Admin sign-in and passkey enrolment (moved out of the old AdminPages.jsx in 0.10.3). These two stay in the public
 * frame: they are the only admin addresses reached without an admin session. Everything else is the v5 admin shell
 * (AdminApp.jsx), loaded as its own chunk.
 */
export function AdminSignInPage() {
  const navigate = useNavigate();
  const [problem, setProblem] = useState(null);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    setProblem(null);
    try {
      await passkeySignIn('/api/admin/sign-in/options', '/api/admin/sign-in/verify');
      navigate('/admin');
    } catch (err) {
      if (!wasCancelled(err)) setProblem(err.message);
    }
    setBusy(false);
  };
  return (
    <AuthCard>
      <h1 className="h1 h1-auth center-text">Admin sign-in</h1>
      {problem && <div className="note err small" role="alert"><Icon name="error" /><span>{problem}</span></div>}
      <Button className="gold lg" loading={busy} onClick={go}><Icon name="passkey" size="md" />Use admin passkey</Button>
    </AuthCard>
  );
}

export function AdminEnrollPage() {
  const navigate = useNavigate();
  const [problem, setProblem] = useState(null);
  const [busy, setBusy] = useState(false);
  // The invite is in the #fragment, so it never reached a server log. Read once, then cleared from the address bar.
  const [invite] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get('invite'));
  useEffect(() => {
    if (window.location.hash) window.history.replaceState(null, '', window.location.pathname);
  }, []);
  const go = async () => {
    setBusy(true);
    setProblem(null);
    try {
      await passkeyRegister('/api/admin/enroll/options', '/api/admin/enroll/verify', { optionsBody: { invite } });
      navigate('/admin');
    } catch (err) {
      if (!wasCancelled(err)) setProblem(err.message);
    }
    setBusy(false);
  };
  if (!invite) return <NotFoundPage />;
  return (
    <AuthCard>
      <h1 className="h1 h1-auth center-text">Register an admin passkey</h1>
      <p className="t2 small center-text">This one-time link lets you register a passkey for the admin area.</p>
      {problem && <div className="note err small" role="alert"><Icon name="error" /><span>{problem}</span></div>}
      <Button className="gold lg" loading={busy} onClick={go}><Icon name="passkey" size="md" />Register passkey</Button>
    </AuthCard>
  );
}
