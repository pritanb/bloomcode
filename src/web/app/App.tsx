import { DesktopTitleBar, isDesktopMac } from './DesktopTitleBar';
import { SetupGate } from '../features/settings/Welcome';
import { lazy, Suspense, useState } from 'react';
import { NavLink, Route, Routes, useLocation } from 'react-router-dom';
import {
  BookOpen,
  Brain,
  NotebookPen,
  Bookmark,
  ChartNoAxesCombined,
  CodeXml,
  LayoutDashboard,
  PanelLeftClose,
  PanelLeftOpen,
  Settings2,
} from 'lucide-react';
import { LearningInsights } from '../features/insights/LearningInsights';
import { StudyReport } from '../features/reports/StudyReports';
import { Dashboard } from '../features/desk/Dashboard';
import { Library, ProblemDetail } from '../features/library/Library';
import { ManageLibrary } from '../features/library/ManageLibrary';
import { Icon, Loading } from '../components/ui';
import { Topics, TopicDetail } from '../features/topics/Topics';
import { Settings } from '../features/settings/Settings';
import { Mistakes } from '../features/notebooks/Mistakes';
import { Patterns } from '../features/notebooks/Patterns';
import { ThemeSwitch } from './theme';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const AttemptPage = lazy(() =>
  import('../features/practice/Attempt').then((module) => ({ default: module.AttemptPage })),
);
const navigation = [
  { to: '/', label: 'Study desk', icon: LayoutDashboard },
  { to: '/library', label: 'Question library', icon: BookOpen },
  { to: '/topics', label: 'Topic progress', icon: ChartNoAxesCombined },
  { to: '/insights', label: 'Learning insights', icon: Brain },
  { to: '/mistakes', label: 'Mistake notebook', icon: NotebookPen },
  { to: '/patterns', label: 'Pattern notebook', icon: Bookmark },
  { to: '/settings', label: 'Settings & data', icon: Settings2 },
];

export function App() {
  const [collapsed, setCollapsed] = useState(false);
  const focused = useLocation().pathname.startsWith('/attempts/');
  return (
    <div
      className={cn(
        'app-shell',
        isDesktopMac && 'desktop-app',
        // The attempt workspace has no sidebar; it fills the window and scrolls inside its panels.
        focused &&
          '[@media(min-width:901px)_and_(min-height:560px)]:flex [@media(min-width:901px)_and_(min-height:560px)]:h-screen [@media(min-width:901px)_and_(min-height:560px)]:flex-col [@media(min-width:901px)_and_(min-height:560px)]:overflow-hidden',
      )}
    >
      <SetupGate
        chrome={(hasWorkspace) => (
          <DesktopTitleBar
            collapsed={collapsed}
            sidebarAvailable={hasWorkspace && !focused}
            toggleSidebar={() => setCollapsed((value) => !value)}
          />
        )}
      >
        <Workspace collapsed={collapsed} toggleSidebar={() => setCollapsed((value) => !value)} />
      </SetupGate>
    </div>
  );
}
function Workspace({
  collapsed,
  toggleSidebar,
}: {
  collapsed: boolean;
  toggleSidebar: () => void;
}) {
  const { pathname } = useLocation();
  const focused = pathname.startsWith('/attempts/');
  if (focused) {
    return (
      <main className="flex w-full min-w-0 flex-col bg-background px-7 pt-7 pb-10 max-[700px]:px-4 max-[700px]:py-6 [@media(min-width:901px)_and_(min-height:560px)]:min-h-0 [@media(min-width:901px)_and_(min-height:560px)]:flex-1 [@media(min-width:901px)_and_(min-height:560px)]:pb-6">
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
    <div className={`app${collapsed ? ' sidebar-collapsed' : ''}`}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside className="sidebar">
        <div className="sidebar-header">
          <NavLink
            to="/"
            className="brand"
            aria-label="BloomCode"
            title={collapsed ? 'BloomCode' : undefined}
          >
            <span className="brand-mark" aria-hidden="true">
              <Icon icon={CodeXml} />
            </span>
            <span className="sidebar-label">BloomCode</span>
          </NavLink>
        </div>
        <nav id="sidebar-navigation" aria-label="Main navigation">
          {navigation.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              aria-label={item.label}
              title={collapsed ? item.label : undefined}
            >
              <Icon icon={item.icon} />
              <span className="sidebar-label">{item.label}</span>
            </NavLink>
          ))}
        </nav>
        {!isDesktopMac && (
          <div className="sidebar-footer">
            <ThemeSwitch />
            <Button
              variant="ghost"
              size="icon"
              className="sidebar-toggle"
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              aria-expanded={!collapsed}
              aria-controls="sidebar-navigation"
              onClick={toggleSidebar}
            >
              <Icon icon={collapsed ? PanelLeftOpen : PanelLeftClose} />
            </Button>
          </div>
        )}
      </aside>
      <main id="main" tabIndex={-1}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/reviews" element={<StudyReport calendar />} />
          <Route path="/weekly-report" element={<StudyReport />} />
          <Route path="/library" element={<Library />} />
          <Route path="/library/manage" element={<ManageLibrary />} />
          <Route path="/library/:id" element={<ProblemDetail />} />
          <Route path="/topics" element={<Topics />} />
          <Route path="/topics/:id" element={<TopicDetail />} />
          <Route path="/insights" element={<LearningInsights />} />
          <Route path="/mistakes" element={<Mistakes />} />
          <Route path="/patterns" element={<Patterns />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<p>Page not found.</p>} />
        </Routes>
      </main>
    </div>
  );
}
