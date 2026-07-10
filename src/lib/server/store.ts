import fs from 'fs/promises';
import path from 'path';
import { env } from '$env/dynamic/private';
import OpenAI from 'openai';
import { google } from 'googleapis';

export interface TaskItem {
	text: string;
	status: 'Done' | 'Obstacle' | 'Carry Over';
	hours?: number;
	priority?: 'Low' | 'Medium' | 'High';
	project?: string;
	notes?: string;
	attachment?: string;
}

export interface TaskReport {
	employeeName: string;
	tasks: TaskItem[];
	submittedAt: string;
	wellness: 'Good' | 'Tired' | 'Blocked';
}

export interface WeeklyStore {
	weekStartDate: string; // YYYY-MM-DD (Monday)
	submissions: Record<string, Record<string, TaskReport>>; // employeeName -> { YYYY-MM-DD -> TaskReport }
	discordSent: Record<string, boolean>; // YYYY-MM-DD -> boolean
	weeklyDiscordSent: boolean;
}

const DATA_DIR = path.resolve('data');
const DATA_FILE = path.join(DATA_DIR, 'submissions.json');

// Get current date in UTC+7 (Asia/Jakarta)
export function getTodayDateString(): string {
	const d = new Date();
	const utc = d.getTime() + d.getTimezoneOffset() * 60000;
	const jktDate = new Date(utc + 3600000 * 7);
	const yyyy = jktDate.getFullYear();
	const mm = String(jktDate.getMonth() + 1).padStart(2, '0');
	const dd = String(jktDate.getDate()).padStart(2, '0');
	return `${yyyy}-${mm}-${dd}`;
}

export function getYesterdayDateString(): string {
	const d = new Date();
	const utc = d.getTime() + d.getTimezoneOffset() * 60000;
	const jktDate = new Date(utc + 3600000 * 7);
	jktDate.setDate(jktDate.getDate() - 1);
	const yyyy = jktDate.getFullYear();
	const mm = String(jktDate.getMonth() + 1).padStart(2, '0');
	const dd = String(jktDate.getDate()).padStart(2, '0');
	return `${yyyy}-${mm}-${dd}`;
}

// Get Monday of the current week in UTC+7 (Asia/Jakarta)
export function getMondayDateString(): string {
	const d = new Date();
	const utc = d.getTime() + d.getTimezoneOffset() * 60000;
	const jktDate = new Date(utc + 3600000 * 7);
	const day = jktDate.getDay();
	const diff = jktDate.getDate() - day + (day === 0 ? -6 : 1);
	const monday = new Date(jktDate.setDate(diff));
	const yyyy = monday.getFullYear();
	const mm = String(monday.getMonth() + 1).padStart(2, '0');
	const dd = String(monday.getDate()).padStart(2, '0');
	return `${yyyy}-${mm}-${dd}`;
}

// Check if current Jakarta time is Friday past 6 PM, Saturday, or Sunday
export function isPastFriday6PM(): boolean {
	const d = new Date();
	const utc = d.getTime() + d.getTimezoneOffset() * 60000;
	const jktDate = new Date(utc + 3600000 * 7);
	const day = jktDate.getDay(); // 0 = Sunday, 1 = Monday, ..., 5 = Friday, 6 = Saturday
	const hour = jktDate.getHours();

	if ((day === 5 && hour >= 18) || day === 6 || day === 0) {
		return true;
	}
	return false;
}

export async function getStore(): Promise<WeeklyStore> {
	const monday = getMondayDateString();
	let store: WeeklyStore;
	try {
		await fs.mkdir(DATA_DIR, { recursive: true });
		const data = await fs.readFile(DATA_FILE, 'utf-8');
		store = JSON.parse(data);

		// Reset if it's a new week
		if (store.weekStartDate !== monday) {
			store = {
				weekStartDate: monday,
				submissions: {},
				discordSent: {},
				weeklyDiscordSent: false
			};
			await saveStore(store);
		}
	} catch (error) {
		store = {
			weekStartDate: monday,
			submissions: {},
			discordSent: {},
			weeklyDiscordSent: false
		};
		await saveStore(store);
	}

	// Trigger Friday 6 PM weekly CSV report if not yet sent
	if (isPastFriday6PM() && !store.weeklyDiscordSent) {
		sendWeeklyDiscordCSV(store)
			.then((success) => {
				if (success) {
					store.weeklyDiscordSent = true;
					saveStore(store).catch((err) => console.error('Error saving weekly store status:', err));
				}
			})
			.catch((err) => console.error('Error sending weekly Discord CSV:', err));
	}

	return store;
}

