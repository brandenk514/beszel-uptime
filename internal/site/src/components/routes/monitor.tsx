import { t } from "@lingui/core/macro"
import { Trans } from "@lingui/react/macro"
import { memo, useCallback, useEffect, useMemo, useState } from "react"
import { timeTicks } from "d3-time"
import { Link } from "../router"
import {
	AlertCircleIcon,
	ArrowLeftIcon,
	CheckIcon,
	GlobeIcon,
	HistoryIcon,
	NetworkIcon,
	PauseIcon,
	RadioIcon,
	RssIcon,
	SearchIcon,
	XIcon,
	ZapIcon,
} from "lucide-react"
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { pb } from "@/lib/api"
import { getPbTimestamp, isReadOnlyUser } from "@/lib/api"
import { $allMonitorsById } from "@/lib/stores"
import { SystemStatus } from "@/lib/enums"
import { chartTimeData, cn, decimalString, getHubURL, toFixedFloat } from "@/lib/utils"
import type { ChartTimes, MonitorCheckRecord, MonitorRecord } from "@/types"
import { Badge } from "@/components/ui/badge"
import { DockerIcon, SteamIcon } from "@/components/ui/icons"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useYAxisWidth } from "@/components/charts/hooks"
import { Dialog } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { MonitorDialog } from "@/components/add-monitor"

const MONITOR_TYPE_ICONS: Record<string, typeof GlobeIcon> = {
	http: GlobeIcon,
	tcp: NetworkIcon,
	ping: ZapIcon,
	dns: SearchIcon,
	docker: DockerIcon,
	websocket: RadioIcon,
	steam: SteamIcon,
	push: RssIcon,
}

function formatMs(ms: number) {
	if (ms >= 1000) {
		return `${decimalString(ms / 1000)}s`
	}
	return `${decimalString(ms)}ms`
}

function StatusBadge({ status }: { status: string }) {
	const config = {
		[`${SystemStatus.Up}`]: { label: t`Up`, icon: CheckIcon, className: "bg-success text-white border-transparent" },
		[`${SystemStatus.Down}`]: { label: t`Down`, icon: XIcon, className: "bg-destructive text-white border-transparent" },
		[`${SystemStatus.Paused}`]: { label: t`Paused`, icon: PauseIcon, className: "bg-secondary text-secondary-foreground border-transparent" },
		[`${SystemStatus.Pending}`]: { label: t`Pending`, icon: AlertCircleIcon, className: "bg-secondary text-secondary-foreground border-transparent" },
	}[status] ?? { label: status, icon: AlertCircleIcon, className: "bg-secondary text-secondary-foreground border-transparent" }

	const Icon = config.icon
	return (
		<Badge variant="default" className={cn("flex gap-1 items-center", config.className)}>
			<Icon className="h-3 w-3" />
			{config.label}
		</Badge>
	)
}

const MONITOR_RANGES: ChartTimes[] = ["1h", "12h", "24h", "1w", "30d"]

function UptimeChart({ checks, range }: { checks: MonitorCheckRecord[]; range: ChartTimes }) {
	const windowStart = useMemo(() => chartTimeData[range].getOffset(new Date()).getTime(), [range, checks])
	const { yAxisWidth, updateYAxisWidth } = useYAxisWidth()

	const data = useMemo(() => {
		const points = checks
			.slice()
			.reverse()
			.map((c) => ({
				time: new Date(c.created).getTime(),
				ms: c.ms ?? null,
			}))
			.filter((d) => d.time >= windowStart)
		// downsample to keep the SVG light on long ranges
		const maxPoints = 1000
		if (points.length > maxPoints) {
			const step = Math.ceil(points.length / maxPoints)
			return points.filter((_, i) => i % step === 0)
		}
		return points
	}, [checks, windowStart])

	const now = new Date().getTime()
	const ticks = useMemo(
		() =>
			timeTicks(new Date(windowStart), new Date(now), chartTimeData[range].ticks ?? 12).map((d) => d.getTime()),
		[range, windowStart, now]
	)

	if (!data.length) {
		return (
			<div className="h-64 flex items-center justify-center text-muted-foreground">
				<Trans>No check data available yet</Trans>
			</div>
		)
	}

	return (
		<ResponsiveContainer width="100%" height={260}>
			<AreaChart data={data} margin={{ top: 10, right: 10, bottom: 0, left: 40 }}>
				<defs>
					<linearGradient id="msGradient" x1="0" y1="0" x2="0" y2="1">
						<stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.4} />
						<stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0} />
					</linearGradient>
				</defs>
				<CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
				<XAxis
					dataKey="time"
					type="number"
					scale="time"
					domain={[windowStart, now]}
					ticks={ticks}
					minTickGap={16}
					tickFormatter={chartTimeData[range].format}
					tickLine={false}
					axisLine={false}
				/>
				<YAxis
					domain={[0, (dataMax: number) => dataMax * 1.1]}
					tickFormatter={(val) => updateYAxisWidth(formatMs(val))}
					tickLine={false}
					axisLine={false}
					width={Math.max(yAxisWidth, 50)}
				/>
				<Tooltip
					labelFormatter={(val) => new Date(val as number).toLocaleString()}
					formatter={(value) => [formatMs(value as number), "Response time"]}
				/>
				<Area
					type="stepAfter"
					dataKey="ms"
					stroke="var(--chart-1)"
					fill="url(#msGradient)"
					name="Response time"
				/>
			</AreaChart>
		</ResponsiveContainer>
	)
}

