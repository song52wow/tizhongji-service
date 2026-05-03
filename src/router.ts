import http from 'http';
type Handler = (req: http.IncomingMessage, res: http.ServerResponse, params?: Record<string, string>) => void;

interface Route {
  method: string;
  path: string;
  handler: Handler;
}

export class Router {
  private routes: Route[] = [];

  constructor() {}

  get(path: string, handler: Handler): void {
    this.addRoute('GET', path, handler);
  }

  post(path: string, handler: Handler): void {
    this.addRoute('POST', path, handler);
  }

  put(path: string, handler: Handler): void {
    this.addRoute('PUT', path, handler);
  }

  delete(path: string, handler: Handler): void {
    this.addRoute('DELETE', path, handler);
  }

  private addRoute(method: string, path: string, handler: Handler): void {
    this.routes.push({ method, path, handler });
  }

  handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    const { method, url } = req;
    if (!method || !url) {
      res.writeHead(404);
      res.end();
      return;
    }

    const pathname = url.split('?')[0];

    for (const route of this.routes) {
      if (route.method !== method) continue;
      const match = this.matchPath(route.path, pathname);
      if (match) {
        (req as any).params = match.params;
        (req as any).query = this.parseQuery(url);
        route.handler(req, res);
        return;
      }
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: 'Not Found' }));
  }

  private matchPath(routePath: string, pathname: string): { params: Record<string, string> } | null {
    const routeParts = routePath.split('/');
    const pathParts = pathname.split('/');

    if (routeParts.length !== pathParts.length) return null;

    const params: Record<string, string> = {};
    for (let i = 0; i < routeParts.length; i++) {
      if (routeParts[i].startsWith(':')) {
        params[routeParts[i].slice(1)] = pathParts[i];
      } else if (routeParts[i] !== pathParts[i]) {
        return null;
      }
    }
    return { params };
  }

  private parseQuery(url: string): Record<string, string> {
    const queryStr = url.split('?')[1];
    if (!queryStr) return {};
    const query: Record<string, string> = {};
    for (const pair of queryStr.split('&')) {
      const [key, value] = pair.split('=');
      if (key) query[decodeURIComponent(key)] = decodeURIComponent(value || '');
    }
    return query;
  }
}