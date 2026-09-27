import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ArrowRight, List as ListIcon, Plus, Tags } from 'lucide-react';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import type { Tag, ProblemList } from '../../../shared/contracts';
import { api } from '../../app/api';
import { ErrorNotice, Field, Loading, useAction } from '../../components/ui';
import {
  EmptyState,
  FillPage,
  List,
  ListRow,
  PageHeader,
  Panel,
  ScrollRegion,
  ToneBadge,
} from '../../components/kit';
import { BackLink } from '../../components/back-link';

const hueGradient = `linear-gradient(to right, ${[0, 60, 120, 180, 240, 300, 359]
  .map((h) => `hsl(${h} 65% 55%)`)
  .join(', ')})`;

/** Inline "create" strip at the top of each panel. */
const createForm =
  'grid shrink-0 grid-cols-[repeat(auto-fit,minmax(8.5rem,1fr))] items-end gap-3 rounded-2xl bg-muted p-4 [&_[data-slot=input]]:bg-card [&>.error]:col-span-full [&>.error]:m-0 [&>[data-slot=button]]:justify-self-start';
const hint = 'shrink-0 text-[0.8125rem] text-muted-foreground';

function TagRow({ tag }: { tag: Tag }) {
  const [name, setName] = useState(tag.name);
  const [description, setDescription] = useState(tag.description);
  const [hue, setHue] = useState(tag.hue ?? 0);
  const edit = useAction((data: Partial<Tag>) => api.send<Tag>(`/tags/${tag.id}`, 'PATCH', data));
  return (
    <li className="py-4 first:pt-0 last:pb-0">
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          edit.mutate({ name, description, hue });
        }}
      >
        <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2.5 sm:grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)]">
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="size-9 cursor-pointer rounded-xl border-[3px] border-card ring-1 ring-border outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`Edit colour for ${tag.name}`}
                title="Edit tag colour"
                style={{ backgroundColor: `hsl(${hue} 65% 55%)` }}
              />
            </PopoverTrigger>
            <PopoverContent align="start" className="flex flex-col gap-2">
              <Field label={`Colour for ${tag.name}`}>
                <input
                  type="range"
                  min="0"
                  max="359"
                  step="1"
                  value={hue}
                  onChange={(e) => setHue(Number(e.target.value))}
                  className="w-full rounded-2xl accent-foreground"
                  style={{ background: hueGradient }}
                />
              </Field>
              <p className="text-[0.8125rem] text-muted-foreground">
                Choose a colour, then Save changes.
              </p>
            </PopoverContent>
          </Popover>
          <Input
            aria-label={`Name for ${tag.name}`}
            placeholder="Name"
            value={name}
            required
            onChange={(e) => setName(e.target.value)}
          />
          <Input
            aria-label={`Description for ${tag.name}`}
            placeholder="Description"
            className="max-sm:col-span-full"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            disabled={
              edit.isPending ||
              (name === tag.name && description === tag.description && hue === (tag.hue ?? 0))
            }
          >
            Save changes
          </Button>
          <Button
            variant="outline"
            size="sm"
            type="button"
            aria-label={`${tag.archived ? 'Restore' : 'Archive'} ${tag.name}`}
            disabled={edit.isPending}
            onClick={() => edit.mutate({ archived: !tag.archived })}
          >
            {tag.archived ? 'Restore' : 'Archive'}
          </Button>
          {tag.archived && <ToneBadge tone="muted">Archived</ToneBadge>}
          <Button asChild variant="ghost" size="sm" className="ml-auto">
            <Link to={`/patterns?tag=${encodeURIComponent(tag.id)}`}>
              Open notebook
              <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
        </div>
        <ErrorNotice error={edit.error} />
      </form>
    </li>
  );
}

