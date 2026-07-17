import fs from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'csv-parse/sync';
import { MongoClient, ServerApiVersion } from 'mongodb';

const csvPath = process.argv[2];
const uri = process.env.MONGODB_URI;
const databaseName = process.env.MONGODB_DB_NAME || 'taskls';

if (!csvPath) {
	throw new Error('Usage: npm run import:csv -- <path-to-csv>');
}
if (!uri) {
	throw new Error('MONGODB_URI is not configured.');
}

const normalizeStatus = (value) => {
	const status = String(value || 'Done').trim().toLowerCase();
	if (status === 'obstacle') return 'Obstacle';
	if (status === 'carry over' || status === 'carryover') return 'Carry Over';
	if (status === 'hold') return 'Hold';
	return 'Done';
};

const normalizePriority = (value) => {
	const priority = String(value || 'Medium').trim().toLowerCase();
	if (priority === 'low') return 'Low';
	if (priority === 'high') return 'High';
	return 'Medium';
};

const normalizeWellness = (value) => {
	const wellness = String(value || 'Good').trim().toLowerCase();
	if (wellness === 'tired') return 'Tired';
	if (wellness === 'blocked') return 'Blocked';
	return 'Good';
};

const getJakartaMonday = () => {
	const jakartaNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
	const day = jakartaNow.getDay();
	jakartaNow.setDate(jakartaNow.getDate() - day + (day === 0 ? -6 : 1));
	const year = jakartaNow.getFullYear();
	const month = String(jakartaNow.getMonth() + 1).padStart(2, '0');
	const date = String(jakartaNow.getDate()).padStart(2, '0');
	return `${year}-${month}-${date}`;
};

const csv = await fs.readFile(path.resolve(csvPath), 'utf8');
const rows = parse(csv, {
	columns: true,
	skip_empty_lines: true,
	trim: true,
	bom: true,
	relax_column_count: true
});

const submissions = {};
let taskCount = 0;

for (const row of rows) {
	const date = String(row.Date || '').trim();
	const employeeName = String(row.Name || '').trim();
	const text = String(row['Task Description'] || '').trim();
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !employeeName || !text) continue;

	if (!submissions[employeeName]) submissions[employeeName] = {};
	if (!submissions[employeeName][date]) {
		submissions[employeeName][date] = {
			employeeName,
			tasks: [],
			submittedAt: new Date(`${date}T17:00:00+07:00`).toISOString(),
			wellness: normalizeWellness(row.Wellness)
		};
	}

	const hours = Number.parseFloat(row.Hours);
	submissions[employeeName][date].tasks.push({
		text,
		status: normalizeStatus(row.Status),
		hours: Number.isFinite(hours) && hours > 0 ? hours : 1,
		priority: normalizePriority(row.Priority),
		project: String(row.Project || 'General').trim() || 'General',
		notes: String(row.Notes || '').trim(),
		attachment: String(row.Attachment || '').trim()
	});
	taskCount++;
}

const client = new MongoClient(uri, {
	serverApi: {
		version: ServerApiVersion.v1,
		strict: true,
		deprecationErrors: true
	}
});

try {
	await client.connect();
	const collection = client.db(databaseName).collection('app_state');
	const existing = await collection.findOne({ _id: 'weekly-store' });
	const mergedSubmissions = existing?.submissions || {};

	for (const [employeeName, dates] of Object.entries(submissions)) {
		if (!mergedSubmissions[employeeName]) mergedSubmissions[employeeName] = {};
		for (const [date, report] of Object.entries(dates)) {
			mergedSubmissions[employeeName][date] = report;
		}
	}

	await collection.replaceOne(
		{ _id: 'weekly-store' },
		{
			_id: 'weekly-store',
			weekStartDate: existing?.weekStartDate || getJakartaMonday(),
			submissions: mergedSubmissions,
			discordSent: existing?.discordSent || {},
			weeklyDiscordSent: existing?.weeklyDiscordSent || false
		},
		{ upsert: true }
	);

	console.log(`Imported ${taskCount} tasks for ${Object.keys(submissions).length} employees into MongoDB Atlas.`);
} finally {
	await client.close();
}
