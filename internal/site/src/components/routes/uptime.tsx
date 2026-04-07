import { Trans, useLingui } from "@lingui/react/macro"
import {
	ActivityIcon,
	CheckCircle2Icon,
	EditIcon,
	LoaderCircleIcon,
	PlusIcon,
	RefreshCwIcon,
	Trash2Icon,
	XCircleIcon,
} from "lucide-react"
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { FooterRepoLink } from "@/components/footer-repo-link"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { isReadOnlyUser, pb } from "@/lib/api"
import { cn } from "@/lib/utils"

type MonitorType = "http" | "https" | "tcp"
type MonitorStatus = "up" | "down" | "unknown"

interface UptimeMonitor {
	id: string
	name: string
	type: MonitorType
	url: string
	host: string
	port: number
	interval: number
	timeout: number
	status: MonitorStatus
	response_time: number
	last_checked: string
	enabled: boolean
	created: string
}

interface UptimeEvent {
	id: string
	monitor: string
	up: boolean
	response_time: number
	status_code: number
	msg: string
	created: string
}

const DEFAULT_MONITOR: Omit<UptimeMonitor, "id" | "created" | "status" | "response_time" | "last_checked"> = {
	name: "",
	type: "https",
	url: "",
	host: "",
	port: 80,
	interval: 60,
	timeout: 30,
	enabled: true,
}

function statusDotColor(status: MonitorStatus, enabled: boolean) {
	if (!enabled) return "bg-muted-foreground/40"
	if (status === "up") return "bg-green-500"
	if (status === "down") return "bg-red-500"
	return "bg-yellow-500"
}

function statusTextColor(status: MonitorStatus) {
	if (status === "up") return "text-green-500"
	if (status === "down") return "text-red-500"
	return "text-yellow-500"
}

function statusRingColor(status: MonitorStatus, enabled: boolean) {
	if (!enabled) return "bg-muted"
	if (status === "up") return "bg-green-500/15"
	if (status === "down") return "bg-red-500/15"
	return "bg-yellow-500/15"
}

// ── Heartbeat bar: last N events as coloured dots ────────────────────────────

function HeartbeatBar({ events }: { events: UptimeEvent[] }) {
	const dots = 30
	const filled = events.slice(0, dots)
	// Pad to `dots` length with nulls on the left (oldest slots).
	const padded: (UptimeEvent | null)[] = [
		...Array(Math.max(0, dots - filled.length)).fill(null),
		...filled.reverse(),
	]

	return (
		<div className="flex items-center gap-[3px]" title="Last 30 checks (oldest → newest)">
			{padded.map((ev, i) => (
				<span
					// biome-ignore lint/suspicious/noArrayIndexKey: stable positional display
					key={i}
					className={cn(
						"inline-block rounded-sm w-[7px] h-4 flex-shrink-0 transition-colors",
						ev === null
							? "bg-muted"
							: ev.up
								? "bg-green-500/80 dark:bg-green-500/70"
								: "bg-red-500/80 dark:bg-red-500/60"
					)}
					title={
						ev
							? `${new Date(ev.created).toLocaleString()} — ${ev.up ? "Up" : "Down"} (${ev.response_time.toFixed(0)} ms)`
							: "No data"
					}
				/>
			))}
		</div>
	)
}

// ── Response time sparkline ───────────────────────────────────────────────────

