import { Button } from '@/components/ui/button';
import { BookOpen, Plus, Tags } from 'lucide-react';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import type { Problem, ProblemPage } from '../../../shared/contracts';
import { api } from '../../app/api';
import { ErrorNotice, useAction } from '../../components/ui';
import {
  FillPage,
  PageHeader,
  Panel,
  SidePanel,
  SidePanelContent,
  SidePanelDescription,
  SidePanelTitle,
} from '../../components/kit';
import { useCatalogue } from './library-utils';
import { LibraryFilters, LibrarySearch } from './LibraryFilters';
import { LibraryResults } from './LibraryResults';
import { ProblemForm } from './ProblemForm';
import { useLibraryParams } from './use-library-params';

export { ProblemDetail } from './ProblemDetail';
export { ProblemForm } from './ProblemForm';
export { ProblemTable } from './ProblemTable';
export { ReviewEditor } from './ReviewEditor';

export function Library() {
  const { params, setParams, restoring, activeFilters, hasFilters, queryParams, filter } =
    useLibraryParams();
  const navigate = useNavigate();
  const [adding, setAdding] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(activeFilters > 0);
  const { tags, lists } = useCatalogue();
  const query = useQuery({
    queryKey: ['problems', queryParams.toString()],
    queryFn: () => api.get<ProblemPage>(`/problems?${queryParams}`),
    enabled: !restoring,
  });
  const add = useAction(async (data: Record<string, unknown>) => {
    const p = await api.send<Problem>('/problems', 'POST', data);
    setAdding(false);
    navigate(`/library/${p.id}`);
    return p;
  });
  return (
    <>
      <PageHeader
        title="Question library"
        description="Keep your questions, patterns and practice history together."
        actions={
          <>
            <Button asChild variant="outline">
              <Link to="/library/manage">
                <Tags aria-hidden="true" />
                Manage tags & lists
              </Link>
            </Button>
            <Button variant="default" onClick={() => setAdding(true)}>
              <Plus aria-hidden="true" />
              Add question
            </Button>
          </>
        }
      />
      <SidePanel open={adding} onOpenChange={setAdding}>
        <SidePanelContent closeLabel="Close add question" className="w-[min(40rem,100vw)]">
          <SidePanelTitle>Add a question</SidePanelTitle>
          <SidePanelDescription className="sr-only">
            Save a LeetCode question to your library.
          </SidePanelDescription>
          <ProblemForm
            tags={tags.data ?? []}
            lists={lists.data ?? []}
            pending={add.isPending}
            error={add.error}
            onCancel={() => setAdding(false)}
            onSave={(data) => add.mutate(data)}
          />
        </SidePanelContent>
      </SidePanel>
      <FillPage>
        <Panel
          className="min-h-0 flex-1"
          icon={BookOpen}
          tone="brand"
          title={
            query.isSuccess
              ? `${query.data.total} question${query.data.total === 1 ? '' : 's'}`
              : 'Questions'
          }
          actions={
            <LibrarySearch
              params={params}
              setParams={setParams}
              filter={filter}
              activeFilters={activeFilters}
              hasFilters={hasFilters}
              filtersOpen={filtersOpen}
              setFiltersOpen={setFiltersOpen}
            />
          }
        >
          <LibraryFilters
            params={params}
            filter={filter}
            filtersOpen={filtersOpen}
            tags={tags.data}
            lists={lists.data}
          />
          {params.get('confidence') && (
            <p className="-mt-1 text-[0.8125rem] text-muted-foreground">
              Uses your latest recorded rating, not a topic score. Unrated attempts keep the earlier
              rating; “Not recorded” means none was saved.
            </p>
          )}
          <ErrorNotice
            error={tags.error ?? lists.error}
            retry={() => {
              void tags.refetch();
              void lists.refetch();
            }}
          />
          <LibraryResults query={query} params={params} setParams={setParams} filter={filter} />
        </Panel>
      </FillPage>
    </>
  );
}
