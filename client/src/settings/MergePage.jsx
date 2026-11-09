import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { EmptyState } from '../components/EmptyState.jsx';
import { useSession } from '../session.jsx';
import '../pages/pages.css';

// Reached after proving the other account (settings → Merge). Shows what will happen and asks once more.
export function MergePage() {
  const session = useSession();
  const navigate = useNavigate();
  const [state, setState] = useState(null);
  const [code, setCode] = useState('');
  const [problem, setProblem] = useState(null);

  const load = () => api('/api/account/merge').then(setState, (err) => setProblem(err.message));
  useEffect(() => {
    if (session.signedIn) load();
  }, [session.signedIn]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!session.loading && !session.signedIn) return <EmptyState kind="nodata" title="Sign in first"><Link to="/sign-in">Sign in</Link></EmptyState>;
  if (!state) return <div className="page-head"><h1>Merge accounts</h1></div>;
  if (!state.merge) {
    return (
      <div className="stack narrow">
        <div className="page-head"><h1>Merge accounts</h1></div>
        <EmptyState kind="nodata" title="No merge is waiting">
          <span>It may have expired (10 minutes). Start again from <Link to="/settings">Settings</Link>.</span>
        </EmptyState>
      </div>
    );
  }

  const { merge, steps } = state;
  const verify = async (e) => {
    e.preventDefault();
    try {
      await api('/api/account/merge/code', { method: 'POST', body: { code } });
      setProblem(null);
      load();
    } catch (err) {
      setProblem(err.message);
    }
  };
  const confirm = async () => {
    try {
      await api('/api/account/merge/confirm', { method: 'POST', body: {} });
      await session.refresh();
      navigate('/settings');
    } catch (err) {
      setProblem(err.message);
    }
  };
  const cancel = async () => {
    await api('/api/account/merge', { method: 'DELETE' });
    navigate('/settings');
  };

  return (
    <div className="stack narrow">
      <div className="page-head">
        <h1>Merge this account into account #{merge.target.id}</h1>
        <p className="muted">The account you keep: {merge.target.identities.map((i) => `${i.label}${i.displayName ? ` (${i.displayName})` : ''}`).join(', ') || 'no linked providers'}{merge.target.passkeys ? `, ${merge.target.passkeys} passkey(s)` : ''}.</p>
      </div>
      <section className="panel">
        <h2>What happens</h2>
        <ul className="release-items">
          {steps.map((s) => <li key={s}>{s}</li>)}
          <li>This account is then deleted. The account you keep keeps its own 2FA settings and theme.</li>
        </ul>
      </section>
      {problem && <p className="notice notice-danger" role="alert">{problem}</p>}
      {merge.needsCode ? (
        <form className="row" onSubmit={verify}>
          <div className="field">
            <label htmlFor="mcode">The other account's 2FA code</label>
            <input id="mcode" className="input input-code" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" maxLength={11} />
          </div>
          <button type="submit" className="btn">Check code</button>
        </form>
      ) : (
        <div className="row">
          <button type="button" className="btn btn-danger" onClick={confirm}>Merge and delete this account</button>
          <button type="button" className="btn btn-ghost" onClick={cancel}>Cancel</button>
        </div>
      )}
    </div>
  );
}