function ResponseTimeChart({ events }: { events: UptimeEvent[] }) {
	const data = [...events]
		.reverse()
		.slice(-60)
		.map((ev) => ({
			t: new Date(ev.created).toLocaleTimeString(),
			ms: ev.up ? Number(ev.response_time.toFixed(1)) : null,
		}))

	if (data.length === 0) {
		return <p className="text-sm text-muted-foreground py-4 text-center"><Trans>No data yet</Trans></p>
	}

	return (
		<div className="[&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground">
		<ResponsiveContainer width="100%" height={120}>
			<AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
				<defs>
					<linearGradient id="rtGrad" x1="0" y1="0" x2="0" y2="1">
						<stop offset="5%" stopColor="var(--primary)" stopOpacity={0.3} />
						<stop offset="95%" stopColor="var(--primary)" stopOpacity={0} />
					</linearGradient>
				</defs>
				<CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.5} />
				<XAxis dataKey="t" tick={{ fontSize: 10 }} interval="preserveStartEnd" stroke="var(--muted-foreground)" />
				<YAxis tick={{ fontSize: 10 }} unit=" ms" stroke="var(--muted-foreground)" />
				<Tooltip
					contentStyle={{
						backgroundColor: "var(--card)",
						border: "1px solid var(--border)",
						borderRadius: 6,
						fontSize: 12,
						color: "var(--foreground)",
					}}
					formatter={(v: number) => [`${v} ms`, "Response"]}
				/>
				<Area
					type="monotone"
					dataKey="ms"
					stroke="var(--primary)"
					strokeWidth={1.5}
					fill="url(#rtGrad)"
					connectNulls={false}
					dot={false}
				/>
			</AreaChart>
		</ResponsiveContainer>
		</div>
	)
}

// ── Uptime percentage ─────────────────────────────────────────────────────────

function uptimePct(events: UptimeEvent[]): string {
	if (events.length === 0) return "—"
	const upCount = events.filter((e) => e.up).length
	return `${((upCount / events.length) * 100).toFixed(2)}%`
}

// ── Monitor card ─────────────────────────────────────────────────────────────

