import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <section className="stack">
      <h2>Page not found</h2>
      <p className="page-subtitle">This tool route does not exist yet.</p>
      <Link className="primary-link" to="/tools">
        Back to tools
      </Link>
    </section>
  );
}
