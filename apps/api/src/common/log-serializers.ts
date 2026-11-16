/**
 * What a request log line may contain: method, a path with secrets masked, status. No headers, no query strings,
 * no bodies, no IPs — invite tokens and emails would otherwise end up in logs and log shipping.
 */
const SECRET_PATHS: [RegExp, string][] = [
  [/^\/invites\/[^/?]+/, '/invites/:token'],
  [/^\/join\/[^/?]+/, '/join/:token'],
];

export function safePath(url: string | undefined): string {
  let path = (url ?? '').split('?')[0] ?? '';
  for (const [re, mask] of SECRET_PATHS) path = path.replace(re, mask);
  return path;
}

export const logSerializers = {
  req: (req: { id?: unknown; method?: string; url?: string }) => ({
    id: req.id,
    method: req.method,
    path: safePath(req.url),
  }),
  res: (res: { statusCode?: number }) => ({ statusCode: res.statusCode }),
};