async function saveStore(store: WeeklyStore): Promise<void> {
	await fs.mkdir(DATA_DIR, { recursive: true });
	await fs.writeFile(DATA_FILE, JSON.stringify(store, null, 2), 'utf-8');
}

export async function appendReportToSheets(
	employeeName: string,
	tasks: TaskItem[],
	wellness: 'Good' | 'Tired' | 'Blocked',
	targetDate?: string
): Promise<void> {
	try {
		const spreadsheetId = env.GOOGLE_SPREADSHEET_ID || process.env.GOOGLE_SPREADSHEET_ID;
		if (!spreadsheetId) {
			console.warn('GOOGLE_SPREADSHEET_ID is missing. Skipping Google Sheets logging.');
			return;
		}

		let credentials;
		const envKey = env.GOOGLE_SERVICE_ACCOUNT_KEY || process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
		if (envKey) {
			try {
				credentials = JSON.parse(envKey.trim());
			} catch (err) {
				console.error('Invalid GOOGLE_SERVICE_ACCOUNT_KEY JSON string:', err);
			}
		}

		if (!credentials) {
			const keyFile = path.join(path.resolve('data'), 'google-key.json');
			try {
				const keyContent = await fs.readFile(keyFile, 'utf-8');
				credentials = JSON.parse(keyContent);
			} catch (err) {
				console.warn('Google service account credentials not found (checked GOOGLE_SERVICE_ACCOUNT_KEY env var and data/google-key.json). Skipping Google Sheets logging.');
				return;
			}
		}

		if (credentials && typeof credentials.private_key === 'string') {
			credentials.private_key = credentials.private_key.replace(/\\n/g, '\n');
		}

		const auth = new google.auth.GoogleAuth({
			credentials,
			scopes: ['https://www.googleapis.com/auth/spreadsheets']
		});

		const sheets = google.sheets({ version: 'v4', auth });
		const todayStr = targetDate || getTodayDateString();

		// Fetch spreadsheet sheetId for "Erza-Report" or fallback
		const spreadsheetInfo = await sheets.spreadsheets.get({ spreadsheetId });
		let sheet = spreadsheetInfo.data.sheets?.find((s) => s.properties?.title === 'Erza-Report');
		if (!sheet) {
			sheet = spreadsheetInfo.data.sheets?.find((s) => s.properties?.title === 'Sheet1') || spreadsheetInfo.data.sheets?.[0];
		}
		const sheetName = sheet?.properties?.title || 'Sheet1';
		const sheetId = sheet?.properties?.sheetId || 0;

		// Read existing rows to clear previous submissions for today to avoid duplicates
		const getRes = await sheets.spreadsheets.values.get({
			spreadsheetId,
			range: `${sheetName}!A:K`
		});
		const rows = getRes.data.values || [];

		const rowsToDelete: number[] = [];
		for (let i = 0; i < rows.length; i++) {
			const row = rows[i];
			if (row && row.length > 2) {
				const rowDateStr = row[1];
				const rowName = row[2];

				let datesMatch = false;
				if (rowDateStr === todayStr) {
					datesMatch = true;
				} else {
					try {
						const d1 = new Date(rowDateStr);
						const d2 = new Date(todayStr);
						datesMatch = !isNaN(d1.getTime()) && !isNaN(d2.getTime()) &&
							d1.getFullYear() === d2.getFullYear() &&
							d1.getMonth() === d2.getMonth() &&
							d1.getDate() === d2.getDate();
					} catch (e) {
						datesMatch = false;
					}
				}

				if (datesMatch && rowName === employeeName) {
					rowsToDelete.push(i);
				}
			}
		}

		if (rowsToDelete.length > 0) {
			rowsToDelete.reverse();
			const requests = rowsToDelete.map((rowIndex) => ({
				deleteDimension: {
					range: {
						sheetId,
						dimension: 'ROWS',
						startIndex: rowIndex,
						endIndex: rowIndex + 1
					}
				}
			}));

			await sheets.spreadsheets.batchUpdate({
				spreadsheetId,
				requestBody: {
					requests
				}
			});
			console.log(`Cleared ${rowsToDelete.length} existing rows for ${employeeName} today in Google Sheets.`);
		}

		// Prepare row values. Each task is a separate row.
		// Columns: Timestamp, Date, Employee Name, Project, Task Description, Status, Hours, Priority, Notes, Attachment, Wellness
		const timestamp = new Date().toISOString();
		const values = tasks.map((task) => [
			timestamp,
			todayStr,
			employeeName,
			task.project || 'General',
			task.text.trim(),
			task.status,
			task.hours || 1,
			task.priority || 'Medium',
			task.notes || '',
			task.attachment || '',
			wellness
		]);

		await sheets.spreadsheets.values.append({
			spreadsheetId,
			range: `${sheetName}!A:K`,
			valueInputOption: 'USER_ENTERED',
			requestBody: {
				values
			}
		});
		console.log(`Successfully logged ${tasks.length} tasks to Google Sheets (${sheetName}) for ${employeeName}`);
	} catch (error) {
		console.error('Error logging to Google Sheets:', error);
	}
}

