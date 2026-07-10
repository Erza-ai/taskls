<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { onMount, tick } from 'svelte';
	import { slide, fade, fly } from 'svelte/transition';

	import { cn } from '$lib/utils';
	import * as Popover from '$lib/components/ui/popover/index.js';
	import * as Command from '$lib/components/ui/command/index.js';
	import * as RadioGroup from '$lib/components/ui/radio-group/index.js';

	let { data, form } = $props();

	let submitting = $state(false);
	let selectedEmployee = $state('');
	let tasks = $state<Array<{
		text: string;
		status: 'Done' | 'Obstacle' | 'Carry Over';
		hours: number;
		priority: 'Low' | 'Medium' | 'High';
		project: string;
		notes: string;
		attachment: string;
	}>>([
		{ text: '', status: 'Done', hours: 1, priority: 'Medium', project: '', notes: '', attachment: '' }
	]);
	let wellness = $state<'Good' | 'Tired' | 'Blocked'>('Good');

	// Active date tab selection (defaults to today)
	let activeDate = $state(data.todayDate);
	let targetDate = $state(data.todayDate);
	let showDatePicker = $state(false);

	// Search & Status filters
	let searchQuery = $state('');
	let statusFilter = $state('All');

	function addTask() {
		tasks.unshift({ text: '', status: 'Done', hours: 1, priority: 'Medium', project: '', notes: '', attachment: '' });
	}

	function removeTask(index: number) {
		if (tasks.length > 1) {
			tasks.splice(index, 1);
		}
	}

	function parseGitLog(text: string): string[] {
		const lines = text.split(/\r?\n/);
		const messages: string[] = [];

		if (text.includes('commit ') && text.includes('Author:')) {
			let currentMessage = '';
			for (const line of lines) {
				if (line.startsWith('commit ')) {
					if (currentMessage.trim()) {
						messages.push(currentMessage.trim());
					}
					currentMessage = '';
				} else if (line.startsWith('Author:') || line.startsWith('Date:') || line.startsWith('Merge:')) {
					continue;
				} else {
					if (line.trim() === '') {
						continue;
					}
					currentMessage += (currentMessage ? '\n' : '') + line.trim();
				}
			}
			if (currentMessage.trim()) {
				messages.push(currentMessage.trim());
			}
		} else {
			const onelineRegex = /^[0-9a-f]{7,40}\s+(.*)$/i;
			const commitHashRegex = /^commit\s+[0-9a-f]{7,40}\s+(.*)$/i;

			for (const line of lines) {
				const cleanLine = line.trim();
				if (!cleanLine) continue;

				const matchOneline = cleanLine.match(onelineRegex);
				if (matchOneline) {
					let message = matchOneline[1].trim();
					message = message.replace(/^\([^)]+\)\s*/, '');
					messages.push(message);
					continue;
				}

				const matchCommitHash = cleanLine.match(commitHashRegex);
				if (matchCommitHash) {
					let message = matchCommitHash[1].trim();
					message = message.replace(/^\([^)]+\)\s*/, '');
					messages.push(message);
					continue;
				}
			}
		}

		return messages.filter((msg) => !/merge/i.test(msg));
	}

	function handlePaste(event: ClipboardEvent, index: number) {
		const pastedText = event.clipboardData?.getData('text') || '';
		const parsedMessages = parseGitLog(pastedText);

		if (parsedMessages.length > 0) {
			event.preventDefault();
			tasks[index].text = parsedMessages[0];
			const newTasks = parsedMessages.slice(1).map((msg) => ({
				text: msg,
				status: 'Done' as const,
				hours: 1,
				priority: 'Medium' as const,
				project: '',
				notes: '',
				attachment: ''
			}));
			if (newTasks.length > 0) {
				tasks.splice(index + 1, 0, ...newTasks);
			}
		}
	}

	function handleGlobalPaste(event: ClipboardEvent) {
		const target = event.target as HTMLElement;
		const tagName = target?.tagName?.toUpperCase();
		if (tagName === 'INPUT' || tagName === 'TEXTAREA' || target?.isContentEditable) {
			return;
		}
		const pastedText = event.clipboardData?.getData('text') || '';
		const parsedMessages = parseGitLog(pastedText);
		if (parsedMessages.length > 0) {
			event.preventDefault();
			tasks = parsedMessages.map((msg) => ({
				text: msg,
				status: 'Done' as const,
				hours: 1,
				priority: 'Medium' as const,
				project: '',
				notes: '',
				attachment: ''
			}));
		}
	}

	let isOpen = $state(false);
	let employeeSearchQuery = $state('');
	let dropdownRef: HTMLDivElement | undefined = $state(undefined);
	let triggerRef = $state<HTMLButtonElement>(null!);

	let filteredEmployees = $derived(
		data.employees.filter((employee: string) =>
			employee.toLowerCase().includes(employeeSearchQuery.toLowerCase())
		)
	);

	function handleDocumentClick(event: MouseEvent) {
		if (dropdownRef && !dropdownRef.contains(event.target as Node)) {
			isOpen = false;
		}
	}

	function closeAndFocusTrigger() {
		isOpen = false;
		tick().then(() => {
			triggerRef?.focus();
		});
	}

	function selectEmployee(employee: string) {
		selectedEmployee = employee;
		closeAndFocusTrigger();
	}

	// Track the last employee & date we loaded data for — prevents re-running on polling refresh
	let lastLoadedKey = $state('');

	// Auto-load existing report data or local draft only when the selected employee or date CHANGES
	$effect(() => {
		const employee = selectedEmployee; // track reactive dependency
		const dateStr = targetDate;       // track reactive dependency
		const currentKey = `${employee}_${dateStr}`;

		if (currentKey === lastLoadedKey) return; // skip if didn't change (e.g. data polling refresh)
		lastLoadedKey = currentKey;

		if (employee) {
			// Check local storage draft first
			const draftStr = localStorage.getItem(`taskls_draft_${employee}_${dateStr}`);
			let draft = null;
			if (draftStr) {
				try {
					draft = JSON.parse(draftStr);
				} catch (e) {}
			}

			if (draft && draft.tasks && draft.tasks.length > 0) {
				tasks = draft.tasks.map((t: any) => ({
					...t,
					notes: t.notes || '',
					attachment: t.attachment || ''
				}));
				wellness = draft.wellness || 'Good';
			} else {
				const report = data.submissions[employee]?.[dateStr];
				if (report) {
					tasks = JSON.parse(JSON.stringify(report.tasks)).map((t: any) => ({
						...t,
						notes: t.notes || '',
						attachment: t.attachment || ''
					}));
					wellness = report.wellness || 'Good';
				} else {
					tasks = [{ text: '', status: 'Done', hours: 1, priority: 'Medium', project: '', notes: '', attachment: '' }];
					wellness = 'Good';
				}
			}
		} else {
			tasks = [{ text: '', status: 'Done', hours: 1, priority: 'Medium', project: '', notes: '', attachment: '' }];
			wellness = 'Good';
		}
	});

	// Auto-save draft changes to localStorage
	$effect(() => {
		const employee = selectedEmployee;
		const dateStr = targetDate;
		if (employee && dateStr) {
			const hasContent = tasks.some((t) => t.text.trim() !== '');
			if (hasContent) {
				const draftData = {
					tasks: $state.snapshot(tasks),
					wellness
				};
				localStorage.setItem(`taskls_draft_${employee}_${dateStr}`, JSON.stringify(draftData));
			} else {
				localStorage.removeItem(`taskls_draft_${employee}_${dateStr}`);
			}
		}
	});

	$effect(() => {
		if (form?.success) {
			if (selectedEmployee && targetDate) {
				localStorage.removeItem(`taskls_draft_${selectedEmployee}_${targetDate}`);
			}
			tasks = [{ text: '', status: 'Done', hours: 1, priority: 'Medium', project: '', notes: '', attachment: '' }];
			selectedEmployee = '';
			lastLoadedKey = ''; // reset guard so the same employee can reload fresh data next time
			targetDate = data.todayDate;
			showDatePicker = false;
			wellness = 'Good';
		}
	});

	onMount(() => {
		const interval = setInterval(() => {
			invalidateAll();
		}, 30000);

		return () => clearInterval(interval);
	});

	// Get dates of the current week (Monday-Friday)
	let weekDays = $derived.by(() => {
		const mondayDate = new Date(data.todayDate);
		const day = mondayDate.getDay();
		const diff = mondayDate.getDate() - day + (day === 0 ? -6 : 1);
		const startOfWeek = new Date(mondayDate.setDate(diff));

		return ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].map((name, index) => {
			const d = new Date(startOfWeek);
			d.setDate(startOfWeek.getDate() + index);
			const yyyy = d.getFullYear();
			const mm = String(d.getMonth() + 1).padStart(2, '0');
			const dd = String(d.getDate()).padStart(2, '0');
			const dateStr = `${yyyy}-${mm}-${dd}`;
			return {
				name,
				dateStr,
				formatted: d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })
			};
		});
	});

	let totalEmployees = $derived(data.employees.length);
	
	// Submissions counts based on active date
	let activeSubmissionsList = $derived(
		data.employees
			.map((emp: string) => data.submissions[emp]?.[activeDate])
			.filter(Boolean)
	);
	let submittedCount = $derived(activeSubmissionsList.length);
	
	let percentProgress = $derived(
		totalEmployees > 0 ? Math.round((submittedCount / totalEmployees) * 100) : 0
	);

	let totalHours = $derived(
		activeSubmissionsList.reduce((acc: number, report: any) => {
			return acc + (report.tasks || []).reduce((tAcc: number, t: any) => tAcc + (t.hours || 1), 0);
		}, 0)
	);

	let wellnessCounts = $derived.by(() => {
		let good = 0, tired = 0, blocked = 0;
		activeSubmissionsList.forEach((report: any) => {
			if (report.wellness === 'Good') good++;
			else if (report.wellness === 'Tired') tired++;
			else if (report.wellness === 'Blocked') blocked++;
		});
		return { good, tired, blocked };
	});

	let statusCounts = $derived.by(() => {
		let done = 0, obstacle = 0, carryOver = 0;
		activeSubmissionsList.forEach((report: any) => {
			(report.tasks || []).forEach((t: any) => {
				if (t.status === 'Done') done++;
				else if (t.status === 'Obstacle') obstacle++;
				else if (t.status === 'Carry Over') carryOver++;
			});
		});
		return { done, obstacle, carryOver };
	});

	let totalTasks = $derived(statusCounts.done + statusCounts.obstacle + statusCounts.carryOver);

	// Display employees filtered by search query and status tab
	let displayEmployees = $derived(
		data.employees.filter((employee: string) => {
			const report = data.submissions[employee]?.[activeDate];
			
			// Match Search Box
			const matchesSearch =
				employee.toLowerCase().includes(searchQuery.toLowerCase()) ||
				(report?.tasks || []).some((t: any) =>
					t.text.toLowerCase().includes(searchQuery.toLowerCase()) ||
					(t.project || '').toLowerCase().includes(searchQuery.toLowerCase())
				);

			// Match Status Filter
			const matchesStatus =
				statusFilter === 'All' ||
				(report?.tasks || []).some((t: any) => t.status === statusFilter);

			return matchesSearch && matchesStatus;
		})
	);

	const statusConfig = {
		'Done': { bg: 'bg-gray-100 hover:bg-gray-200/80 text-gray-700 border-transparent', active: 'bg-[#1a1a1a] text-white border-[#1a1a1a] shadow-md', icon: 'check_circle', text: 'Done' },
		'Obstacle': { bg: 'bg-gray-100 hover:bg-gray-200/80 text-gray-700 border-transparent', active: 'bg-red-500 text-white border-red-500 shadow-md', icon: 'warning', text: 'Obstacle' },
		'Carry Over': { bg: 'bg-gray-100 hover:bg-gray-200/80 text-gray-700 border-transparent', active: 'bg-amber-500 text-white border-amber-500 shadow-md', icon: 'forward', text: 'Carry Over' }
	};

	// Ticket link parser (Jira and GitHub)
	function formatTaskText(text: string): string {
		if (!text) return '';
		let escaped = text
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#039;');

		// Link Jira tickets like EX-123
		escaped = escaped.replace(
			/([A-Z]+-[0-9]+)/g,
			'<a href="https://erzastudio.atlassian.net/browse/$1" target="_blank" class="text-blue-600 hover:underline font-semibold">$1</a>'
		);

		// Link GitHub references like #456
		escaped = escaped.replace(
			/#([0-9]+)/g,
			'<a href="https://github.com/Roxxy17/taskls-erza/issues/$1" target="_blank" class="text-blue-600 hover:underline font-semibold">#$1</a>'
		);

		return escaped;
	}

	function formatDateForDisplay(dateStr: string): string {
		const d = new Date(dateStr);
		if (isNaN(d.getTime())) return dateStr;
		return d.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' });
	}

	let hasUserSubmittedForTargetDate = $derived.by(() => {
		if (!selectedEmployee) return false;
		return data.submissions[selectedEmployee]?.[targetDate] !== undefined;
	});
