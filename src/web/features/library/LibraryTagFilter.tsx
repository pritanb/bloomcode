import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { SelectField, SelectOption } from '@/components/select-field';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import type { Tag } from '../../../shared/contracts';
import { TagDot } from './tags';
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
    <div className="flex min-w-0 flex-col gap-2">
      <Label htmlFor="tag-filter-trigger">Tags</Label>
      <Popover open={tagsOpen} onOpenChange={setTagsOpen}>
        <PopoverTrigger asChild>
          <Button
            id="tag-filter-trigger"
            variant="outline"
            className="w-full justify-between bg-card font-normal"
          >
            {selectedTags.length ? `${selectedTags.length} selected` : 'All tags'}
            <ChevronDown className="text-muted-foreground" aria-hidden="true" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2"
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
          <div className="-mx-1 max-h-64 overflow-y-auto">
            {tags
              ?.filter(
                (tag) => !tag.archived && tag.name.toLowerCase().includes(tagSearch.toLowerCase()),
              )
              .map((tag) => (
                <label
                  key={tag.id}
                  className="flex cursor-pointer items-center gap-2.5 rounded-lg p-2 text-sm font-normal text-foreground hover:bg-muted"
                >
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
                  <TagDot hue={tag.hue} />
                  <span className="min-w-0 truncate">{tag.name}</span>
                </label>
              ))}
            {tags &&
              !tags.some(
                (tag) => !tag.archived && tag.name.toLowerCase().includes(tagSearch.toLowerCase()),
              ) && <p className="p-2 text-sm text-muted-foreground">No matching tags.</p>}
          </div>
          <div className="flex items-center gap-1.5 border-t pt-2">
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