export async function saveReport(
	employeeName: string,
	tasks: TaskItem[],
	wellness: 'Good' | 'Tired' | 'Blocked',
	targetDate?: string
): Promise<WeeklyStore> {
	const store = await getStore();
	const dateStr = targetDate || getTodayDateString();

	if (!store.submissions[employeeName]) {
		store.submissions[employeeName] = {};
	}

	store.submissions[employeeName][dateStr] = {
		employeeName,
		tasks,
		submittedAt: new Date().toISOString(),
		wellness
	};

	await saveStore(store);

	// Sync to Sheets
	appendReportToSheets(employeeName, tasks, wellness, dateStr).catch((error) => {
		console.error('Async error in appendReportToSheets:', error);
	});

	// Send instant Obstacle Alert if any exist
	const obstacles = tasks.filter((t) => t.status === 'Obstacle');
	if (obstacles.length > 0) {
		sendObstacleAlert(employeeName, obstacles).catch((error) => {
			console.error('Async error in sendObstacleAlert:', error);
		});
	}

	return store;
}

export function getEmployeesList(): string[] {
	const employeesStr = env.EMPLOYEES || process.env.EMPLOYEES || '';
	return employeesStr
		.split(',')
		.map((name: string) => name.trim())
		.filter((name: string) => name.length > 0);
}

function getOpenAIClient(): OpenAI | null {
	const apiKey = env.AI_API_KEY || process.env.AI_API_KEY || env.OPENAI_API_KEY || process.env.OPENAI_API_KEY || '';
	if (!apiKey) {
		return null;
	}

	const baseURL = env.AI_BASE_URL || process.env.AI_BASE_URL || undefined;

	return new OpenAI({
		apiKey,
		baseURL: baseURL || undefined
	});
}

export async function generateAISummary(store: WeeklyStore, targetDate?: string): Promise<string | null> {
	const openai = getOpenAIClient();
	if (!openai) {
		console.warn('OpenAI SDK API key is missing. Skipping AI summarization.');
		return null;
	}

	const model = env.AI_MODEL || process.env.AI_MODEL || 'gpt-4o-mini';
	const employees = getEmployeesList();
	const dateStr = targetDate || getTodayDateString();

	const reportList = employees
		.map((name) => {
			const report = store.submissions[name]?.[dateStr];
			if (report) {
				const tasksFormatted = report.tasks
					.map((t) => `- [${t.status}] [Project: ${t.project || 'General'}] [Priority: ${t.priority || 'Medium'}] ${t.text.trim()} (Duration: ${t.hours || 1} hours)`)
					.join('\n  ');
				let details = `- **${name}**:\n  ${tasksFormatted}`;
				if (report.notes) details += `\n  Notes: ${report.notes}`;
				return details;
			}
			return `- **${name}**: Has not submitted daily report.`;
		})
		.join('\n\n');

	const prompt = `You are a project manager assistant summarizing the Daily Task Reports of a development team.
Here is the list of daily tasks of the employees on ${formatIndonesianDate(today)}:

${reportList}

Please generate a professional, concise, and informative Executive Summary in English.
The summary must use markdown format with the following guidelines:
1. A brief summary of the team's overall progress today (2-3 sentences).
2. Key achievements of the team (Major Achievements) or finished work (Done).
3. Tasks carried over to the next work day (Carry Over).
4. Clearly highlight any obstacles (Obstacles) if reported.
The summary must be written in professional English, concise and to the point. Do not include introductory greetings or concluding signatures.`;

	try {
		const response = await openai.chat.completions.create({
			model,
			messages: [
				{
					role: 'system',
					content:
						'Anda adalah manajer proyek handal yang ahli merangkum laporan tim secara profesional dan ringkas.'
				},
				{ role: 'user', content: prompt }
			],
			temperature: 0.5
		});

		const summary = response.choices[0]?.message?.content;
		return summary || null;
	} catch (error) {
		console.error('Error generating AI Summary:', error);
		return null;
	}
}