function MonitorCard({
	monitor,
	onEdit,
	onDelete,
	onCheckNow,
}: {
	monitor: UptimeMonitor
	onEdit: (m: UptimeMonitor) => void
	onDelete: (id: string) => void
	onCheckNow: (id: string) => void
}) {
	const [events, setEvents] = useState<UptimeEvent[]>([])
	const [expanded, setExpanded] = useState(false)
	const [checking, setChecking] = useState(false)

	useEffect(() => {
		let unsub: (() => void) | undefined
		pb.collection("uptime_events")
			.getList(1, 60, {
				filter: `monitor="${monitor.id}"`,
				sort: "-created",
				fields: "id,monitor,up,response_time,status_code,msg,created",
			})
			.then((res) => setEvents(res.items as unknown as UptimeEvent[]))
			.catch(() => {})

		pb.collection("uptime_events")
			.subscribe("*", (ev) => {
				if (ev.record.monitor !== monitor.id) return
				if (ev.action === "create") {
					setEvents((prev) => [ev.record as unknown as UptimeEvent, ...prev].slice(0, 500))
				}
			})
			.then((fn) => {
				unsub = fn
			})

		return () => {
			unsub?.()
		}
	}, [monitor.id])

	const handleCheckNow = async () => {
		setChecking(true)
		await onCheckNow(monitor.id)
		setTimeout(() => setChecking(false), 2000)
	}

	const StatusIcon = !monitor.enabled
		? null
		: monitor.status === "up"
			? CheckCircle2Icon
			: monitor.status === "down"
				? XCircleIcon
				: ActivityIcon

	const displayUrl = monitor.type === "tcp" ? `${monitor.host}:${monitor.port}` : monitor.url

	return (
		<Card className={cn(!monitor.enabled && "opacity-60")}>
			<CardContent className="p-4">
				{/* Header row */}
				<div className="flex items-center gap-3 flex-wrap">
					{/* Status dot */}
					<span
						className={cn(
							"inline-flex items-center justify-center h-8 w-8 rounded-full flex-shrink-0",
							statusRingColor(monitor.status, monitor.enabled)
						)}
					>
						<span className={cn("inline-block h-2.5 w-2.5 rounded-full", statusDotColor(monitor.status, monitor.enabled))} />
					</span>

					{/* Name + URL */}
					<div className="flex-1 min-w-0">
						<p className="font-medium leading-tight truncate">{monitor.name}</p>
						<p className="text-xs text-muted-foreground truncate">{displayUrl}</p>
					</div>

					{/* Status label */}
					<div className="flex items-center gap-1 text-sm font-medium">
						{StatusIcon && <StatusIcon className="h-4 w-4" />}
						<span className={statusTextColor(monitor.status)}>
							{!monitor.enabled
								? <Trans>Paused</Trans>
								: monitor.status === "up"
									? <Trans>Up</Trans>
									: monitor.status === "down"
										? <Trans>Down</Trans>
										: <Trans>Unknown</Trans>}
						</span>
					</div>

					{/* Uptime % */}
					<div className="text-sm text-right min-w-[4rem]">
						<p className="font-semibold tabular-nums">{uptimePct(events)}</p>
						<p className="text-xs text-muted-foreground"><Trans>uptime</Trans></p>
					</div>

					{/* Response time */}
					<div className="text-sm text-right min-w-[4.5rem]">
						<p className="font-semibold tabular-nums">
							{monitor.response_time > 0 ? `${monitor.response_time.toFixed(0)} ms` : "—"}
						</p>
						<p className="text-xs text-muted-foreground"><Trans>response</Trans></p>
					</div>

					{/* Actions */}
					{!isReadOnlyUser() && (
						<div className="flex items-center gap-1 ms-auto flex-shrink-0">
							<Button
								variant="ghost"
								size="icon"
								className="h-7 w-7"
								title="Check now"
								disabled={checking}
								onClick={handleCheckNow}
							>
								<RefreshCwIcon className={cn("h-3.5 w-3.5", checking && "animate-spin")} />
							</Button>
							<Button variant="ghost" size="icon" className="h-7 w-7" title="Edit" onClick={() => onEdit(monitor)}>
								<EditIcon className="h-3.5 w-3.5" />
							</Button>
							<Button
								variant="ghost"
								size="icon"
								className="h-7 w-7 text-destructive hover:text-destructive"
								title="Delete"
								onClick={() => onDelete(monitor.id)}
							>
								<Trash2Icon className="h-3.5 w-3.5" />
							</Button>
						</div>
					)}
				</div>

				{/* Heartbeat bar */}
				<div
					className="mt-3 cursor-pointer"
					onClick={() => setExpanded((p) => !p)}
					onKeyDown={(e) => e.key === "Enter" && setExpanded((p) => !p)}
					// biome-ignore lint/a11y/useSemanticElements: intentional div toggle
					role="button"
					tabIndex={0}
					aria-expanded={expanded}
					title={expanded ? "Click to collapse chart" : "Click to expand chart"}
				>
					<HeartbeatBar events={events} />
				</div>

				{/* Expanded response time chart */}
				{expanded && (
					<div className="mt-4 border-t border-border/40 pt-3">
						<p className="text-xs text-muted-foreground mb-2"><Trans>Response time (last 60 checks)</Trans></p>
						<ResponseTimeChart events={events} />
					</div>
				)}
			</CardContent>
		</Card>
	)
}

// ── Add / Edit dialog ─────────────────────────────────────────────────────────

