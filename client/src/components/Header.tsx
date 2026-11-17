import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Header() {
  const { user, logout } = useAuth();
  return (
    <header className="header">
      <Link to="/" className="brand">
        Collab Editor
      </Link>
      <div className="header-right">
        <span>{user?.name || user?.email}</span>
        <button className="btn" onClick={() => void logout()}>
          Log out
        </button>
      </div>
    </header>
  );
}