export async function sendObstacleAlert(
	employeeName: string,
	obstacles: TaskItem[]
): Promise<void> {
	const webhookUrl = env.DISCORD_WEBHOOK_URL || process.env.DISCORD_WEBHOOK_URL;
	if (!webhookUrl || webhookUrl.includes('dummy-id') || webhookUrl === '') return;

	const fields = obstacles.map((obs) => {
		let val = `[Project: **${obs.project || 'General'}**] [Priority: **${obs.priority || 'Medium'}**] ${obs.text.trim()} (Duration: **${obs.hours || 1}h**)`;
		if (obs.notes && obs.notes.trim()) {
			val += `\n📝 **Notes:** ${obs.notes.trim()}`;
		}
		if (obs.attachment && obs.attachment.trim()) {
			val += `\n📎 **Attachment:** ${obs.attachment.trim()}`;
		}
		return {
			name: '⚠️ Obstacle',
			value: val,
			inline: false
		};
	});

	const payload = {
		content: '⚠️ **ATTENTION: New Obstacle / Blocker Reported!**',
		embeds: [
			{
				title: `Obstacle reported by ${employeeName}`,
				color: 16729156, // Red #ff3b30
				fields: fields,
				timestamp: new Date().toISOString()
			}
		]
	};

	try {
		await fetch(webhookUrl, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify(payload)
		});
	} catch (error) {
		console.error('Error sending Obstacle alert to Discord:', error);
	}
}

export async function pokePendingEmployees(targetDate?: string): Promise<boolean> {
	const webhookUrl = env.DISCORD_WEBHOOK_URL || process.env.DISCORD_WEBHOOK_URL;
	if (!webhookUrl || webhookUrl.includes('dummy-id') || webhookUrl === '') return false;

	const store = await getStore();
	const dateStr = targetDate || getTodayDateString();
	const employees = getEmployeesList();

	const pending: string[] = [];
	for (const name of employees) {
		if (!store.submissions[name] || !store.submissions[name][dateStr]) {
			pending.push(name);
		}
	}

	if (pending.length === 0) {
		return false;
	}

	const dateFormatted = formatIndonesianDate(dateStr);
	const payload = {
		content: `⏰ **DAILY REPORT REMINDER**\n\nHello team, the following members have not submitted their daily reports for **${dateFormatted}**:\n${pending.map((name) => `• **${name}**`).join('\n')}\n\nPlease fill it out as soon as possible! Thank you 🙏`
	};

	try {
		await fetch(webhookUrl, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify(payload)
		});
		return true;
	} catch (error) {
		console.error('Error sending Poke Pending alert:', error);
		return false;
	}
}

export function compileWeeklyCSV(store: WeeklyStore): string {
	const headers = [
		'Timestamp',
		'Date',
		'Employee Name',
		'Project',
		'Task Description',
		'Status',
		'Hours',
		'Priority',	
		'Notes',
		'Attachment',
		'Wellness'
		
		
	];
	const rows = [headers.join(',')];

	for (const employeeName in store.submissions) {
		const dates = store.submissions[employeeName];
		for (const dateStr in dates) {
			const report = dates[dateStr];
			for (const task of report.tasks) {
				const escapedTask = `"${task.text.replace(/"/g, '""')}"`;
				const escapedNotes = task.notes ? `"${task.notes.replace(/"/g, '""')}"` : '""';
				const escapedAttachment = task.attachment ? `"${task.attachment.replace(/"/g, '""')}"` : '""';
				const escapedProject = `"${(task.project || 'General').replace(/"/g, '""')}"`;

				const row = [
					report.submittedAt,
					dateStr,
					employeeName,
					escapedProject,
					escapedTask,
					task.status,
					task.hours || 1,
					task.priority || 'Medium',
					escapedNotes,
					escapedAttachment,
					report.wellness || 'Good'
				];
				rows.push(row.join(','));
			}
		}
	}
	return rows.join('\n');
}

