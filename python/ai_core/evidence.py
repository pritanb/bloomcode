"""Shared platform reads and bounded source context."""
import json


async def call(session, tool, args):
    result = await session.call_tool(tool, args)
    data = json.loads(result.content[0].text)
    if result.isError:
        if data.get('error', {}).get('status') == 403:
            raise PermissionError('Finish or cancel active practice before viewing study evidence.')
        raise RuntimeError('Study evidence is unavailable. Retry when BloomCode is running.')
    return data


def compact(context, *, limits=(('code', 16000), ('notes', 4000), ('takeaway', 2000))):
    attempt = dict(context['attempt'])
    truncated = []
    for key, limit in limits:
        value = attempt.get(key)
        if isinstance(value, str) and len(value) > limit:
            attempt[key] = value[:limit]
            truncated.append(key)
    return {'attempt': attempt, 'truncatedFields': truncated,
            'historyOmitted': len(context.get('history', []))}


def matches_source(observation, attempt):
    source = attempt.get(observation.get("sourceField"))
    source = source if isinstance(source, str) else json.dumps(source, separators=(",", ":"), ensure_ascii=False)
    excerpt = observation.get("excerpt", "")
    return bool(excerpt and excerpt in source)


def source_window(value, excerpts, limit):
    if len(value) <= limit:
        return value, False
    # Keep a bounded contiguous window around a cited excerpt, not just the file prefix.
    anchor = next((value.find(e) for e in excerpts if e and e in value), 0)
    start = max(0, anchor - min(500, limit // 4))
    return value[start:start + limit], True
