// ponytail: prefix match only. The browser has no homedir, so anything outside these homes stays intact.
export function shortenPath(path: string) {
  return path
    .replace(/^[A-Za-z]:[\\/]Users[\\/][^\\/]+/, '~')
    .replace(/^\\\\wsl(?:\$|\.localhost)\\[^\\]+\\home\\[^\\]+/i, '~')
    .replace(/^\/mnt\/[a-z]\/Users\/[^/]+/, '~')
    .replace(/^\/(?:Users|home)\/[^/]+/, '~')
}