</script>

<svelte:head>
	<title>TaskLS - Weekly Dashboard</title>
</svelte:head>

<svelte:window onclick={handleDocumentClick} onpaste={handleGlobalPaste} />

<main class="max-w-7xl mx-auto space-y-6 md:space-y-8 p-4 sm:p-6 md:p-8 lg:py-12">
	<!-- HEADER SECTION -->
	<header data-purpose="page-header" class="animate-in fade-in slide-in-from-top-4 duration-500 ease-out">
		<div class="flex justify-between items-start mb-3">
			<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-green-100/50 text-[10px] sm:text-xs font-bold text-green-700 tracking-widest uppercase border border-green-200/50">
				<span class="w-1.5 h-1.5 rounded-full bg-green-500"></span>
				Internal Tool
			</span>
			<span class="text-xs sm:text-sm font-medium text-gray-500 bg-white/50 px-3 py-1 rounded-full border border-gray-200/50">{data.todayDateFormatted}</span>
		</div>
		<h1 class="text-3xl sm:text-4xl md:text-5xl font-extrabold tracking-tight mb-2 text-gray-900 leading-tight">TaskLS Dashboard</h1>
		<p class="text-gray-500 text-sm md:text-base font-medium max-w-xl">Collective Weekly Employee Reports synced with Google Sheets & Discord Webhook.</p>
	</header>

	<!-- TOP DASHBOARD STATS GRID -->
	<div class="grid grid-cols-1 md:grid-cols-2 gap-6 items-stretch">
		<!-- PROGRESS CARD -->
		<section class="bg-white rounded-2xl p-5 sm:p-6 custom-shadow border border-gray-100/50 transition-transform duration-300 hover:shadow-lg flex flex-col justify-between" data-purpose="submission-progress">
			<div class="flex items-center justify-between mb-4">
				<h2 class="text-[10px] sm:text-xs font-bold text-gray-800 tracking-wider uppercase flex items-center gap-2">
					<span class="material-symbols-outlined text-lg text-gray-400">monitoring</span>
					Submission Progress ({formatDateForDisplay(activeDate)})
				</h2>
				<span class="text-xs font-bold text-gray-400 bg-gray-100 px-2 py-1 rounded-md">{percentProgress}% COMPLETED</span>
			</div>
			<div class="progress-bar-container mb-4 shadow-inner">
				<div class="progress-bar-fill transition-all duration-700 ease-out relative overflow-hidden" style="width: {percentProgress}%;">
					<div class="absolute inset-0 bg-white/20 w-full animate-[shimmer_2s_infinite]"></div>
				</div>
			</div>
			<div class="flex justify-between text-sm font-bold mt-auto">
				<span class="text-gray-900 flex items-center gap-1.5">
					<span class="material-symbols-outlined text-[16px] text-gray-400">group</span>
					{submittedCount} <span class="text-gray-400 font-medium px-1">of</span> {totalEmployees} <span class="hidden sm:inline font-medium text-gray-400">Employees</span>
				</span>
			</div>
		</section>

		<!-- TEAM ANALYTICS CARD -->
		<section class="bg-white rounded-2xl p-5 sm:p-6 custom-shadow border border-gray-100/50 transition-transform duration-300 hover:shadow-lg flex flex-col justify-between" data-purpose="team-analytics">
			<div class="flex items-center justify-between mb-3">
				<h2 class="text-[10px] sm:text-xs font-bold text-gray-800 tracking-wider uppercase flex items-center gap-2">
					<span class="material-symbols-outlined text-lg text-gray-400">analytics</span>
					Team Analytics ({formatDateForDisplay(activeDate)})
				</h2>
				<span class="text-[10px] font-bold text-gray-500 bg-gray-100 px-2 py-1 rounded-md">{totalHours} HOURS LOGGED</span>
			</div>

			<!-- Analytics stats rows -->
			<div class="grid grid-cols-1 sm:grid-cols-2 gap-4 my-2">
				<!-- Wellness breakdown -->
				<div class="space-y-1.5">
					<span class="text-[10px] font-extrabold text-gray-400 uppercase tracking-wider block">Wellness status</span>
					<div class="flex items-center gap-2">
						<span class="text-xs font-bold text-gray-700 bg-green-50 text-green-700 px-2 py-1 rounded border border-green-100" title="Great Energy">🟢 {wellnessCounts.good}</span>
						<span class="text-xs font-bold text-gray-700 bg-amber-50 text-amber-700 px-2 py-1 rounded border border-amber-100" title="Tired">🟡 {wellnessCounts.tired}</span>
						<span class="text-xs font-bold text-gray-700 bg-red-50 text-red-700 px-2 py-1 rounded border border-red-100" title="Blocked">🔴 {wellnessCounts.blocked}</span>
					</div>
				</div>
				<!-- Tasks breakdown summary -->
				<div class="space-y-1.5">
					<span class="text-[10px] font-extrabold text-gray-400 uppercase tracking-wider block">Tasks distribution</span>
					<span class="text-xs font-bold text-gray-800 flex items-center gap-1">
						<span class="material-symbols-outlined text-sm text-gray-400">task_alt</span>
						{totalTasks} Total Tasks
					</span>
				</div>
			</div>

			<!-- Stacked progress bar for Task status -->
			<div class="space-y-1.5 mt-2">
				<span class="text-[9px] font-bold text-gray-400 uppercase tracking-wider block">Task Status breakdown</span>
				<div class="h-2 rounded-full overflow-hidden flex bg-gray-100">
					{#if totalTasks > 0}
						<div class="bg-green-500 h-full" style="width: {(statusCounts.done / totalTasks) * 100}%" title="Done: {statusCounts.done}"></div>
						<div class="bg-red-500 h-full" style="width: {(statusCounts.obstacle / totalTasks) * 100}%" title="Obstacle: {statusCounts.obstacle}"></div>
						<div class="bg-amber-500 h-full" style="width: {(statusCounts.carryOver / totalTasks) * 100}%" title="Carry Over: {statusCounts.carryOver}"></div>
					{:else}
						<div class="bg-gray-200 w-full h-full"></div>
					{/if}
				</div>
				<div class="flex items-center gap-3 text-[10px] font-bold text-gray-500">
					<span class="flex items-center gap-1">
						<span class="w-1.5 h-1.5 rounded-full bg-green-500"></span> Done: {statusCounts.done}
					</span>
					<span class="flex items-center gap-1">
						<span class="w-1.5 h-1.5 rounded-full bg-red-500"></span> Obstacle: {statusCounts.obstacle}
					</span>
					<span class="flex items-center gap-1">
						<span class="w-1.5 h-1.5 rounded-full bg-amber-500"></span> Carry Over: {statusCounts.carryOver}
					</span>
				</div>
			</div>
		</section>
	</div>

	<!-- NOTIFICATION CARDS -->
	<div class="space-y-4">
		{#if form?.error}
			<div in:slide={{ duration: 300, axis: 'y' }} class="bg-red-50 rounded-2xl p-4 sm:p-5 border border-red-100 flex items-start sm:items-center gap-3 shadow-sm">
				<span class="material-symbols-outlined text-red-500 bg-red-100 p-1.5 rounded-full">error</span>
				<p class="text-sm font-semibold text-red-800">{form.error}</p>
			</div>
		{/if}

		{#if form?.success}
			<div in:slide={{ duration: 300, axis: 'y' }} class="bg-green-50 rounded-2xl p-4 sm:p-5 border border-green-100 flex items-start sm:items-center gap-3 shadow-sm">
				<span class="material-symbols-outlined text-green-600 bg-green-100 p-1.5 rounded-full">check_circle</span>
				<p class="text-sm font-semibold text-green-800">{form.message}</p>
			</div>
		{/if}
	</div>

	<!-- CONTENT GRID -->
	<div class="grid gap-6 md:gap-8 items-start grid-cols-1 lg:grid-cols-5">
		<!-- REPORT FORM SECTION (Span 2) -->
		<section class="bg-white rounded-[24px] p-5 sm:p-7 md:p-8 custom-shadow space-y-7 border border-gray-100/50 lg:col-span-2" data-purpose="daily-report-form">
			<div class="flex items-center gap-3">
				<div class="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center">
					<span class="material-symbols-outlined text-gray-700">edit_document</span>
				</div>
				<h2 class="text-xl sm:text-2xl font-bold text-gray-900 tracking-tight">
					{hasUserSubmittedForTargetDate ? 'Update Daily Report' : 'Fill Daily Report'}
				</h2>
			</div>
			
			<form
				method="POST"
				action="?/submitReport"
				enctype="multipart/form-data"
				use:enhance={() => {
					submitting = true;
					return async ({ update }) => {
						await update();
						submitting = false;
					};
				}}
				class="flex flex-col gap-7"
			>
				<!-- Employee Select -->
				<div class="space-y-2.5" bind:this={dropdownRef}>
					<label for="employee-select" class="block text-sm font-semibold text-gray-700">Employee Name</label>
					<input type="hidden" name="employeeName" value={selectedEmployee} required />
					
					<Popover.Root bind:open={isOpen}>
						<Popover.Trigger bind:ref={triggerRef}>
							{#snippet child({ props })}
								<button
									{...props}
									id="employee-select"
									type="button"
									role="combobox"
									aria-expanded={isOpen}
									class="w-full form-select bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-xl px-4 py-3.5 text-left text-sm flex items-center justify-between transition-all focus:border-gray-900 focus:ring-1 focus:ring-gray-900 shadow-sm"
									class:text-gray-400={!selectedEmployee}
									class:text-gray-900={selectedEmployee}
									class:font-medium={selectedEmployee}
								>
									{selectedEmployee || 'Select your name...'}
									<span class="material-symbols-outlined text-gray-400 text-xl transition-transform duration-200" class:rotate-180={isOpen}>expand_more</span>
								</button>
							{/snippet}
						</Popover.Trigger>
						<Popover.Content class="w-[--anchor-width] p-1 border border-gray-200 rounded-xl shadow-xl bg-white">
							<Command.Root class="bg-transparent">
								<div class="flex items-center px-3 border-b border-gray-100 pb-1">
									<span class="material-symbols-outlined text-gray-400 text-lg mr-2">search</span>
									<input
										type="text"
										placeholder="Search employee..."
										bind:value={employeeSearchQuery}
										class="w-full bg-transparent py-3 text-sm font-semibold text-gray-800 outline-none placeholder:text-gray-400"
									/>
								</div>
								<Command.List class="max-h-[200px] overflow-y-auto p-1">
									<Command.Empty class="p-3 text-xs text-gray-400 font-semibold text-center">No employee found.</Command.Empty>
									<Command.Group>
										{#each filteredEmployees as employee}
											{@const hasSubmitted = data.submissions[employee]?.[targetDate] !== undefined}
											<Command.Item
												value={employee}
												onSelect={() => selectEmployee(employee)}
												class="py-3 px-3 mx-1 my-0.5 rounded-lg cursor-pointer text-sm font-semibold text-gray-700 transition-colors flex items-center justify-between hover:bg-gray-100 aria-selected:bg-gray-100 aria-selected:text-gray-900"
											>
												{employee}
												{#if hasSubmitted}
													<span class="flex items-center gap-1 text-[10px] uppercase font-bold text-green-600 bg-green-50 px-2 py-1 rounded shadow-sm border border-green-100">
														<span class="material-symbols-outlined text-[14px]">edit</span> Submitted
													</span>
												{/if}
											</Command.Item>
										{/each}
									</Command.Group>
								</Command.List>
							</Command.Root>
						</Popover.Content>
					</Popover.Root>
				</div>

				<!-- Submission Date Toggle -->
				<div class="space-y-2.5">
					<span class="block text-sm font-semibold text-gray-700">Submission Date</span>
					<div class="grid grid-cols-3 gap-2">
						<button
							type="button"
							onclick={() => { targetDate = data.todayDate; showDatePicker = false; }}
							class="py-2.5 px-2 rounded-xl text-xs font-bold flex flex-col items-center justify-center gap-0.5 border select-none transition-all active:scale-95 shadow-sm"
							class:bg-black={targetDate === data.todayDate && !showDatePicker}
							class:border-black={targetDate === data.todayDate && !showDatePicker}
							class:text-white={targetDate === data.todayDate && !showDatePicker}
							class:bg-gray-50={targetDate !== data.todayDate || showDatePicker}
							class:border-gray-200={targetDate !== data.todayDate || showDatePicker}
							class:text-gray-700={targetDate !== data.todayDate || showDatePicker}
						>
							<span>📅 Today</span>
							<span class="text-[9px] font-medium opacity-80">{data.todayDateFormatted}</span>
						</button>
						<button
							type="button"
							onclick={() => { targetDate = data.yesterdayDate; showDatePicker = false; }}
							class="py-2.5 px-2 rounded-xl text-xs font-bold flex flex-col items-center justify-center gap-0.5 border select-none transition-all active:scale-95 shadow-sm"
							class:bg-black={targetDate === data.yesterdayDate && !showDatePicker}
							class:border-black={targetDate === data.yesterdayDate && !showDatePicker}
							class:text-white={targetDate === data.yesterdayDate && !showDatePicker}
							class:bg-gray-50={targetDate !== data.yesterdayDate || showDatePicker}
							class:border-gray-200={targetDate !== data.yesterdayDate || showDatePicker}
							class:text-gray-700={targetDate !== data.yesterdayDate || showDatePicker}
						>
							<span>📅 Yesterday</span>
							<span class="text-[9px] font-medium opacity-80">{data.yesterdayDateFormatted}</span>
						</button>
						<button
							type="button"
							onclick={() => showDatePicker = true}
							class="py-2.5 px-2 rounded-xl text-xs font-bold flex flex-col items-center justify-center gap-0.5 border select-none transition-all active:scale-95 shadow-sm"
							class:bg-black={showDatePicker}
							class:border-black={showDatePicker}
							class:text-white={showDatePicker}
							class:bg-gray-50={!showDatePicker}
							class:border-gray-200={!showDatePicker}
							class:text-gray-700={!showDatePicker}
						>
							<span>📅 Custom...</span>
							<span class="text-[9px] font-medium opacity-80">Pick Date</span>
						</button>
					</div>

					{#if showDatePicker}
						<div in:slide={{ duration: 250 }} class="mt-2.5 relative">
							<input
								id="custom-date-picker"
								type="date"
								bind:value={targetDate}
								required
								class="w-full bg-white border border-gray-200 rounded-xl px-4 py-3 text-sm font-semibold text-gray-800 focus:border-gray-900 outline-none transition-all shadow-sm"
							/>
						</div>
					{/if}
					<input type="hidden" name="targetDate" value={targetDate} />
				</div>

				<!-- Wellness Check-in -->
				<div class="space-y-2.5">
					<span class="block text-sm font-semibold text-gray-700">Wellness Status (How is your energy today?)</span>
					<div class="grid grid-cols-3 gap-2">
						{#each [['Good', '🟢 Great'], ['Tired', '🟡 Tired'], ['Blocked', '🔴 Blocked']] as [val, label]}
							<button
								type="button"
								onclick={() => wellness = val as any}
								class="py-3 px-2 rounded-xl text-xs sm:text-sm font-bold flex items-center justify-center gap-2 border select-none transition-all active:scale-95"
								class:bg-black={wellness === val}
								class:border-black={wellness === val}
								class:text-white={wellness === val}
								class:bg-gray-50={wellness !== val}
								class:border-gray-200={wellness !== val}
								class:text-gray-700={wellness !== val}
							>
								{label}
							</button>
						{/each}
					</div>
					<input type="hidden" name="wellness" value={wellness} />
				</div>

				<input type="hidden" name="tasks" value={JSON.stringify(tasks)} />

				<!-- Task List Section -->
				<div class="space-y-4">
					<div class="flex justify-between items-center pb-2 border-b border-gray-100">
						<div class="flex items-center gap-2">
							<span class="material-symbols-outlined text-gray-400 text-lg">checklist</span>
							<span class="text-sm font-bold text-gray-900">Tasks List</span>
						</div>
						<button type="button" onclick={addTask} class="bg-gray-100 hover:bg-gray-200 text-gray-900 px-3.5 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors shadow-sm">
							<span class="material-symbols-outlined text-[16px]">add</span> Add Task
						</button>
					</div>

					<div class="space-y-5">
						{#each tasks as task, index (index)}
							<div in:slide={{ duration: 300 }} class="bg-gray-50/80 rounded-2xl p-4 sm:p-5 border border-gray-200 space-y-4 relative group transition-all duration-200 hover:border-gray-300 hover:bg-gray-50">
								<div class="flex justify-between items-center">
									<h4 class="text-xs sm:text-sm font-bold text-gray-600 bg-white px-3 py-1 rounded-full border border-gray-200 shadow-sm">
										Task {tasks.length - index}
									</h4>
									{#if tasks.length > 1}
										<button type="button" onclick={() => removeTask(index)} class="text-gray-400 hover:text-red-500 bg-white hover:bg-red-50 rounded-full p-1.5 transition-colors border border-gray-200 hover:border-red-200 shadow-sm" title="Remove Task">
											<span class="material-symbols-outlined text-[16px] block">close</span>
										</button>
									{/if}
								</div>
								
								<textarea
									id="task-text-{index}"
									bind:value={task.text}
									onpaste={(e: ClipboardEvent) => handlePaste(e, index)}
									required
									class="w-full form-textarea bg-white border border-gray-200 rounded-xl p-4 text-sm font-medium text-gray-800 min-h-[100px] resize-y focus:border-gray-900 focus:ring-1 focus:ring-gray-900 outline-none transition-all placeholder:text-gray-400 shadow-sm"
									placeholder="Enter task description (paste git log to auto-split)..."
								></textarea>

								<!-- Project, Duration, and Priority Inputs -->
								<div class="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
									<div class="space-y-1.5">
										<span class="block text-xs font-semibold text-gray-500">Project</span>
										<input
											id="task-project-{index}"
											type="text"
											bind:value={task.project}
											placeholder="e.g. AWBS, Internal"
											required
											class="w-full bg-white border border-gray-200 rounded-xl px-3.5 py-2.5 text-xs sm:text-sm font-semibold text-gray-800 focus:border-gray-900 outline-none transition-all shadow-sm"
										/>
									</div>
									<div class="space-y-1.5">
										<span class="block text-xs font-semibold text-gray-500">Duration (Hours)</span>
										<input
											id="task-hours-{index}"
											type="number"
											step="0.5"
											min="0.5"
											max="24"
											bind:value={task.hours}
											required
											class="w-full bg-white border border-gray-200 rounded-xl px-3.5 py-2.5 text-xs sm:text-sm font-semibold text-gray-800 focus:border-gray-900 outline-none transition-all shadow-sm"
										/>
									</div>
									<div class="space-y-1.5">
										<span class="block text-xs font-semibold text-gray-500">Priority</span>
										<select
											id="task-priority-{index}"
											bind:value={task.priority}
											required
											class="w-full bg-white border border-gray-200 rounded-xl px-3.5 py-2.5 text-xs sm:text-sm font-semibold text-gray-800 focus:border-gray-900 outline-none transition-all shadow-sm cursor-pointer"
										>
											<option value="Low">Low</option>
											<option value="Medium">Medium</option>
											<option value="High">High</option>
										</select>
									</div>
								</div>
								
								<!-- Radio Buttons Grid -->
								<RadioGroup.Root bind:value={task.status}>
									<div class="grid grid-cols-2 gap-2 sm:gap-3">
										{#each Object.entries(statusConfig) as [key, config]}
											<label for="status-{index}-{key}" class={cn("cursor-pointer py-2.5 sm:py-3 px-2 rounded-xl text-xs sm:text-sm font-bold flex items-center justify-center gap-1.5 sm:gap-2 transition-all border select-none active:scale-95", task.status === key ? config.active : config.bg)}>
												<RadioGroup.Item value={key} id="status-{index}-{key}" class="sr-only" />
												<span class="material-symbols-outlined text-[18px] sm:text-[20px]">{config.icon}</span> 
												<span class="truncate">{config.text}</span>
											</label>
										{/each}
									</div>
								</RadioGroup.Root>

								<!-- Task Notes & Attachment -->
								<div class="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 pt-4 border-t border-gray-200">
									<div class="space-y-1.5">
										<span class="block text-xs font-semibold text-gray-500">Task Notes</span>
										<input
											id="task-notes-{index}"
											type="text"
											bind:value={task.notes}
											placeholder="Add specific details, obstacle explanation, etc. (Optional)"
											class="w-full bg-white border border-gray-200 rounded-xl px-3.5 py-2.5 text-xs sm:text-sm font-semibold text-gray-800 focus:border-gray-900 outline-none transition-all shadow-sm"
										/>
									</div>
									<div class="space-y-1.5">
										<span class="block text-xs font-semibold text-gray-500">Attachment Link</span>
										<input
											id="task-attachment-{index}"
											type="url"
											bind:value={task.attachment}
											placeholder="e.g. Figma, Loom, PR URL (Optional)"
											class="w-full bg-white border border-gray-200 rounded-xl px-3.5 py-2.5 text-xs sm:text-sm font-semibold text-gray-800 focus:border-gray-900 outline-none transition-all shadow-sm"
										/>
									</div>
								</div>
							</div>
						{/each}
					</div>
				</div>



				<!-- Submit Button -->
				<button type="submit" disabled={submitting} class="w-full bg-[#1a1a1a] hover:bg-black text-white font-bold py-4 rounded-xl text-sm transition-all mt-2 disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2.5 shadow-lg shadow-black/10 active:scale-[0.98]">
					{#if submitting}
						<span class="material-symbols-outlined animate-spin text-xl">progress_activity</span> 
						<span>Submitting...</span>
					{:else}
						<span class="material-symbols-outlined text-xl">send</span>
						<span>{hasUserSubmittedForTargetDate ? 'Update Daily Report' : 'Submit Daily Report'}</span>
					{/if}
				</button>
			</form>
		</section>

		<!-- TEAM BOARD SECTION (Span 3) -->
		<section class="space-y-5 lg:col-span-3" data-purpose="team-board">
			<!-- Tab Board Header & Reminder -->
			<div class="flex justify-between items-center px-1 lg:pt-3">
				<div class="flex items-center gap-3">
					<div class="w-10 h-10 rounded-xl bg-white custom-shadow flex items-center justify-center">
						<span class="material-symbols-outlined text-gray-700">dashboard</span>
					</div>
					<h2 class="text-xl sm:text-2xl font-bold text-gray-900 tracking-tight">Team Board</h2>
				</div>
				
				<div class="flex items-center gap-2">
					<!-- Poke Pending Form Button -->
					<form method="POST" action="?/pokePending" use:enhance>
						<input type="hidden" name="targetDate" value={activeDate} />
						<button type="submit" class="bg-yellow-500 hover:bg-yellow-600 text-white font-bold px-3 py-2 rounded-xl text-xs flex items-center gap-1.5 transition-colors shadow-sm select-none active:scale-95" title="Remind pending team members on Discord">
							<span class="material-symbols-outlined text-[16px]">notifications_active</span> Poke Pending
						</button>
					</form>

					<span class="bg-green-100 text-green-700 text-[10px] sm:text-xs font-bold px-3 py-1.5 rounded-lg flex items-center gap-2 uppercase tracking-widest border border-green-200">
						Live <span class="w-2 h-2 bg-green-500 rounded-full inline-block animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.6)]"></span>
					</span>
				</div>
			</div>

			<!-- Weekly Status Overview Grid -->
			<div class="bg-white rounded-[24px] custom-shadow border border-gray-100 p-4 sm:p-5">
				<h3 class="text-xs font-extrabold text-gray-700 uppercase tracking-wider mb-3.5 flex items-center gap-2">
					<span class="material-symbols-outlined text-lg text-gray-400">grid_view</span>
					Weekly Status Overview
				</h3>
				<div class="overflow-x-auto scrollbar-hide">
					<table class="w-full min-w-[500px] border-collapse text-left text-xs font-semibold text-gray-500">
						<thead>
							<tr class="border-b border-gray-100">
								<th class="py-2.5 pl-2 text-[10px] uppercase font-bold text-gray-400">Employee</th>
								{#each weekDays as day}
									<th class="py-2.5 text-center">
										<button 
											type="button" 
											onclick={() => activeDate = day.dateStr}
											class="hover:underline font-bold text-[10px] uppercase tracking-wider transition-colors"
											class:text-black={activeDate === day.dateStr}
											class:text-gray-400={activeDate !== day.dateStr}
										>
											{day.name.substring(0, 3)} ({day.formatted})
										</button>
									</th>
								{/each}
							</tr>
						</thead>
						<tbody class="divide-y divide-gray-100/50">
							{#each data.employees as employee}
								<tr>
									<td class="py-3 pl-2 font-bold text-gray-800 flex items-center gap-2">
										<div class="w-1.5 h-1.5 rounded-full bg-gray-300"></div>
										{employee}
									</td>
									{#each weekDays as day}
										{@const report = data.submissions[employee]?.[day.dateStr]}
										<td class="py-3 text-center">
											<button
												type="button"
												onclick={() => {
													activeDate = day.dateStr;
													setTimeout(() => {
														const el = document.getElementById(`card-${employee}`);
														if (el) {
															el.scrollIntoView({ behavior: 'smooth', block: 'center' });
															el.classList.add('ring-4', 'ring-yellow-400/40', 'border-yellow-400');
															setTimeout(() => el.classList.remove('ring-4', 'ring-yellow-400/40', 'border-yellow-400'), 2000);
														}
													}, 50);
												}}
												class="inline-flex items-center justify-center p-1 rounded-full transition-all active:scale-90 hover:bg-gray-100"
												title={report ? `View ${employee}'s report for ${day.name} (Wellness: ${report.wellness})` : `No report from ${employee} for ${day.name}`}
											>
												{#if report}
													{#if report.wellness === 'Good'}
														<span class="w-4 h-4 rounded-full bg-green-500 flex items-center justify-center text-[10px] text-white font-bold shadow-sm">✓</span>
													{:else if report.wellness === 'Tired'}
														<span class="w-4 h-4 rounded-full bg-amber-500 flex items-center justify-center text-[10px] text-white font-bold shadow-sm">!</span>
													{:else}
														<span class="w-4 h-4 rounded-full bg-red-500 flex items-center justify-center text-[10px] text-white font-bold shadow-sm">X</span>
													{/if}
												{:else}
													<span class="w-4 h-4 rounded-full bg-gray-100 border border-gray-200 inline-block shadow-inner"></span>
												{/if}
											</button>
										</td>
									{/each}
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</div>
			
			<div class="bg-white rounded-[24px] custom-shadow border border-gray-100 p-4 sm:p-5 flex flex-col h-[600px] sm:h-[700px] lg:h-[calc(100vh-200px)] lg:max-h-[900px] relative">
				
				<!-- Monday - Friday Tabs -->
				<div class="flex border-b border-gray-100 mb-4 overflow-x-auto scrollbar-hide shrink-0">
					{#each weekDays as day}
						<button
							type="button"
							onclick={() => activeDate = day.dateStr}
							class="py-2.5 px-4 font-bold text-xs sm:text-sm border-b-2 whitespace-nowrap transition-colors"
							class:border-[#1a1a1a]={activeDate === day.dateStr}
							class:text-[#1a1a1a]={activeDate === day.dateStr}
							class:border-transparent={activeDate !== day.dateStr}
							class:text-gray-400={activeDate !== day.dateStr}
						>
							{day.name} ({day.formatted})
						</button>
					{/each}
				</div>

				<!-- Search & Filter Controls -->
				<div class="flex flex-col sm:flex-row gap-3 mb-5 shrink-0">
					<div class="relative flex-1">
						<span class="material-symbols-outlined text-gray-400 text-lg absolute left-3.5 top-1/2 -translate-y-1/2">search</span>
						<input
							type="text"
							bind:value={searchQuery}
							placeholder="Search name or task content..."
							class="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl text-xs sm:text-sm focus:border-gray-900 focus:ring-1 focus:ring-gray-900 outline-none transition-all shadow-sm placeholder:text-gray-400 bg-gray-50/50"
						/>
					</div>
					<div class="flex gap-1.5 overflow-x-auto scrollbar-hide">
						{#each ['All', 'Done', 'Obstacle', 'Carry Over'] as filter}
							<button
								type="button"
								onclick={() => statusFilter = filter}
								class="px-3.5 py-2.5 rounded-xl text-xs font-bold border transition-colors select-none whitespace-nowrap active:scale-95"
								class:bg-[#1a1a1a]={statusFilter === filter}
								class:text-white={statusFilter === filter}
								class:border-[#1a1a1a]={statusFilter === filter}
								class:bg-gray-50={statusFilter !== filter}
								class:text-gray-600={statusFilter !== filter}
								class:border-gray-200={statusFilter !== filter}
							>
								{filter}
							</button>
						{/each}
					</div>
				</div>

				<!-- Submissions List -->
				<div class="flex-1 overflow-y-auto p-1 space-y-3.5 scrollbar-hide relative z-0">
					{#each displayEmployees as employee, i (employee)}
						{@const report = data.submissions[employee]?.[activeDate]}
						<div in:fly={{ y: 20, duration: 400, delay: i * 40 }}>
							{#if report}
								<div id="card-{employee}" class="bg-white border border-gray-200 rounded-2xl overflow-hidden transition-all duration-300 hover:border-gray-400 hover:shadow-md group">
									<div class="flex items-center justify-between px-4 sm:px-5 py-3 sm:py-4 bg-gray-50 border-b border-gray-100 group-hover:bg-gray-100/50 transition-colors">
										<div class="flex items-center gap-3">
											<div class="w-8 h-8 rounded-lg bg-[#1a1a1a] text-white flex items-center justify-center text-sm font-bold shadow-sm">
												{employee.charAt(0).toUpperCase()}
											</div>
											<span class="font-bold text-sm sm:text-base text-gray-900">{employee}</span>
										</div>
										<span class="text-[10px] sm:text-xs font-mono text-gray-500 font-semibold bg-white px-2 py-1 rounded-md border border-gray-200 shadow-sm">
											{new Date(report.submittedAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
										</span>
									</div>
									<div class="p-4 sm:p-5 space-y-4">
										<!-- Wellness Indicator -->
										{#if report.wellness}
											<div class="flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-lg bg-gray-50 border border-gray-200 w-max text-gray-700">
												<span>Wellness:</span>
												{#if report.wellness === 'Good'}
													<span class="text-green-600">🟢 Great</span>
												{:else if report.wellness === 'Tired'}
													<span class="text-yellow-600">🟡 Tired</span>
												{:else}
													<span class="text-red-600">🔴 Blocked</span>
												{/if}
											</div>
										{/if}

										<!-- Task Listing -->
										<div class="space-y-3">
											{#each report.tasks || [] as item}
												{@const config = statusConfig[item.status] || statusConfig['Done']}
												<div class="flex items-start gap-3 sm:gap-4 text-sm group/task">
													<div class="flex flex-col gap-1 shrink-0">
														<span class="px-2.5 py-1 rounded-md text-[10px] sm:text-xs font-bold bg-gray-50 border border-gray-200 text-gray-600 uppercase flex items-center gap-1.5 whitespace-nowrap mt-0.5 shadow-sm group-hover/task:border-gray-300 transition-colors">
															<span class="material-symbols-outlined text-[14px]">{config.icon}</span> <span>{config.text}</span>
														</span>
														
														<div class="flex items-center gap-1">
															{#if item.project}
																<span class="px-1.5 py-0.5 rounded text-[8px] sm:text-[9px] font-extrabold uppercase bg-blue-50 text-blue-700 border border-blue-200 text-center whitespace-nowrap">
																	📁 {item.project}
																</span>
															{/if}
															<span class="px-1.5 py-0.5 rounded text-[8px] sm:text-[9px] font-extrabold uppercase border text-center whitespace-nowrap"
																class:bg-red-50={item.priority === 'High'} class:text-red-700={item.priority === 'High'} class:border-red-200={item.priority === 'High'}
																class:bg-yellow-50={item.priority === 'Medium'} class:text-yellow-700={item.priority === 'Medium'} class:border-yellow-200={item.priority === 'Medium'}
																class:bg-green-50={item.priority === 'Low'} class:text-green-700={item.priority === 'Low'} class:border-green-200={item.priority === 'Low'}
															>
																{item.priority || 'Medium'}
															</span>
															<span class="px-1.5 py-0.5 rounded text-[8px] sm:text-[9px] font-bold bg-gray-100 border border-gray-200 text-gray-600 uppercase text-center whitespace-nowrap">
																🕒 {item.hours || 1}h
															</span>
														</div>
													</div>
													<div class="flex flex-col flex-1">
														<span class="text-gray-800 leading-relaxed font-medium pt-0.5">
															{@html formatTaskText(item.text)}
														</span>
														{#if item.notes || item.attachment}
															<div class="mt-2 space-y-1.5 pl-3 border-l-2 border-gray-200">
																{#if item.notes}
																	<div class="text-[11px] sm:text-xs text-gray-500 font-medium leading-normal">
																		<span class="text-gray-600 font-bold">Notes:</span> {item.notes}
																	</div>
																{/if}
																{#if item.attachment}
																	<div class="flex items-center gap-1.5 text-[11px] sm:text-xs text-blue-600 font-semibold">
																		<span class="material-symbols-outlined text-[14px]">link</span>
																		<a href={item.attachment} target="_blank" class="hover:underline truncate max-w-[200px] sm:max-w-xs">
																			{item.attachment}
										</a>
																	</div>
																{/if}
															</div>
														{/if}
													</div>
												</div>
											{/each}
										</div>
									</div>
								</div>
							{:else}
								<div id="card-{employee}" class="flex items-center justify-between p-4 sm:p-5 rounded-2xl border-2 border-dashed border-gray-200 bg-gray-50/50 transition-colors hover:bg-gray-50 hover:border-gray-300">
									<div class="flex items-center gap-3 opacity-60">
										<div class="w-8 h-8 rounded-lg bg-gray-200 text-gray-500 flex items-center justify-center text-sm font-bold">
											{employee.charAt(0).toUpperCase()}
										</div>
										<span class="font-bold text-sm sm:text-base text-gray-600">{employee}</span>
									</div>
									<span class="text-[10px] sm:text-xs font-bold uppercase tracking-widest text-gray-400 bg-white border border-gray-200 px-2.5 py-1 rounded-md shadow-sm">Waiting</span>
								</div>
							{/if}
						</div>
					{/each}
				</div>
			</div>
		</section>
	</div>

	<!-- ADMIN / BACKUP UTILITIES -->
	<footer class="mt-12 border-t border-gray-100 pt-6 pb-8 text-center" data-purpose="admin-footer">
		<details class="group max-w-md mx-auto">
			<summary class="text-xs font-bold text-gray-400 hover:text-gray-600 transition-colors cursor-pointer select-none outline-none list-none flex items-center justify-center gap-1">
				<span class="material-symbols-outlined text-[16px] transition-transform duration-200 group-open:rotate-180">expand_more</span>
				Database Maintenance Utilities
			</summary>
			<div class="mt-4 p-5 bg-gray-50 border border-gray-200 rounded-2xl text-left space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
				<h4 class="text-xs font-bold text-gray-700 uppercase tracking-wider flex items-center gap-1.5">
					<span class="material-symbols-outlined text-[18px] text-gray-400">database</span>
					Backup & Restore
				</h4>
				<p class="text-[11px] text-gray-500 font-medium leading-relaxed">
					Download a snapshot of the current local database file to your computer, restore a previously saved backup file, or rebuild your entire local database from Google Sheets.
				</p>
				<div class="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
					<a
						href="/download-json"
						download="store-backup.json"
						class="w-full bg-white hover:bg-gray-100 border border-gray-200 text-gray-700 font-bold py-2.5 px-3 rounded-xl text-xs flex items-center justify-center gap-1.5 transition-all shadow-sm active:scale-95 select-none"
					>
						<span class="material-symbols-outlined text-[16px]">download</span> Download Backup
					</a>
					<form method="POST" action="?/restoreBackup" enctype="multipart/form-data" use:enhance class="w-full">
						<label class="w-full bg-white hover:bg-gray-100 border border-gray-200 text-gray-700 font-bold py-2.5 px-3 rounded-xl text-xs flex items-center justify-center gap-1.5 transition-all shadow-sm active:scale-95 cursor-pointer select-none">
							<span class="material-symbols-outlined text-[16px]">upload</span> Restore Backup
							<input
								type="file"
								name="backupFile"
								accept=".json"
								required
								class="hidden"
								onchange={(e) => {
									const form = e.currentTarget.form;
									if (form && confirm('Are you sure you want to overwrite the current database with this backup file?')) {
										form.requestSubmit();
									}
								}}
							/>
						</label>
					</form>
					<form method="POST" action="?/importFromSheets" use:enhance class="w-full">
						<button
							type="submit"
							class="w-full bg-[#1a1a1a] hover:bg-black text-white font-bold py-2.5 px-3 rounded-xl text-xs flex items-center justify-center gap-1.5 transition-all shadow-sm active:scale-95 select-none"
							onclick={(e) => {
								if (!confirm('Are you sure you want to pull and rebuild your entire local database from your Google Sheets tab?')) {
									e.preventDefault();
								}
							}}
						>
							<span class="material-symbols-outlined text-[16px]">sync</span> Sync from Sheets
						</button>
					</form>
				</div>
			</div>
		</details>
	</footer>
</main>

<style>
	/* Custom Progress Bar styling */
	.progress-bar-container {
		height: 10px;
		background-color: #f3f4f6; /* gray-100 */
		border-radius: 999px;
		overflow: hidden;
	}
	.progress-bar-fill {
		height: 100%;
		background-color: #22c55e;
		border-radius: 999px;
	}
	
	@keyframes shimmer {
		100% {
			transform: translateX(100%);
		}
	}

	/* Hide scrollbar for a cleaner look */
	.scrollbar-hide::-webkit-scrollbar {
		display: none;
	}
	.scrollbar-hide {
		-ms-overflow-style: none;
		scrollbar-width: none;
	}
</style>