function MonitorDialog({
	open,
	monitor,
	onClose,
	onSave,
}: {
	open: boolean
	monitor: UptimeMonitor | null
	onClose: () => void
	onSave: (data: Partial<UptimeMonitor>) => Promise<void>
}) {
	const { t } = useLingui()
	const isEditing = !!monitor

	const [form, setForm] = useState<typeof DEFAULT_MONITOR>({
		...DEFAULT_MONITOR,
		...(monitor ?? {}),
	})
	const [saving, setSaving] = useState(false)
	const [error, setError] = useState("")

	// Reset form when dialog opens with a new monitor value.
	useEffect(() => {
		setForm({ ...DEFAULT_MONITOR, ...(monitor ?? {}) })
		setError("")
	}, [monitor, open])

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault()
		setError("")
		setSaving(true)
		try {
			await onSave(form)
			onClose()
		} catch (err: unknown) {
			setError(err instanceof Error ? err.message : t`An error occurred`)
		} finally {
			setSaving(false)
		}
	}

	const isTCP = form.type === "tcp"

	return (
		<Dialog open={open} onOpenChange={(o) => !o && onClose()}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>{isEditing ? <Trans>Edit Monitor</Trans> : <Trans>Add Monitor</Trans>}</DialogTitle>
				</DialogHeader>
				<form onSubmit={handleSubmit} className="grid gap-4">
					{/* Name */}
					<div className="grid gap-1.5">
						<Label htmlFor="up-name"><Trans>Name</Trans></Label>
						<Input
							id="up-name"
							required
							placeholder={t`My Website`}
							value={form.name}
							onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
						/>
					</div>

					{/* Type */}
					<div className="grid gap-1.5">
						<Label><Trans>Type</Trans></Label>
						<Select
							value={form.type}
							onValueChange={(v) => setForm((p) => ({ ...p, type: v as MonitorType }))}
						>
							<SelectTrigger>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="https">HTTPS</SelectItem>
								<SelectItem value="http">HTTP</SelectItem>
								<SelectItem value="tcp">TCP</SelectItem>
							</SelectContent>
						</Select>
					</div>

					{/* URL (HTTP/HTTPS) or Host + Port (TCP) */}
					{!isTCP ? (
						<div className="grid gap-1.5">
							<Label htmlFor="up-url">URL</Label>
							<Input
								id="up-url"
								required
								placeholder={form.type === "https" ? "https://example.com" : "http://example.com"}
								value={form.url}
								onChange={(e) => setForm((p) => ({ ...p, url: e.target.value }))}
							/>
						</div>
					) : (
						<div className="grid grid-cols-3 gap-3">
							<div className="col-span-2 grid gap-1.5">
								<Label htmlFor="up-host"><Trans>Host</Trans></Label>
								<Input
									id="up-host"
									required
									placeholder="example.com"
									value={form.host}
									onChange={(e) => setForm((p) => ({ ...p, host: e.target.value }))}
								/>
							</div>
							<div className="grid gap-1.5">
								<Label htmlFor="up-port"><Trans>Port</Trans></Label>
								<Input
									id="up-port"
									type="number"
									required
									min={1}
									max={65535}
									placeholder="80"
									value={form.port || ""}
									onChange={(e) => setForm((p) => ({ ...p, port: Number(e.target.value) }))}
								/>
							</div>
						</div>
					)}

					{/* Interval + Timeout */}
					<div className="grid grid-cols-2 gap-3">
						<div className="grid gap-1.5">
							<Label htmlFor="up-interval"><Trans>Interval (s)</Trans></Label>
							<Input
								id="up-interval"
								type="number"
								min={10}
								max={3600}
								placeholder="60"
								value={form.interval || ""}
								onChange={(e) => setForm((p) => ({ ...p, interval: Number(e.target.value) }))}
							/>
						</div>
						<div className="grid gap-1.5">
							<Label htmlFor="up-timeout"><Trans>Timeout (s)</Trans></Label>
							<Input
								id="up-timeout"
								type="number"
								min={1}
								max={120}
								placeholder="30"
								value={form.timeout || ""}
								onChange={(e) => setForm((p) => ({ ...p, timeout: Number(e.target.value) }))}
							/>
						</div>
					</div>

					{/* Enabled toggle */}
					<div className="flex items-center gap-2">
						<Switch
							id="up-enabled"
							checked={form.enabled}
							onCheckedChange={(v) => setForm((p) => ({ ...p, enabled: v }))}
						/>
						<Label htmlFor="up-enabled"><Trans>Enabled</Trans></Label>
					</div>

					{error && <p className="text-sm text-destructive">{error}</p>}

					<DialogFooter>
						<DialogClose asChild>
							<Button type="button" variant="outline"><Trans>Cancel</Trans></Button>
						</DialogClose>
						<Button type="submit" disabled={saving}>
							{saving ? <LoaderCircleIcon className="h-4 w-4 animate-spin me-2" /> : null}
							{isEditing ? <Trans>Save</Trans> : <Trans>Add Monitor</Trans>}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	)
}

