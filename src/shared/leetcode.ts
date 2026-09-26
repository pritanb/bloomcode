/** Returns the problem slug from a canonical LeetCode problem URL, or null for anything else. */
export function leetcodeSlug(url: string): string | null {
  // Match the original string, before URL() can repair whitespace or dot segments.
  const match =
    /^https:\/\/(?:www\.)?leetcode\.com\/problems\/([a-z0-9]+(?:-[a-z0-9]+)*)(?:\/(?:description|editorial|solutions|submissions))?\/?$/.exec(
      url,
    );
  return match?.[1] ?? null;
}
