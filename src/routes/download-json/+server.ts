import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import fs from 'fs/promises';
import path from 'path';

export const GET: RequestHandler = async () => {
	const DATA_DIR = path.resolve('data');
	const DATA_FILE = path.join(DATA_DIR, 'store.json');

	try {
		let content;
		try {
			content = await fs.readFile(DATA_FILE, 'utf-8');
		} catch (err: any) {
			if (err.code === 'ENOENT') {
				const defaultStore = { submissions: {}, discordSent: {} };
				await fs.mkdir(DATA_DIR, { recursive: true });
				await fs.writeFile(DATA_FILE, JSON.stringify(defaultStore, null, 2), 'utf-8');
				content = JSON.stringify(defaultStore);
			} else {
				throw err;
			}
		}
		const data = JSON.parse(content);

		return json(data, {
			headers: {
				'Content-Disposition': 'attachment; filename="store-backup.json"'
			}
		});
	} catch (error) {
		console.error('Download backup endpoint error:', error);
		return json({ error: 'Failed to read database file' }, { status: 500 });
	}
};
