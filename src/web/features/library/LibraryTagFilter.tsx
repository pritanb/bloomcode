import { tagColour } from '../../lib/tag-colour';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { SelectField, SelectOption } from '@/components/select-field';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import type { Tag } from '../../../shared/contracts';
import { Icon } from '../../components/ui';
import type { LibraryFilter } from './use-library-params';

/** The Tags field in the library filters: a searchable pattern picker in a popover. */
export function LibraryTagFilter({
  params,
  filter,
  tags,
}: {
  params: URLSearchParams;
  filter: LibraryFilter;
  tags: Tag[] | undefined;
}) {
  const [tagSearch, setTagSearch] = useState('');
  const [tagsOpen, setTagsOpen] = useState(false);
  const selectedTags = (params.get('tags') ?? '').split(',').filter(Boolean);
  return (
    <div className="field">
      <Label htmlFor="tag-filter-trigger">Tags</Label>
      <Popover open={tagsOpen} onOpenChange={setTagsOpen}>
        <PopoverTrigger asChild>
          <Button id="tag-filter-trigger" variant="outline" className="tag-filter-trigger">
            {selectedTags.length ? `${selectedTags.length} selected` : 'All tags'}
            <Icon icon={ChevronDown} />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="tag-filter-popover"
          align="start"
          sideOffset={6}
          aria-label="Filter by patterns"
        >
          <Input
            aria-label="Find a pattern"
            placeholder="Find a pattern…"
            value={tagSearch}
            onChange={(e) => setTagSearch(e.target.value)}
          />
          <div className="tag-filter-options">
            {tags
              ?.filter(
                (tag) => !tag.archived && tag.name.toLowerCase().includes(tagSearch.toLowerCase()),
              )
              .map((tag) => (
                <Label className="tag-filter-option" key={tag.id}>
                  <Checkbox
                    checked={selectedTags.includes(tag.id)}
                    onCheckedChange={(checked) =>
                      filter(
                        'tags',
                        (checked === true
                          ? [...selectedTags, tag.id]
                          : selectedTags.filter((id) => id !== tag.id)
                        ).join(','),
                      )
                    }
                  />
                  <span className="tag-colour tag-label" style={tagColour(tag)}>
                    {tag.name}
                  </span>
                </Label>
              ))}
            {tags &&
              !tags.some(
                (tag) => !tag.archived && tag.name.toLowerCase().includes(tagSearch.toLowerCase()),
              ) && <p className="muted">No matching tags.</p>}
          </div>
          <div className="tag-filter-actions">
            <SelectField
              aria-label="Match selected patterns"
              value={params.get('tagMode') ?? 'any'}
              onValueChange={(value) => filter('tagMode', value)}
            >
              <SelectOption value="any">Match any pattern</SelectOption>
              <SelectOption value="all">Match all patterns</SelectOption>
            </SelectField>
            <Button
              variant="ghost"
              disabled={!selectedTags.length}
              onClick={() => filter('tags', '')}
            >
              Clear
            </Button>
            <Button variant="outline" onClick={() => setTagsOpen(false)}>
              Done
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
