import type { RequestHandler } from './$types';
import fs from 'fs/promises';
import path from 'path';

export const GET: RequestHandler = async () => {
	const DATA_DIR = path.resolve('data');
	const DATA_FILE = path.join(DATA_DIR, 'store.json');

	try {
		const content = await fs.readFile(DATA_FILE, 'utf-8');
		const data = JSON.parse(content);

		return new Response(JSON.stringify(data, null, 2), {
			headers: {
				'Content-Type': 'application/json',
				'Content-Disposition': 'attachment; filename="store-backup.json"'
			}
		});
	} catch (error) {
		return new Response(JSON.stringify({ error: 'Failed to read database file' }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' }
		});
	}
};