function ChecksTable({ checks }: { checks: MonitorCheckRecord[] }) {
	const [showMore, setShowMore] = useState(false)

	if (!checks.length) {
		return (
			<div className="py-8 text-center text-muted-foreground">
				<Trans>No checks yet</Trans>
			</div>
		)
	}

	const visible = showMore ? checks : checks.slice(0, 5)

	return (
		<div className="divide-y">
			{visible.map((check) => (
				<div key={check.id} className="py-3 flex items-start justify-between gap-4">
					<div className="flex items-start gap-3 min-w-0">
						<div
							className={cn(
								"mt-1 h-2 w-2 rounded-full shrink-0",
								check.up ? "bg-success" : "bg-destructive"
							)}
						/>
						<div className="min-w-0">
							<div className="text-sm">
								{check.up ? (
									<Trans>Up</Trans>
								) : (
									<Trans>Down</Trans>
								)}
								{check.msg ? <span className="text-muted-foreground"> — {check.msg}</span> : null}
							</div>
							<div className="text-xs text-muted-foreground">{new Date(check.created).toLocaleString()}</div>
						</div>
					</div>
					<div className="text-sm tabular-nums shrink-0">{check.ms != null ? formatMs(check.ms) : "—"}</div>
				</div>
			))}
			{checks.length > 5 && (
				<div className="pt-3">
					<Button variant="ghost" size="sm" className="h-7 w-full" onClick={() => setShowMore(!showMore)}>
						{showMore ? (
							<Trans>View less</Trans>
						) : (
							<>
								<Trans>View more</Trans> ({checks.length - 5})
							</>
						)}
					</Button>
				</div>
			)}
		</div>
	)
}

