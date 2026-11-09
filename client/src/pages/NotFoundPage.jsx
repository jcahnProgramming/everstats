import { Link } from 'react-router-dom';

// Also what /admin shows anyone without an admin session: the admin area doesn't announce itself.
export function NotFoundPage() {
  return (
    <div className="wrap page-pad stack gap-16">
      <h1 className="h1">Nothing here</h1>
      <p className="t2">There's no page at this address. <Link to="/">Back to the search</Link>.</p>
    </div>
  );
}
