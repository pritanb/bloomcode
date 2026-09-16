
import { lazy, Suspense } from 'react';
import { NavLink, Route, Routes, useLocation } from 'react-router-dom';
import {
  BookOpen,
  ChartNoAxesCombined,
  CodeXml,
  LayoutDashboard,
  Settings2,
} from 'lucide-react';
import { Dashboard } from './Dashboard';
import { Library, ProblemDetail } from './Library';
import { ManageLibrary } from './ManageLibrary';
import { Icon, Loading } from './ui';
import { Topics, TopicDetail } from './Topics';
import { Settings } from './Settings';

const AttemptPage = lazy(() =>
  import('./Attempt').then((module) => ({ default: module.AttemptPage })),
);
const navigation = [
  { to: '/', label: 'Study desk', icon: LayoutDashboard },
  { to: '/library', label: 'Question library', icon: BookOpen },
  { to: '/topics', label: 'Topic progress', icon: ChartNoAxesCombined },
  { to: '/settings', label: 'Settings & data', icon: Settings2 },
];

export function App() {
  const focused = useLocation().pathname.startsWith('/attempts/');
  if (focused) {
    return (
      <main className="attempt-workspace">
        <Routes>
          <Route
            path="/attempts/:id"
            element={
              <Suspense fallback={<Loading />}>
                <AttemptPage />
              </Suspense>
            }
          />
        </Routes>
      </main>
    );
  }
  return (
    <div className="app">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside className="sidebar">
        <NavLink to="/" className="brand">
          <span className="brand-mark" aria-hidden="true">
            <Icon icon={CodeXml} />
          </span>
          <span>
            LeetCode<strong>Tutor</strong>
          </span>
        </NavLink>
        <nav aria-label="Main navigation">
          {navigation.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.to === '/'}>
              <Icon icon={item.icon} />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-note">
          <span className="local-dot" aria-hidden="true" /> Local study
          workspace
          <p>
            Your answers, your history.
            <br />
            One question at a time.
          </p>
        </div>
      </aside>
      <main id="main" tabIndex={-1}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/library" element={<Library />} />
          <Route path="/library/manage" element={<ManageLibrary />} />
          <Route path="/library/:id" element={<ProblemDetail />} />
          <Route path="/topics" element={<Topics />} />
          <Route path="/topics/:id" element={<TopicDetail />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<p>Page not found.</p>} />
        </Routes>
      </main>
    </div>
  );
}
