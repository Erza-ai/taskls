import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import fs from 'fs/promises';
import path from 'path';
import {
	getStore,
	saveReport,
	checkAndSendToDiscord,
	getEmployeesList,
	formatIndonesianDate,
	getTodayDateString,
	getYesterdayDateString,
	pokePendingEmployees
} from '$lib/server/store';

export const load: PageServerLoad = async () => {
	const store = await getStore();
	const employees = getEmployeesList();
	const today = getTodayDateString();
	const yesterday = getYesterdayDateString();

	return {
		employees,
		submissions: store.submissions,
		discordSent: store.discordSent,
		todayDate: today,
		todayDateFormatted: formatIndonesianDate(today),
		yesterdayDate: yesterday,
		yesterdayDateFormatted: formatIndonesianDate(yesterday)
	};
};

export const actions: Actions = {
	submitReport: async ({ request }) => {
		const data = await request.formData();
		const employeeName = data.get('employeeName')?.toString().trim();
		const tasksStr = data.get('tasks')?.toString();
		const wellness = (data.get('wellness')?.toString() || 'Good') as 'Good' | 'Tired' | 'Blocked';
		const targetDate = data.get('targetDate')?.toString().trim();

		// Validation
		if (!employeeName) {
			return fail(400, {
				error: 'Employee name must be selected.',
				values: { employeeName }
			});
		}

		const employees = getEmployeesList();
		if (!employees.includes(employeeName)) {
			return fail(400, {
				error: 'Employee name is not registered.',
				values: { employeeName }
			});
		}

		let tasks: Array<{ text: string; status: 'Done' | 'Obstacle' | 'Carry Over'; hours: number; priority: 'Low' | 'Medium' | 'High'; project: string }> = [];
		try {
			if (tasksStr) {
				tasks = JSON.parse(tasksStr);
			}
		} catch (e) {
			return fail(400, {
				error: 'Task data format is invalid.',
				values: { employeeName }
			});
		}

		if (!Array.isArray(tasks) || tasks.length === 0) {
			return fail(400, {
				error: 'Tasks list cannot be empty.',
				values: { employeeName }
			});
		}

		const validStatuses = ['Done', 'Obstacle', 'Carry Over'];
		const validPriorities = ['Low', 'Medium', 'High'];
		for (let i = 0; i < tasks.length; i++) {
			const item = tasks[i];
			if (!item.text || !item.text.trim()) {
				return fail(400, {
					error: `Task #${i + 1} description cannot be empty.`,
					values: { employeeName }
				});
			}
			if (!item.status || !validStatuses.includes(item.status)) {
				return fail(400, {
					error: `Task #${i + 1} status is invalid.`,
					values: { employeeName }
				});
			}
			// Parse & default hours
			let parsedHours = parseFloat(item.hours as any);
			if (isNaN(parsedHours) || parsedHours <= 0) {
				parsedHours = 1;
			}
			item.hours = parsedHours;

			// Validate & default priority
			if (!item.priority || !validPriorities.includes(item.priority)) {
				item.priority = 'Medium';
			}

			// Validate & default project
			if (!item.project || !item.project.trim()) {
				item.project = 'General';
			} else {
				item.project = item.project.trim();
			}

			// Sanitize task notes & attachment
			item.notes = item.notes?.trim() || '';
			item.attachment = item.attachment?.trim() || '';
		}

		try {
			// Save the report
			await saveReport(employeeName, tasks as any, wellness, targetDate);

			// Check if all employees have submitted, send webhook asynchronously in background
			checkAndSendToDiscord(targetDate).catch((error) => {
				console.error('Async error in checkAndSendToDiscord:', error);
			});

			return {
				success: true,
				message: 'Report successfully saved!'
			};
		} catch (error) {
			console.error('Server error handling submission:', error);
			return fail(500, {
				error: 'Internal server error occurred. Please try again.',
				values: { employeeName }
			});
		}
	},

	pokePending: async ({ request }) => {
		const data = await request.formData();
		const targetDate = data.get('targetDate')?.toString().trim();
		try {
			const poked = await pokePendingEmployees(targetDate);
			if (poked) {
				return {
					success: true,
					message: 'Reminder successfully sent to Discord!'
				};
			} else {
				return fail(400, {
					error: `Failed to send reminder (perhaps all employees have already submitted for ${targetDate || 'today'}).`
				});
			}
		} catch (error) {
			console.error('Server error handling Poke Pending:', error);
			return fail(500, {
				error: 'Internal server error occurred while sending reminder.'
			});
		}
	}
};
