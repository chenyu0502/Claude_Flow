import { Link } from 'react-router-dom';

export default function NotFoundPage() {
  return (
    <div className="container narrow">
      <div className="card center">
        <h1>404</h1>
        <p className="muted">找不到这个页面。</p>
        <Link className="btn" to="/">回首页</Link>
      </div>
    </div>
  );
}