export async function sendWeeklyDiscordCSV(store: WeeklyStore): Promise<boolean> {
	const webhookUrl = env.DISCORD_WEBHOOK_URL || process.env.DISCORD_WEBHOOK_URL;
	if (!webhookUrl || webhookUrl.includes('dummy-id') || webhookUrl === '') return false;

	const csvContent = compileWeeklyCSV(store);
	const formData = new FormData();

	const payload = {
		content: `📊 **COLLECTIVE WEEKLY REPORT (WEEKLY SUMMARY)**\nHere is the summary of the team's work from **${formatIndonesianDate(store.weekStartDate)}** until today.`,
		embeds: [
			{
				title: 'Weekly Team Report',
				description: 'The summary of all tasks and progress is attached in the CSV file below.',
				color: 3066993, // Green #2ecc71
				timestamp: new Date().toISOString()
			}
		]
	};

	formData.append('payload_json', JSON.stringify(payload));

	const blob = new Blob([csvContent], { type: 'text/csv' });
	formData.append('files[0]', blob, `weekly-report-${store.weekStartDate}.csv`);

	try {
		const res = await fetch(webhookUrl, {
			method: 'POST',
			body: formData
		});
		return res.ok;
	} catch (error) {
		console.error('Error sending weekly CSV report:', error);
		return false;
	}
}

export async function sendDiscordWebhook(store: WeeklyStore, targetDate?: string): Promise<boolean> {
	const webhookUrl = env.DISCORD_WEBHOOK_URL || process.env.DISCORD_WEBHOOK_URL;
	if (!webhookUrl || webhookUrl.includes('dummy-id') || webhookUrl === '') {
		console.warn('Discord Webhook URL is not configured or is a dummy. Skipping webhook call.');
		return false;
	}

	const dateStr = targetDate || getTodayDateString();
	const employees = getEmployeesList();

	let submissionsCount = 0;
	for (const name of employees) {
		if (store.submissions[name] && store.submissions[name][dateStr]) {
			submissionsCount++;
		}
	}

	const statusEmoji = {
		'Done': '✅',
		'Obstacle': '⚠️',
		'Carry Over': '⏩'
	};

	let aiSummary: string | null = null;
	try {
		aiSummary = await generateAISummary(store, dateStr);
	} catch (error) {
		console.error('Graceful failure during AI Summary generation:', error);
	}

	const fields = [];

	for (const name of employees) {
		const report = store.submissions[name]?.[dateStr];
		if (report) {
			let tasksFormatted = report.tasks
				.map((t) => {
					let line = `${statusEmoji[t.status] || '❓'} [${t.project || 'General'}] [${t.priority || 'Medium'}] ${t.text.trim()} (${t.hours || 1}h)`;
					if (t.notes && t.notes.trim()) line += `\n   *Notes:* ${t.notes.trim()}`;
					if (t.attachment && t.attachment.trim()) line += `\n   *Link:* ${t.attachment.trim()}`;
					return line;
				})
				.join('\n');

			if (report.wellness) {
				const wellnessEmoji =
					report.wellness === 'Good' ? '🟢' : report.wellness === 'Tired' ? '🟡' : '🔴';
				tasksFormatted = `Wellness: ${wellnessEmoji} **${report.wellness}**\n${tasksFormatted}`;
			}

			fields.push({
				name: `👤 ${name}`,
				value: tasksFormatted || '*No tasks*',
				inline: false
			});
		} else {
			fields.push({
				name: `👤 ${name} (❌ Pending)`,
				value: '*No report submitted for today.*',
				inline: false
			});
		}
	}

	const embeds: any[] = [];
	const todayFormatted = formatIndonesianDate(dateStr);

	if (aiSummary) {
		embeds.push({
			title: `🤖 AI EXECUTIVE SUMMARY (${todayFormatted})`,
			description: aiSummary,
			color: 16770304, // Bright yellow #FFE600
			footer: {
				text: 'Automated summary generated by AI'
			},
			timestamp: new Date().toISOString()
		});

		embeds.push({
			title: `📋 EMPLOYEE REPORT DETAILS (${todayFormatted})`,
			description: `**Submission Progress:** ${submissionsCount}/${employees.length} Employees`,
			color: 8246268, // Sky blue (#7dd3fc)
			fields: fields,
			footer: {
				text: 'TaskLS • Submitted collectively'
			}
		});
	} else {
		embeds.push({
			title: `📋 DAILY TASK REPORT (${todayFormatted})`,
			description: `**Submission Progress:** ${submissionsCount}/${employees.length} Employees`,
			color: 16770304, // Bright yellow #FFE600
			fields: fields,
			footer: {
				text: 'TaskLS • Submitted collectively'
			},
			timestamp: new Date().toISOString()
		});
	}

	try {
		const response = await fetch(webhookUrl, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({ embeds })
		});

		if (!response.ok) {
			const errText = await response.text();
			console.error(`Discord Webhook failed: ${response.status} ${response.statusText} - ${errText}`);
			return false;
		}

		return true;
	} catch (error) {
		console.error('Error sending to Discord Webhook:', error);
		return false;
	}
}

