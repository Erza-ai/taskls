import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';
import {
	getStore,
	saveReport,
	getEmployeesList,
	checkAndSendToDiscord,
	type TaskItem
} from '$lib/server/store';

const VALID_STATUS = ['Done', 'Obstacle', 'Carry Over', 'Hold'];
const VALID_PRIORITY = ['Low', 'Medium', 'High'];
const VALID_WELLNESS = ['Good', 'Tired', 'Blocked'];

function requireApiKey(request: Request): void {
	const configured = env.TASKLS_API_KEY || process.env.TASKLS_API_KEY;
	if (!configured) {
		throw error(503, 'Report API is disabled: TASKLS_API_KEY is not configured on the server.');
	}
	const header = request.headers.get('x-api-key');
	const bearer = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
	if ((header ?? bearer) !== configured) {
		throw error(401, 'Invalid or missing API key.');
	}
}

interface ReportPayload {
	employeeName?: string;
	targetDate?: string;
	wellness?: string;
	tasks?: unknown;
}

interface ValidReport {
	employeeName: string;
	targetDate?: string;
	wellness: 'Good' | 'Tired' | 'Blocked';
	tasks: TaskItem[];
}

/** Validate + normalize one report. Returns the clean report or an error message. */
function validateReport(payload: ReportPayload, employees: string[]): ValidReport | { error: string } {
	const employeeName = String(payload?.employeeName ?? '').trim();
	if (!employeeName) return { error: 'employeeName is required.' };
	if (!employees.includes(employeeName)) {
		return { error: `employeeName "${employeeName}" is not registered (check the EMPLOYEES env list).` };
	}

	const raw = payload?.tasks;
	if (!Array.isArray(raw) || raw.length === 0) {
		return { error: `tasks must be a non-empty array (employee "${employeeName}").` };
	}

	const tasks: TaskItem[] = [];
	for (let i = 0; i < raw.length; i++) {
		const item = (raw[i] ?? {}) as Record<string, unknown>;
		const text = String(item.text ?? '').trim();
		if (!text) return { error: `Task #${i + 1} (${employeeName}): text cannot be empty.` };

		const status = String(item.status ?? '');
		if (!VALID_STATUS.includes(status)) {
			return { error: `Task #${i + 1} (${employeeName}): status must be one of ${VALID_STATUS.join(', ')}.` };
		}

		let hours = parseFloat(String(item.hours));
		if (isNaN(hours) || hours <= 0) hours = 1;

		const priority = VALID_PRIORITY.includes(String(item.priority))
			? (String(item.priority) as TaskItem['priority'])
			: 'Medium';

		const project = String(item.project ?? '').trim() || 'General';

		tasks.push({
			text,
			status: status as TaskItem['status'],
			hours,
			priority,
			project,
			notes: String(item.notes ?? '').trim(),
			attachment: String(item.attachment ?? '').trim()
		});
	}

	const wellness = (VALID_WELLNESS.includes(String(payload?.wellness))
		? payload.wellness
		: 'Good') as 'Good' | 'Tired' | 'Blocked';

	const targetDate = String(payload?.targetDate ?? '').trim();
	if (targetDate && !/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
		return { error: `targetDate "${targetDate}" must be YYYY-MM-DD.` };
	}

	return { employeeName, targetDate: targetDate || undefined, wellness, tasks };
}

export const POST: RequestHandler = async ({ request }) => {
	requireApiKey(request);

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'Request body must be valid JSON.');
	}

	const payloads: ReportPayload[] = Array.isArray(body) ? (body as ReportPayload[]) : [body as ReportPayload];
	if (payloads.length === 0) throw error(400, 'No reports provided.');

	const employees = getEmployeesList();

	// Validate everything up front so a bad batch saves nothing.
	const validated: ValidReport[] = [];
	for (const p of payloads) {
		const result = validateReport(p, employees);
		if ('error' in result) throw error(400, result.error);
		validated.push(result);
	}

	const results: Array<{ employeeName: string; targetDate?: string; savedTasks: number }> = [];
	for (const report of validated) {
		await saveReport(report.employeeName, report.tasks, report.wellness, report.targetDate);
		// Fire the "all submitted" Discord check in the background, same as the form.
		checkAndSendToDiscord(report.targetDate).catch((err) =>
			console.error('Async error in checkAndSendToDiscord:', err)
		);
		results.push({
			employeeName: report.employeeName,
			targetDate: report.targetDate,
			savedTasks: report.tasks.length
		});
	}

	return json({ ok: true, saved: results.length, results });
};

export const GET: RequestHandler = async ({ request }) => {
	requireApiKey(request);
	const store = await getStore();
	return json({
		weekStartDate: store.weekStartDate,
		employees: getEmployeesList(),
		submissions: store.submissions
	});
};
