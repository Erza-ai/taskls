import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getStore } from '$lib/server/store';

export const GET: RequestHandler = async () => {
	try {
		const data = await getStore();

		return json(data, {
			headers: {
				'Content-Disposition': 'attachment; filename="store-backup.json"'
			}
		});
	} catch (error) {
		console.error('Download backup endpoint error:', error);
		return json({ error: 'Failed to read database backup' }, { status: 500 });
	}
};
