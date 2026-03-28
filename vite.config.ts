import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import fs from 'fs';
import path from 'path';

// Vite's static middleware fails to serve files with & in the name when
// percent-encoded as %26 — requests fall through to SvelteKit's 404 route.
// This plugin intercepts /docs/* requests and serves from static/docs/ directly.
const serveStaticDocs = {
	name: 'serve-static-docs',
	configureServer(server: { middlewares: { use: (path: string, fn: (req: { url?: string }, res: { setHeader: (k: string, v: string) => void; end: (buf: Buffer) => void }, next: () => void) => void) => void } }) {
		server.middlewares.use('/docs', (req, res, next) => {
			const decoded = decodeURIComponent(req.url ?? '');
			const filePath = path.join(process.cwd(), 'static', 'docs', decoded);
			if (fs.existsSync(filePath)) {
				res.setHeader('Content-Type', 'application/pdf');
				res.end(fs.readFileSync(filePath));
			} else {
				next();
			}
		});
	}
};

export default defineConfig({
	plugins: [sveltekit(), serveStaticDocs],
	server: {
		host: true
	}
});
