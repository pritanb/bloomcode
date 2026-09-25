import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import '@fontsource-variable/inter';
import '@fontsource-variable/dm-sans';
import './styles.css';
import './theme-v2.css';
import './theme/library.css';
import './theme/topics.css';
import './theme/notebooks.css';
import './theme/settings-reports.css';
import './theme/attempt.css';

document.body.classList.add('theme-v2');
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
