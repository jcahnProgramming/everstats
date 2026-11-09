import { Link } from 'react-router-dom';

// Also what /admin shows anyone without an admin session: the admin area doesn't announce itself.
export function NotFoundPage() {
  return (
    <>
      <div className="page-head"><h1>Nothing here</h1></div>
      <p className="muted">There's no page at this address. <Link to="/">Back to the search</Link>.</p>
    </>
  );
}