export async function checkAndSendToDiscord(targetDate?: string): Promise<{ sent: boolean; message: string }> {
	const store = await getStore();
	const dateStr = targetDate || getTodayDateString();

	if (store.discordSent[dateStr]) {
		return { sent: false, message: `Report for ${dateStr} has already been sent to Discord.` };
	}

	const employees = getEmployeesList();
	if (employees.length === 0) {
		return { sent: false, message: 'No employees configured.' };
	}

	const hasAllSubmitted = employees.every((name) => store.submissions[name]?.[dateStr] !== undefined);
	if (!hasAllSubmitted) {
		return { sent: false, message: 'Not all employees have submitted their report.' };
	}

	const success = await sendDiscordWebhook(store, dateStr);
	if (success) {
		store.discordSent[dateStr] = true;
		await saveStore(store);
		return { sent: true, message: 'Report successfully sent to Discord!' };
	} else {
		return { sent: false, message: 'Failed to send report to Discord. Please check server logs.' };
	}
}

export function formatIndonesianDate(dateStr: string): string {
	const parts = dateStr.split('-');
	if (parts.length !== 3) return dateStr;
	const year = parts[0];
	const monthIdx = parseInt(parts[1], 10) - 1;
	const day = parts[2];

	const months = [
		'January',
		'February',
		'March',
		'April',
		'May',
		'June',
		'July',
		'August',
		'September',
		'October',
		'November',
		'December'
	];

	const d = new Date(parseInt(year, 10), monthIdx, parseInt(day, 10));
	const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
	const dayName = days[d.getDay()];

	return `${dayName}, ${parseInt(day, 10)} ${months[monthIdx]} ${year}`;
}


function normalizeDateStr(rawDateStr: string): string {
	if (!rawDateStr) return '';
	const trimmed = rawDateStr.trim();
	
	// If already in YYYY-MM-DD format, return it
	if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
		return trimmed;
	}

	// Try to match DD/MM/YYYY or MM/DD/YYYY
	const slashMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
	if (slashMatch) {
		const part1 = parseInt(slashMatch[1], 10);
		const part2 = parseInt(slashMatch[2], 10);
		const year = parseInt(slashMatch[3], 10);

		let month = part2;
		let day = part1;

		if (part1 === 7 && part2 !== 7) {
			// Likely MM/DD/YYYY (July is month 7)
			month = part1;
			day = part2;
		} else if (part2 === 7 && part1 !== 7) {
			// Likely DD/MM/YYYY (July is month 7)
			month = part2;
			day = part1;
		} else if (part2 > 12) {
			// Month cannot be > 12, so part1 is month
			month = part1;
			day = part2;
		} else {
			// Default to Indonesian standard DD/MM/YYYY
			month = part2;
			day = part1;
		}

		const mm = String(month).padStart(2, '0');
		const dd = String(day).padStart(2, '0');
		return `${year}-${mm}-${dd}`;
	}

	// Try standard JS Date parsing fallback
	try {
		const d = new Date(trimmed);
		if (!isNaN(d.getTime())) {
			const yyyy = d.getFullYear();
			const mm = String(d.getMonth() + 1).padStart(2, '0');
			const dd = String(d.getDate()).padStart(2, '0');
			return `${yyyy}-${mm}-${dd}`;
		}
	} catch (e) {}

	return trimmed;
}