// ── Delete confirmation ───────────────────────────────────────────────────────

function DeleteDialog({
	open,
	monitorName,
	onClose,
	onConfirm,
}: {
	open: boolean
	monitorName: string
	onClose: () => void
	onConfirm: () => Promise<void>
}) {
	const [deleting, setDeleting] = useState(false)

	const handleConfirm = async () => {
		setDeleting(true)
		await onConfirm()
		setDeleting(false)
		onClose()
	}

	return (
		<Dialog open={open} onOpenChange={(o) => !o && onClose()}>
			<DialogContent className="sm:max-w-sm">
				<DialogHeader>
					<DialogTitle><Trans>Delete Monitor</Trans></DialogTitle>
				</DialogHeader>
				<p className="text-sm text-muted-foreground">
					<Trans>
						Delete <strong>{monitorName}</strong>? This will also remove all associated check history.
					</Trans>
				</p>
				<DialogFooter>
					<DialogClose asChild>
						<Button variant="outline"><Trans>Cancel</Trans></Button>
					</DialogClose>
					<Button variant="destructive" disabled={deleting} onClick={handleConfirm}>
						{deleting ? <LoaderCircleIcon className="h-4 w-4 animate-spin me-2" /> : null}
						<Trans>Delete</Trans>
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default memo(function Uptime() {
	const { t } = useLingui()
	const [monitors, setMonitors] = useState<UptimeMonitor[]>([])
	const [loading, setLoading] = useState(true)

	const [dialogOpen, setDialogOpen] = useState(false)
	const [editMonitor, setEditMonitor] = useState<UptimeMonitor | null>(null)

	const [deleteOpen, setDeleteOpen] = useState(false)
	const [deleteTarget, setDeleteTarget] = useState<UptimeMonitor | null>(null)

	const unsubRef = useRef<(() => void) | undefined>(undefined)

	useEffect(() => {
		document.title = `${t`Uptime`} / Beszel`
	}, [t])

	// Load + subscribe to monitors.
	useEffect(() => {
		pb.collection("uptime_monitors")
			.getFullList({ sort: "created" })
			.then((items) => {
				setMonitors(items as unknown as UptimeMonitor[])
				setLoading(false)
			})
			.catch(() => setLoading(false))

		pb.collection("uptime_monitors")
			.subscribe("*", (ev) => {
				if (ev.action === "create") {
					setMonitors((prev) => [...prev, ev.record as unknown as UptimeMonitor])
				} else if (ev.action === "update") {
					setMonitors((prev) =>
						prev.map((m) => (m.id === ev.record.id ? (ev.record as unknown as UptimeMonitor) : m))
					)
				} else if (ev.action === "delete") {
					setMonitors((prev) => prev.filter((m) => m.id !== ev.record.id))
				}
			})
			.then((fn) => {
				unsubRef.current = fn
			})

		return () => {
			unsubRef.current?.()
		}
	}, [])

	const handleSave = useCallback(
		async (data: Partial<UptimeMonitor>) => {
			const payload: Record<string, unknown> = {
				name: data.name,
				type: data.type,
				url: data.url ?? "",
				host: data.host ?? "",
				port: data.port ?? 0,
				interval: data.interval ?? 60,
				timeout: data.timeout ?? 30,
				enabled: data.enabled ?? true,
			}
			if (editMonitor) {
				await pb.collection("uptime_monitors").update(editMonitor.id, payload)
			} else {
				// status is set to "unknown" on first check; user field only needed on create
				await pb.collection("uptime_monitors").create({
					...payload,
					user: pb.authStore.record?.id,
					status: "unknown",
				})
			}
		},
		[editMonitor]
	)

	const handleDelete = useCallback(async () => {
		if (!deleteTarget) return
		await pb.collection("uptime_monitors").delete(deleteTarget.id)
	}, [deleteTarget])

	const handleCheckNow = useCallback(async (id: string) => {
		await pb.send("/api/beszel/uptime/check-now", { method: "POST", body: { id } })
	}, [])

	const openAdd = () => {
		setEditMonitor(null)
		setDialogOpen(true)
	}

	const openEdit = (m: UptimeMonitor) => {
		setEditMonitor(m)
		setDialogOpen(true)
	}

	const openDelete = (id: string) => {
		const m = monitors.find((x) => x.id === id) ?? null
		setDeleteTarget(m)
		setDeleteOpen(true)
	}

	const uptimeStats = useMemo(() => ({
		total: monitors.length,
		up: monitors.filter((m) => m.enabled && m.status === "up").length,
		down: monitors.filter((m) => m.enabled && m.status === "down").length,
	}), [monitors])

	return (
		<>
			<div className="flex flex-col gap-4">
				{/* Page header */}
				<div className="flex items-center justify-between flex-wrap gap-3">
					<div className="flex items-center gap-3">
						<h1 className="text-xl font-semibold"><Trans>Uptime Monitors</Trans></h1>
						{!loading && monitors.length > 0 && (
							<div className="flex items-center gap-2 text-sm">
								<span className="inline-flex items-center gap-1 text-green-500 font-medium">
									<span className="h-2 w-2 rounded-full bg-green-500 inline-block" />
									{uptimeStats.up}
								</span>
								{uptimeStats.down > 0 && (
									<span className="inline-flex items-center gap-1 text-red-500 font-medium">
										<span className="h-2 w-2 rounded-full bg-red-500 inline-block" />
										{uptimeStats.down}
									</span>
								)}
								<span className="text-muted-foreground">/ {uptimeStats.total}</span>
							</div>
						)}
					</div>
					{!isReadOnlyUser() && (
						<Button variant="outline" className="flex gap-1" onClick={openAdd}>
							<PlusIcon className="h-4 w-4 -ms-1" />
							<Trans>Add Monitor</Trans>
						</Button>
					)}
				</div>

				{/* Loading */}
				{loading && (
					<div className="flex items-center justify-center py-16 text-muted-foreground">
						<LoaderCircleIcon className="h-6 w-6 animate-spin me-2" />
						<Trans>Loading monitors…</Trans>
					</div>
				)}

				{/* Empty state */}
				{!loading && monitors.length === 0 && (
					<Card>
						<CardContent className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
							<ActivityIcon className="h-10 w-10 opacity-30" />
							<p className="text-sm"><Trans>No monitors yet. Add one to start tracking uptime.</Trans></p>
							{!isReadOnlyUser() && (
								<Button variant="outline" onClick={openAdd}>
									<PlusIcon className="h-4 w-4 me-1" />
									<Trans>Add Monitor</Trans>
								</Button>
							)}
						</CardContent>
					</Card>
				)}

				{/* Monitor list */}
				{!loading && monitors.length > 0 && (
					<div className="grid gap-3">
						{monitors.map((m) => (
							<MonitorCard
								key={m.id}
								monitor={m}
								onEdit={openEdit}
								onDelete={openDelete}
								onCheckNow={handleCheckNow}
							/>
						))}
					</div>
				)}
			</div>

			<FooterRepoLink />

			<MonitorDialog
				open={dialogOpen}
				monitor={editMonitor}
				onClose={() => setDialogOpen(false)}
				onSave={handleSave}
			/>

			{deleteTarget && (
				<DeleteDialog
					open={deleteOpen}
					monitorName={deleteTarget.name}
					onClose={() => setDeleteOpen(false)}
					onConfirm={handleDelete}
				/>
			)}
		</>
	)
})
