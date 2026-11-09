import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { Icon } from '../chrome/Icon.jsx';
import { Button, Field } from '../components/Controls.jsx';
import { EmptyState } from '../components/EmptyState.jsx';
import { useSession } from '../session.jsx';

// Reached after proving the other account (Settings → Merge). Shows what will happen and asks once more: this page
// is the merge's confirmation step (design/v1/components/modals.md's "confirm before a destructive action").
export function MergePage() {
  const session = useSession();
  const navigate = useNavigate();
  const [state, setState] = useState(null);
  const [code, setCode] = useState('');
  const [problem, setProblem] = useState(null);
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = () => api('/api/account/merge').then(setState, (err) => setProblem(err.message));
  useEffect(() => {
    if (session.signedIn) load();
  }, [session.signedIn]); // eslint-disable-line react-hooks/exhaustive-deps

  const frame = (children) => <div className="wrap page-pad stack gap-24 narrow-wrap">{children}</div>;

  if (!session.loading && !session.signedIn) {
    return frame(<EmptyState kind="nodata" title="Sign in first"><span><Link to="/sign-in">Sign in</Link> to the account you want to merge away.</span></EmptyState>);
  }
  if (!state) return frame(<><h1 className="h1">Merge accounts</h1>{problem && <div className="note err small" role="alert"><Icon name="error" /><span>{problem}</span></div>}</>);
  if (!state.merge) {
    return frame(
      <>
        <h1 className="h1">Merge accounts</h1>
        <EmptyState kind="nodata" title="No merge is waiting">
          <span>It may have expired (10 minutes). Start again from <Link to="/settings#merge">Settings</Link>.</span>
        </EmptyState>
      </>,
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
    setBusy(true);
    try {
      await api('/api/account/merge/confirm', { method: 'POST', body: {} });
      await session.refresh();
      navigate('/settings');
    } catch (err) {
      setProblem(err.message);
      setBusy(false);
    }
  };
  const cancel = async () => {
    await api('/api/account/merge', { method: 'DELETE' });
    navigate('/settings');
  };

  return frame(
    <>
      <div className="stack gap-10">
        <span className="eyebrow">Merge accounts · confirm</span>
        <h1 className="h1">Merge this account into account #{merge.target.id}</h1>
        <p className="t2">The account you keep: {merge.target.identities.map((i) => `${i.label}${i.displayName ? ` (${i.displayName})` : ''}`).join(', ') || 'no linked providers'}{merge.target.passkeys ? `, ${merge.target.passkeys} passkey(s)` : ''}.</p>
      </div>
      <section className="sheet stack gap-14 sheet-pad">
        <h2 className="h3">What happens</h2>
        <ul className="t2 small stack gap-6 tips">
          {steps.map((s) => <li key={s}>{s}</li>)}
          <li>This account is then deleted. The account you keep keeps its own 2FA settings and theme.</li>
        </ul>
        <div className="note warn small"><Icon name="warning" /><span>This can't be undone.</span></div>
        {problem && <div className="note err small" role="alert"><Icon name="error" /><span>{problem}</span></div>}
        {merge.needsCode ? (
          <form className="row gap-8 align-end" onSubmit={verify}>
            <Field label="The other account's 2FA code" inputClassName="otp" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" maxLength={11} />
            <button type="submit" className="btn">Check code</button>
          </form>
        ) : (
          <>
            <label className="check"><input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} />I understand this account will be deleted</label>
            <div className="row gap-10">
              <Button className="danger" loading={busy} disabled={!sure} onClick={confirm}>Merge and delete this account</Button>
              <button type="button" className="btn ghost" onClick={cancel} disabled={busy}>Cancel</button>
            </div>
          </>
        )}
      </section>
    </>,
  );
}
