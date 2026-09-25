import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Icon } from '../components/ui';
import { ThemeSwitch } from './theme';

export const isDesktopMac = window.tutorDesktop?.platform === 'darwin';
export function DesktopTitleBar({
  collapsed,
  sidebarAvailable,
  toggleSidebar,
}: {
  collapsed: boolean;
  sidebarAvailable: boolean;
  toggleSidebar: () => void;
}) {
  const [navigation, setNavigation] = useState({ back: false, forward: false });
  useEffect(() => {
    const desktop = window.tutorDesktop;
    if (!desktop || !isDesktopMac) return;
    const unsubscribe = desktop.onNavigation(setNavigation);
    let active = true;
    void desktop
      .getNavigation()
      .then((state) => {
        if (active) setNavigation(state);
      })
      .catch(() => {});
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);
  if (!isDesktopMac) return null;
  return (
    <header className="desktop-titlebar" aria-label="Window toolbar">
      <div className="desktop-window-actions">
        {sidebarAvailable && (
          <Button
            variant="ghost"
            size="icon"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!collapsed}
            aria-controls="sidebar-navigation"
            onClick={toggleSidebar}
          >
            <Icon icon={collapsed ? PanelLeftOpen : PanelLeftClose} />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          aria-label="Go back"
          title="Go back"
          disabled={!navigation.back}
          onClick={() => window.tutorDesktop?.navigate('back')}
        >
          <Icon icon={ChevronLeft} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Go forward"
          title="Go forward"
          disabled={!navigation.forward}
          onClick={() => window.tutorDesktop?.navigate('forward')}
        >
          <Icon icon={ChevronRight} />
        </Button>
      </div>
      <div className="desktop-theme-action">
        <ThemeSwitch />
      </div>
    </header>
  );
}