// Reconstruct the store object
export async function importFromSheets(): Promise<{ success: boolean; count: number; message: string }> {
	const spreadsheetId = env.GOOGLE_SPREADSHEET_ID || process.env.GOOGLE_SPREADSHEET_ID;
	if (!spreadsheetId) {
		throw new Error('GOOGLE_SPREADSHEET_ID is missing.');
	}

	let credentials;
	const envKey = env.GOOGLE_SERVICE_ACCOUNT_KEY || process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
	if (envKey) {
		try {
			credentials = JSON.parse(envKey.trim());
		} catch (err) {
			console.error('Invalid GOOGLE_SERVICE_ACCOUNT_KEY JSON string:', err);
		}
	}

	if (!credentials) {
		const keyFile = path.join(path.resolve('data'), 'google-key.json');
		try {
			const keyContent = await fs.readFile(keyFile, 'utf-8');
			credentials = JSON.parse(keyContent);
		} catch (err) {
			throw new Error('Google service account credentials not found.');
		}
	}

	if (credentials && typeof credentials.private_key === 'string') {
		credentials.private_key = credentials.private_key.replace(/\\n/g, '\n');
	}

	const auth = new google.auth.GoogleAuth({
		credentials,
		scopes: ['https://www.googleapis.com/auth/spreadsheets']
	});

	const sheets = google.sheets({ version: 'v4', auth });

	const spreadsheetInfo = await sheets.spreadsheets.get({ spreadsheetId });
	let sheet = spreadsheetInfo.data.sheets?.find((s) => s.properties?.title === 'Erza-Report');
	if (!sheet) {
		sheet = spreadsheetInfo.data.sheets?.find((s) => s.properties?.title === 'Sheet1') || spreadsheetInfo.data.sheets?.[0];
	}
	const sheetName = sheet?.properties?.title || 'Sheet1';

	const getRes = await sheets.spreadsheets.values.get({
		spreadsheetId,
		range: `${sheetName}!A:K`
	});
	const rows = getRes.data.values || [];

	if (rows.length <= 1) {
		return { success: true, count: 0, message: 'Google Sheet is empty.' };
	}

	const store = await getStore();
	store.submissions = {};

	let importCount = 0;

	for (let i = 1; i < rows.length; i++) {
		const row = rows[i];
		if (!row || row.length < 3) continue;

		const timestamp = row[0] || new Date().toISOString();
		const rawDateStr = row[1];
		const dateStr = normalizeDateStr(rawDateStr);
		const employeeName = row[2];
		const project = row[3] || 'General';
		const taskText = row[4];
		const status = (row[5] || 'Done') as 'Done' | 'Obstacle' | 'Carry Over';
		const hours = Number(row[6]) || 1;
		const priority = (row[7] || 'Medium') as 'Low' | 'Medium' | 'High';
		const notes = row[8] || '';
		const attachment = row[9] || '';
		const wellness = (row[10] || 'Good') as 'Good' | 'Tired' | 'Blocked';

		if (!dateStr || !employeeName || !taskText) continue;

		if (!store.submissions[employeeName]) {
			store.submissions[employeeName] = {};
		}

		if (!store.submissions[employeeName][dateStr]) {
			store.submissions[employeeName][dateStr] = {
				tasks: [],
				wellness,
				submittedAt: timestamp
			};
		}

		const report = store.submissions[employeeName][dateStr];
		const taskExists = report.tasks.some(
			(t) => t.text === taskText && t.project === project && t.status === status
		);

		if (!taskExists) {
			report.tasks.push({
				text: taskText,
				status,
				hours,
				priority,
				project,
				notes,
				attachment
			});
			importCount++;
		}
	}

	await saveStore(store);
	return { success: true, count: importCount, message: `Successfully imported ${importCount} tasks from Google Sheets!` };
}
