import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Plus, Tags } from 'lucide-react';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import type { Problem, ProblemPage } from '../../../shared/contracts';
import { api } from '../../app/api';
import { Icon, SectionTitle, ErrorNotice, PageTitle, useAction } from '../../components/ui';
import { useCatalogue } from './library-utils';
import { LibraryFilters } from './LibraryFilters';
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
      <PageTitle
        title="Question library"
        description="Keep your questions, patterns and practice history together."
      >
        <div className="row">
          <Button asChild variant="outline">
            <Link to="/library/manage">
              <Icon icon={Tags} />
              Manage tags & lists
            </Link>
          </Button>
          <Button variant="default" onClick={() => setAdding(true)}>
            <Icon icon={Plus} />
            Add question
          </Button>
        </div>
      </PageTitle>
      {adding && (
        <Card className="panel editor-panel" aria-label="Add question">
          <SectionTitle icon={Plus}>Add a question</SectionTitle>
          <ProblemForm
            tags={tags.data ?? []}
            lists={lists.data ?? []}
            pending={add.isPending}
            error={add.error}
            onCancel={() => setAdding(false)}
            onSave={(data) => add.mutate(data)}
          />
        </Card>
      )}
      <Card className="panel library-results fill-page">
        <div className="section-heading">
          <h2 className="section-title">
            {query.isSuccess
              ? `${query.data.total} question${query.data.total === 1 ? '' : 's'}`
              : 'Questions'}
          </h2>
        </div>
        <LibraryFilters
          params={params}
          setParams={setParams}
          filter={filter}
          activeFilters={activeFilters}
          hasFilters={hasFilters}
          filtersOpen={filtersOpen}
          setFiltersOpen={setFiltersOpen}
          tags={tags.data}
          lists={lists.data}
        />
        {params.get('confidence') && (
          <p className="small muted library-note">
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
      </Card>
    </>
  );
}