export default memo(function MonitorDetail({ id }: { id: string }) {
	const [monitor, setMonitor] = useState<MonitorRecord | null>($allMonitorsById.get()[id] ?? null)
	const [checks, setChecks] = useState<MonitorCheckRecord[]>([])
	const [editOpen, setEditOpen] = useState(false)
	const [checking, setChecking] = useState(false)
	const [range, setRange] = useState<ChartTimes>("1h")

	useEffect(() => {
		return () => {
			document.title = "Beszel"
		}
	}, [])

	// keep monitor in sync with store
	useEffect(() => {
		const unsub = $allMonitorsById.listen((m) => {
			const found = m[id]
			if (found) {
				setMonitor(found)
				document.title = `${found.name} / Beszel`
			}
		})
		return unsub
	}, [id])

	// fetch initial monitor if not in store (e.g. navigated directly)
	useEffect(() => {
		if (monitor) {
			return
		}
		pb.collection<MonitorRecord>("monitors")
			.getOne(id)
			.then((m) => {
				setMonitor(m)
				$allMonitorsById.setKey(id, m)
			})
			.catch(() => {
				/* not found — leave null */
			})
	}, [id, monitor])

	// fetch checks (most recent first) + subscribe to realtime
	useEffect(() => {
		let cancelled = false

		pb
			.collection<MonitorCheckRecord>("monitor_checks")
			.getFullList({
				filter: pb.filter(`monitor = {:monitor} && created > {:created}`, {
					monitor: id,
					created: getPbTimestamp(range),
				}),
				sort: "-created",
				totalItems: 0,
				batch: 1000,
			})
			.then((recs) => {
				if (!cancelled) setChecks(recs)
			})
			.catch(() => {})

// poll for new checks every 15s (beszel realtime hub connection is agent-only)
	const refresh = () => {
		pb
			.collection<MonitorCheckRecord>("monitor_checks")
			.getFullList({
				filter: pb.filter(`monitor = {:monitor} && created > {:created}`, {
					monitor: id,
					created: getPbTimestamp(range),
				}),
				sort: "-created",
				totalItems: 0,
				batch: 1000,
			})
			.then((recs) => {
				if (!cancelled) setChecks(recs)
			})
			.catch(() => {})
	}
	const timer = window.setInterval(refresh, 15000)

	return () => {
		cancelled = true
		window.clearInterval(timer)
		}
	}, [id, range])

	const handleCheckNow = useCallback(async () => {
		if (!monitor) {
			return
		}
		setChecking(true)
		try {
			await pb.send(`/api/beszel/uptime/check-now?monitor=${monitor.id}`, {})
		} catch {
			/* ignore */
		} finally {
			setChecking(false)
		}
	}, [monitor])

	if (!monitor) {
		return null
	}

	const TypeIcon = MONITOR_TYPE_ICONS[monitor.type] ?? GlobeIcon
	const targetLabel = (() => {
		switch (monitor.type) {
			case "http":
				return monitor.url
			case "tcp":
				return `${monitor.host}:${monitor.port ?? ""}`
			case "dns":
				return `${monitor.dns_type?.toUpperCase() ?? "A"} ${monitor.host}`
			case "docker":
				return `${monitor.host ?? monitor.url ?? ""}${monitor.docker_url ? ` (${monitor.docker_url})` : ""}`
			case "websocket":
				return monitor.url
			case "steam":
				return `App ${monitor.app_id}`
			case "push":
				return monitor.push_token ? `${getHubURL()}/api/beszel/uptime/push?token=***}` : t`Push heartbeat`
			default:
				return monitor.host ?? monitor.url
		}
	})()

	const rangeLabel = chartTimeData[range].label()
	const upChecks = checks.filter((c) => c.up).length
	const totalChecks = checks.length
	const uptimePct = totalChecks ? (upChecks / totalChecks) * 100 : null

	return (
		<>
			{editOpen && (
				<Dialog open={editOpen} onOpenChange={setEditOpen}>
					<MonitorDialog monitor={monitor} setOpen={setEditOpen} />
				</Dialog>
			)}
			<div className="flex flex-col gap-4">
				<div className="flex items-start justify-between gap-4">
					<div className="flex items-center gap-3 min-w-0">
						<Button
							variant="ghost"
							size="icon"
							aria-label="Back"
							className="shrink-0"
							asChild
						>
							<Link href="/monitors">
								<ArrowLeftIcon className="h-4 w-4" />
							</Link>
						</Button>
						<div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center shrink-0">
							<TypeIcon className="h-5 w-5" />
						</div>
						<div className="min-w-0">
							<div className="flex items-center gap-2 flex-wrap">
								<h1 className="text-lg font-semibold truncate">{monitor.name}</h1>
								<StatusBadge status={monitor.status} />
							</div>
							<div className="text-sm text-muted-foreground truncate">{targetLabel}</div>
						</div>
					</div>

					<div className="flex gap-2 shrink-0">
						{!isReadOnlyUser() && (
							<>
								<Button
									variant="outline"
									onClick={handleCheckNow}
									disabled={checking}
									className="gap-1"
								>
									<ZapIcon className="h-4 w-4" />
									<Trans>Check now</Trans>
								</Button>
								<Button variant="outline" onClick={() => setEditOpen(true)} className="gap-1">
									<Trans>Edit</Trans>
								</Button>
							</>
						)}
					</div>
				</div>

				<div className="grid gap-4 sm:grid-cols-3">
					<Card>
						<CardHeader>
							<CardTitle>
								<Trans>Uptime</Trans>
							</CardTitle>
							<CardDescription>
								<Trans>Across the {totalChecks} checks in the last {rangeLabel}</Trans>
							</CardDescription>
						</CardHeader>
						<CardContent>
							<div className="text-2xl font-semibold tabular-nums">
								{uptimePct == null ? "—" : `${toFixedFloat(uptimePct, 2)}%`}
							</div>
						</CardContent>
					</Card>
					<Card>
						<CardHeader>
							<CardTitle>
								<Trans>Type</Trans>
							</CardTitle>
							<CardDescription>
								<Trans>Monitor type</Trans>
							</CardDescription>
						</CardHeader>
						<CardContent>
							<div className="text-2xl font-semibold uppercase">{monitor.type}</div>
						</CardContent>
					</Card>
					<Card>
						<CardHeader>
							<CardTitle>
								<Trans>Interval</Trans>
							</CardTitle>
							<CardDescription>
								<Trans>Check frequency</Trans>
							</CardDescription>
						</CardHeader>
						<CardContent>
							<div className="text-2xl font-semibold tabular-nums">
								{monitor.interval ? `${monitor.interval}s` : "—"}
							</div>
						</CardContent>
					</Card>
				</div>

				<Card>
					<CardHeader>
					<div className="flex items-center justify-between gap-4">
						<div className="grid gap-1.5">
							<CardTitle>
								<Trans>Response time</Trans>
							</CardTitle>
							<CardDescription>
								<Trans>Latency of each check over time</Trans>
							</CardDescription>
						</div>
						<Select value={range} onValueChange={(value) => setRange(value as ChartTimes)}>
							<SelectTrigger className="w-32 relative ps-10" aria-label={t`Time range`}>
								<HistoryIcon className="h-4 w-4 absolute start-4 top-1/2 -translate-y-1/2 opacity-85" />
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{MONITOR_RANGES.map((value) => (
									<SelectItem key={value} value={value}>
										{chartTimeData[value].label()}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
				</CardHeader>
				<CardContent>
					<UptimeChart checks={checks} range={range} />
				</CardContent>
			</Card>

			<Card>
					<CardHeader>
						<CardTitle>
							<Trans>Recent checks</Trans>
						</CardTitle>
						<CardDescription>
							<Trans>Most recent first</Trans>
						</CardDescription>
					</CardHeader>
					<CardContent>
						<ChecksTable checks={checks} />
					</CardContent>
				</Card>
			</div>
		</>
	)
})