export function ManageLibrary() {
  const tags = useQuery({
    queryKey: ['tags'],
    queryFn: () => api.get<Tag[]>('/tags'),
  });
  const lists = useQuery({
    queryKey: ['lists'],
    queryFn: () => api.get<ProblemList[]>('/lists'),
  });
  const [tagName, setTagName] = useState('');
  const [description, setDescription] = useState('');
  const [listName, setListName] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [sourceVersion, setSourceVersion] = useState('');
  const addTag = useAction(async () => {
    const t = await api.send<Tag>('/tags', 'POST', {
      name: tagName,
      description,
    });
    setTagName('');
    setDescription('');
    return t;
  });
  const addList = useAction(async () => {
    const l = await api.send<ProblemList>('/lists', 'POST', {
      name: listName,
      ...(sourceUrl ? { sourceUrl } : {}),
      ...(sourceVersion ? { sourceVersion } : {}),
    });
    setListName('');
    setSourceUrl('');
    setSourceVersion('');
    return l;
  });
  return (
    <>
      <BackLink to="/library">Back to library</BackLink>
      <PageHeader
        title="Tags & lists"
        description="Each tag has a notebook page. Its assigned questions appear there automatically."
      />
      <FillPage className="lg:grid lg:grid-cols-2 lg:grid-rows-[minmax(0,1fr)]">
        <Panel className="min-h-0" title="Tags" icon={Tags} tone="brand" meta={tags.data?.length}>
          <form
            className={createForm}
            onSubmit={(e) => {
              e.preventDefault();
              addTag.mutate();
            }}
          >
            <Field label="New tag name">
              <Input required value={tagName} onChange={(e) => setTagName(e.target.value)} />
            </Field>
            <Field label="Tag description">
              <Input value={description} onChange={(e) => setDescription(e.target.value)} />
            </Field>
            <Button variant="default" disabled={addTag.isPending}>
              <Plus aria-hidden="true" />
              Create tag
            </Button>
            <ErrorNotice error={addTag.error} />
          </form>
          <p className={hint}>
            Archived tags stay on existing questions but are hidden from new assignments.
          </p>
          {tags.isPending ? (
            <Loading />
          ) : tags.isError ? (
            <ErrorNotice error={tags.error} retry={() => void tags.refetch()} />
          ) : tags.data.length ? (
            <ScrollRegion className="border-t pt-4">
              <ul className="m-0 flex list-none flex-col divide-y p-0">
                {[...tags.data]
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((t) => (
                    <TagRow key={`${t.id}-${t.name}-${t.archived}-${t.hue}-${t.kind}`} tag={t} />
                  ))}
              </ul>
            </ScrollRegion>
          ) : (
            <EmptyState className="flex-1" icon={Tags} title="No tags yet." />
          )}
        </Panel>
        <Panel
          className="min-h-0"
          title="Question lists"
          icon={ListIcon}
          tone="sky"
          meta={lists.data?.length}
        >
          <form
            className={createForm}
            onSubmit={(e) => {
              e.preventDefault();
              addList.mutate();
            }}
          >
            <Field label="New list name">
              <Input required value={listName} onChange={(e) => setListName(e.target.value)} />
            </Field>
            <Field label="Source URL (optional)">
              <Input type="url" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} />
            </Field>
            <Field label="Source version (optional)">
              <Input value={sourceVersion} onChange={(e) => setSourceVersion(e.target.value)} />
            </Field>
            <Button variant="default" disabled={addList.isPending}>
              <Plus aria-hidden="true" />
              Create list
            </Button>
            <ErrorNotice error={addList.error} />
          </form>
          <p className={hint}>
            Edit a question to change its lists. A new list starts empty: popular lists appear only
            after importing a verified manifest.
          </p>
          {lists.isPending ? (
            <Loading />
          ) : lists.isError ? (
            <ErrorNotice error={lists.error} retry={() => void lists.refetch()} />
          ) : lists.data.length ? (
            <ScrollRegion className="border-t">
              <List>
                {lists.data.map((l) => (
                  <ListRow
                    key={l.id}
                    icon={ListIcon}
                    tone="sky"
                    title={l.name}
                    to={`/library?listId=${encodeURIComponent(l.id)}`}
                    meta={
                      <span className="block truncate">
                        {l.sourceVersion ?? 'Custom list'}
                        {l.sourceUrl && (
                          <>
                            {' '}
                            ·{' '}
                            <a
                              href={/^https?:\/\//.test(l.sourceUrl) ? l.sourceUrl : undefined}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Source
                            </a>
                          </>
                        )}
                      </span>
                    }
                  />
                ))}
              </List>
            </ScrollRegion>
          ) : (
            <EmptyState className="flex-1" icon={ListIcon} title="No lists yet." />
          )}
        </Panel>
      </FillPage>
    </>
  );
}
