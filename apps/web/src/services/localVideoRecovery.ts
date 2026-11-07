/** Match a retained local video to an archive row without guessing.
 * The browser stores only the last opted-in local original. A matching
 * filename alone is insufficient: two different videos may share one name.
 */
export function savedLocalMatchesArchive(
  archived: { filename: string; file_size: number | null },
  local: { name: string; file: Blob },
): boolean {
  if (!archived || !local || typeof archived.filename !== 'string' ||
      typeof local.name !== 'string' || !(local.file instanceof Blob)) return false;
  const size = archived.file_size;
  if (typeof size !== 'number' || !Number.isSafeInteger(size) || size <= 0) return false;
  const clean = (name: string) => name.normalize('NFC').trim().toLowerCase();
  return clean(archived.filename).length > 0 &&
    clean(archived.filename) === clean(local.name) &&
    local.file.size === size;
}
