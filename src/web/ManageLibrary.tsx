import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { ArrowLeft, List, Plus, Tags } from 'lucide-react';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import type { Tag, ProblemList } from '../shared/contracts';
import { api } from './api';
import { Icon, SectionTitle, Empty, ErrorNotice, Field, Loading, PageTitle, useAction } from './ui';
function TagRow({ tag }: { tag: Tag }) {
  const [name, setName] = useState(tag.name);
  const [description, setDescription] = useState(tag.description);
  const [hue, setHue] = useState(tag.hue ?? 0);
  const edit = useAction((data: Partial<Tag>) => api.send<Tag>(`/tags/${tag.id}`, 'PATCH', data));
  return (
    <li className={`tag-manager-row${tag.archived ? ' archived' : ''}`}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          edit.mutate({ name, description, hue });
        }}
      >
        <div className="tag-manager-fields">
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="tag-colour-swatch"
                aria-label={`Edit colour for ${tag.name}`}
                title="Edit tag colour"
                style={{ backgroundColor: `hsl(${hue} 65% 55%)` }}
              />
            </PopoverTrigger>
            <PopoverContent align="start">
              <Field label={`Colour for ${tag.name}`}>
                <input
                  type="range"
                  min="0"
                  max="359"
                  step="1"
                  value={hue}
                  onChange={(e) => setHue(Number(e.target.value))}
                  className="tag-hue-picker"
                />
              </Field>
              <p className="small muted">Choose a colour, then Save changes.</p>
            </PopoverContent>
          </Popover>
          <Field label={`Name for ${tag.name}`}>
            <Input value={name} required onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label={`Description for ${tag.name}`}>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
        </div>
        <div className="row tag-manager-actions">
          <Button
            variant="outline"
            disabled={
              edit.isPending ||
              (name === tag.name && description === tag.description && hue === (tag.hue ?? 0))
            }
          >
            Save changes
          </Button>
          <Button
            variant="outline"
            type="button"
            aria-label={`${tag.archived ? 'Restore' : 'Archive'} ${tag.name}`}
            disabled={edit.isPending}
            onClick={() => edit.mutate({ archived: !tag.archived })}
          >
            {tag.archived ? 'Restore' : 'Archive'}
          </Button>
          {tag.archived && (
            <Badge variant="secondary" className="badge">
              Archived
            </Badge>
          )}
          <Button asChild variant="ghost" className="tag-manager-open">
            <Link to={`/patterns?tag=${encodeURIComponent(tag.id)}`}>Open notebook</Link>
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
      <Link className="back-link" to="/library">
        <Icon icon={ArrowLeft} />
        Back to library
      </Link>
      <PageTitle
        title="Tags & lists"
        description="Each tag has a notebook page. Its assigned questions appear there automatically."
      />
      <div className="management-grid fill-page">
        <Card className="panel">
          <div className="section-heading">
            <SectionTitle icon={Tags}>Tags</SectionTitle>
            {tags.data && <span className="desk-count">{tags.data.length}</span>}
          </div>
          <form
            className="manage-create"
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
              <Icon icon={Plus} />
              Create tag
            </Button>
            <ErrorNotice error={addTag.error} />
          </form>
          <p className="small muted">
            Archived tags stay on existing questions but are hidden from new assignments.
          </p>
          {tags.isPending ? (
            <Loading />
          ) : tags.isError ? (
            <ErrorNotice error={tags.error} retry={() => void tags.refetch()} />
          ) : tags.data.length ? (
            <ul className="plain-list tag-manager-list">
              {[...tags.data]
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((t) => (
                  <TagRow key={`${t.id}-${t.name}-${t.archived}-${t.hue}-${t.kind}`} tag={t} />
                ))}
            </ul>
          ) : (
            <Empty>No tags yet.</Empty>
          )}
        </Card>
        <Card className="panel">
          <div className="section-heading">
            <SectionTitle icon={List}>Question lists</SectionTitle>
            {lists.data && <span className="desk-count">{lists.data.length}</span>}
          </div>
          <form
            className="manage-create"
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
              <Icon icon={Plus} />
              Create list
            </Button>
            <ErrorNotice error={addList.error} />
          </form>
          <p className="small muted">
            Edit a question to change its lists. A new list starts empty: popular lists appear only
            after importing a verified manifest.
          </p>
          {lists.isPending ? (
            <Loading />
          ) : lists.isError ? (
            <ErrorNotice error={lists.error} retry={() => void lists.refetch()} />
          ) : lists.data.length ? (
            <ul className="plain-list list-manager-list">
              {lists.data.map((l) => (
                <li className="list-row" key={l.id}>
                  <span className="list-row-icon" aria-hidden="true">
                    <Icon icon={List} />
                  </span>
                  <div>
                    <Link to={`/library?listId=${encodeURIComponent(l.id)}`}>{l.name}</Link>
                    <small>
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
                    </small>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>No lists yet.</Empty>
          )}
        </Card>
      </div>
    </>
  );
}
