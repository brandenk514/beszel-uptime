import { Trans } from "@lingui/react/macro"
import { memo, useEffect, useMemo, useState } from "react"
import { AlertTriangleIcon, CheckCircle2Icon, LoaderIcon, XCircleIcon } from "lucide-react"
import { pb } from "@/lib/api"
import { SystemStatus } from "@/lib/enums"
import { cn, getHubURL } from "@/lib/utils"
import type { MonitorRecord, StatusPageRecord } from "@/types"

type PageInfo = Pick<StatusPageRecord, "name" | "slug" | "description" | "show_monitors"> & { id: string }

function StatusDot({ status }: { status: string }) {
	if (status === SystemStatus.Up) {
		return (
			<span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
				<CheckCircle2Icon className="h-4 w-4" />
				<span className="text-xs font-medium">Up</span>
			</span>
		)
	}
	if (status === SystemStatus.Down) {
		return (
			<span className="inline-flex items-center gap-1 text-red-600 dark:text-red-400">
				<XCircleIcon className="h-4 w-4" />
				<span className="text-xs font-medium">Down</span>
			</span>
		)
	}
	if (status === SystemStatus.Paused) {
		return (
			<span className="inline-flex items-center gap-1 text-muted-foreground">
				<AlertTriangleIcon className="h-4 w-4" />
				<span className="text-xs font-medium">Paused</span>
			</span>
		)
	}
	return (
		<span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
			<LoaderIcon className="h-4 w-4 animate-spin" />
			<span className="text-xs font-medium">Pending</span>
		</span>
	)
}

export default memo(function StatusPage({ slug }: { slug: string }) {
	const [info, setInfo] = useState<PageInfo | null>(null)
	const [monitors, setMonitors] = useState<MonitorRecord[]>([])
	const [notFound, setNotFound] = useState(false)
	const [loading, setLoading] = useState(true)

	useEffect(() => {
		document.title = `Status / Beszel`
		return () => {
			document.title = "Beszel"
		}
	}, [])

	useEffect(() => {
		let active = true

		async function fetchMonitors(pageId: string): Promise<MonitorRecord[]> {
			return pb
				.collection<MonitorRecord>("monitors")
				.getFullList({
					sort: "+name",
					filter: `status_page = "${pageId}"`,
					fields: "id,name,type,status,last_ping",
				})
				.catch(() => [] as MonitorRecord[])
		}

		async function load() {
			setLoading(true)
			try {
				const page = await pb.send<PageInfo>(`/api/beszel/status-page?slug=${encodeURIComponent(slug)}`)
				if (!active) return
				setInfo(page)
				setMonitors(await fetchMonitors(page.id))
			} catch (err) {
				console.error(err)
				if (active) setNotFound(true)
			} finally {
				if (active) setLoading(false)
			}
		}
		load()

		// Public realtime subscriptions require auth, so poll for updates.
		const interval = window.setInterval(async () => {
			if (!info) return
			const list = await fetchMonitors(info.id)
			if (active && list.length) setMonitors(list)
		}, 15000)

		return () => {
			active = false
			window.clearInterval(interval)
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [slug])

	const upCount = useMemo(() => monitors.filter((m) => m.status === SystemStatus.Up).length, [monitors])

	if (notFound) {
		return (
			<div className="py-20 text-center">
				<h1 className="text-2xl font-semibold mb-2">
					<Trans>Status page not found</Trans>
				</h1>
				<p className="text-muted-foreground">
					<Trans>This status page does not exist or is disabled.</Trans>
				</p>
			</div>
		)
	}

	if (loading || !info) {
		return (
			<div className="py-20 text-center text-muted-foreground">
				<LoaderIcon className="h-6 w-6 animate-spin inline-block" />
			</div>
		)
	}

	return (
		<div className="py-8 max-w-3xl mx-auto">
			<header className="mb-8">
				<h1 className="text-2xl font-semibold">{info.name}</h1>
				{info.description ? <p className="text-muted-foreground mt-1">{info.description}</p> : null}
				{monitors.length > 0 && (
					<p className="mt-3 text-sm">
						<Trans>
							{upCount} of {monitors.length} monitors operational
						</Trans>
					</p>
				)}
			</header>

			{monitors.length === 0 ? (
				<div className="text-center py-12 text-muted-foreground">
					<Trans>No monitors are assigned to this status page yet.</Trans>
				</div>
			) : (
				<div className="divide-y border border-border/60 rounded-lg bg-card">
					{monitors.map((m) => (
						<div key={m.id} className="flex items-center justify-between gap-3 px-4 py-3">
							<div className="min-w-0 flex items-center gap-3">
								<span
									className={cn(
										"size-2.5 rounded-full shrink-0",
										m.status === SystemStatus.Up && "bg-emerald-500",
										m.status === SystemStatus.Down && "bg-red-500",
										m.status === SystemStatus.Paused && "bg-muted-foreground/50",
										!(m.status === SystemStatus.Up ||
											m.status === SystemStatus.Down ||
											m.status === SystemStatus.Paused) &&
											"bg-amber-500 animate-pulse"
									)}
								/>
								{info.show_monitors !== false ? (
									<div className="min-w-0">
										<p className="font-medium truncate">{m.name}</p>
										<p className="text-xs text-muted-foreground uppercase">{m.type}</p>
									</div>
								) : (
									<div className="h-6" />
								)}
							</div>
							<StatusDot status={m.status} />
						</div>
					))}
				</div>
			)}

			<footer className="mt-10 text-center text-xs text-muted-foreground">
				<Trans>Powered by</Trans> <a href={getHubURL()} className="underline hover:text-foreground">Beszel</a>
			</footer>
		</div>
	)
})
