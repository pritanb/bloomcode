import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X, Unplug } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { McpConnectionStatus } from '../shared/mcp-connection';
import { api } from './api';

export function McpNotifications() {
  const query = useQuery({
    queryKey: ['mcp-connection'],
    queryFn: () => api.get<McpConnectionStatus>('/mcp/status'),
    refetchInterval: 5000,
    retry: false,
  });
  const lastState = useRef<McpConnectionStatus['state'] | null>(null);
  const [visible, setVisible] = useState(false);
  const connection = query.isError ? undefined : query.data;
  // Only the sampling provider depends on an MCP client staying connected.
  const sampling = !connection?.provider || connection.provider === 'mcp-sampling';
  useEffect(() => {
    if (!connection) return; // An unavailable app server is not evidence of an MCP disconnect.
    if (connection.state === 'disconnected' && lastState.current !== 'disconnected')
      setVisible(true);
    if (connection.state === 'connected') setVisible(false);
    lastState.current = connection.state;
  }, [connection]);
  if (!visible || !sampling) return null;
  return (
    <aside className="connection-toast" role="alert" aria-label="MCP connection lost">
      <Unplug className="icon" aria-hidden="true" />
      <div>
        <strong>MCP tutor disconnected</strong>
        <p>Reconnect LeetCode Tutor in your tutor app.</p>
      </div>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Dismiss connection notification"
        onClick={() => setVisible(false)}
      >
        <X className="icon" aria-hidden="true" />
      </Button>
    </aside>
  );
}
