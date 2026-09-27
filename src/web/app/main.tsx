import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import '@fontsource-variable/inter';
import '@fontsource-variable/dm-sans';
import '../styles/styles.css';
import '../styles/theme.css';
import '../features/library/library.css';
import '../features/topics/topics.css';
import '../features/notebooks/notebooks.css';
import '../features/settings/settings-reports.css';

import './theme';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 10000 },
    mutations: { retry: false },
  },
});
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={queryClient}>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </QueryClientProvider>,
);
