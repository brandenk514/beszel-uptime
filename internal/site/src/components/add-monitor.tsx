import { Trans } from "@lingui/react/macro"
import { memo, useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { isReadOnlyUser, pb } from "@/lib/api"
import { SystemStatus } from "@/lib/enums"
import { generateToken, getHubURL } from "@/lib/utils"
import type { MonitorRecord, MonitorType, StatusPageRecord } from "@/types"
import { navigate } from "./router"
import { toast } from "./ui/use-toast"

const MONITOR_TYPES: MonitorType[] = ["http", "tcp", "ping", "dns", "docker", "websocket", "steam", "push"]

const DNS_TYPES = ["a", "aaaa", "cname", "mx", "txt", "ns"]

/** Build the record payload for the selected monitor type, clearing unrelated fields. */
function buildMonitorData(state: MonitorFormState, type: MonitorType): Record<string, unknown> {
	const data: Record<string, unknown> = {
		name: state.name,
		type,
		interval: Math.max(5, parseInt(state.interval) || 60),
		timeout: Math.max(1, parseInt(state.timeout) || 10),
		retry: state.retry,
		retry_delay: Math.max(0, parseInt(state.retryDelay) || 0),
		num_retries: Math.max(1, parseInt(state.numRetries) || 1),
		secure: state.secure,
		user: pb.authStore.record!.id,
		// clear type-specific fields
		url: "",
		host: "",
		port: 0,
		method: "",
		expected_status: "",
		expected_body: "",
		json_query: "",
		dns_type: "",
		dns_value: "",
		app_id: "",
		docker_url: "",
		push_token: "",
		check_cert: false,
	}

	switch (type) {
		case "http":
			data.url = state.url
			data.method = state.method
			if (state.expectedStatus) data.expected_status = state.expectedStatus
			if (state.expectedBody) data.expected_body = state.expectedBody
			if (state.jsonQuery) data.json_query = state.jsonQuery
			data.check_cert = state.checkCert
			break
		case "tcp":
			data.host = state.host
			data.port = Math.max(1, parseInt(state.port) || 80)
			break
		case "ping":
			data.host = state.host
			break
		case "dns":
			data.host = state.host
			data.dns_type = state.dnsType || "a"
			if (state.dnsValue) data.dns_value = state.dnsValue
			break
		case "docker":
			// container name/id stored in url; daemon socket in docker_url
			data.url = state.container
			if (state.dockerUrl) data.docker_url = state.dockerUrl
			break
		case "websocket":
			data.url = state.url
			if (state.expectedBody) data.expected_body = state.expectedBody
			break
		case "steam":
			data.app_id = state.appId
			break
		case "push":
			data.push_token = state.pushToken
			break
	}

	if (state.statusPage) data.status_page = state.statusPage
	return data
}

interface MonitorFormState {
	type: MonitorType
	name: string
	url: string
	host: string
	port: string
	interval: string
	timeout: string
	method: string
	expectedStatus: string
	expectedBody: string
	jsonQuery: string
	dnsType: string
	dnsValue: string
	appId: string
	container: string
	dockerUrl: string
	pushToken: string
	secure: boolean
	retry: boolean
	retryDelay: string
	numRetries: string
	checkCert: boolean
	statusPage: string
}

function stateFromMonitor(monitor?: MonitorRecord): MonitorFormState {
	return {
		type: monitor?.type || "http",
		name: monitor?.name || "",
		url: monitor?.url || "",
		host: monitor?.host || "",
		port: monitor?.port ? String(monitor.port) : "80",
		interval: monitor?.interval ? String(monitor.interval) : "60",
		timeout: monitor?.timeout ? String(monitor.timeout) : "10",
		method: monitor?.method || "get",
		expectedStatus: monitor?.expected_status || "",
		expectedBody: monitor?.expected_body || "",
		jsonQuery: monitor?.json_query || "",
		dnsType: monitor?.dns_type || "a",
		dnsValue: monitor?.dns_value || "",
		appId: monitor?.app_id || "",
		container: monitor?.type === "docker" ? monitor?.url || "" : "",
		dockerUrl: monitor?.docker_url || "",
		pushToken: monitor?.push_token || "",
		secure: monitor?.secure || false,
		retry: monitor?.retry ?? true,
		retryDelay: monitor?.retry_delay ? String(monitor.retry_delay) : "5",
		numRetries: monitor?.num_retries ? String(monitor.num_retries) : "1",
		checkCert: monitor?.check_cert || false,
		statusPage: monitor?.status_page || "",
	}
}

export function AddMonitorDialog({ open, setOpen }: { open: boolean; setOpen: (open: boolean) => void }) {
	if (isReadOnlyUser()) {
		return null
	}
	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<MonitorDialog setOpen={setOpen} />
		</Dialog>
	)
}

export const MonitorDialog = memo(
	({ setOpen, monitor }: { setOpen: (open: boolean) => void; monitor?: MonitorRecord }) => {
		const [state, setState] = useState<MonitorFormState>(() => stateFromMonitor(monitor))
		const [statusPages, setStatusPages] = useState<StatusPageRecord[]>([])
		const [saving, setSaving] = useState(false)

		const set = <K extends keyof MonitorFormState>(key: K, value: MonitorFormState[K]) =>
			setState((s) => ({ ...s, [key]: value }))

		useEffect(() => {
			setState(stateFromMonitor(monitor))
			pb
				.collection<StatusPageRecord>("status_pages")
				.getFullList({ sort: "+name", fields: "id,name,slug,enabled" })
				.then(setStatusPages)
				.catch(() => setStatusPages([]))
		}, [monitor?.id])

		const pushUrl = state.pushToken ? `${getHubURL()}/api/beszel/uptime/push?token=***}` : ""

		const copyPushUrl = useCallback(() => {
			if (!pushUrl) return
			navigator.clipboard
				?.writeText(pushUrl)
				.then(
					() => toast({ title: "Push URL copied", variant: "default" }),
					() => toast({ title: "Copy failed", variant: "destructive" })
				)
				.catch(() => toast({ title: "Copy failed", variant: "destructive" }))
		}, [pushUrl])

		async function handleSubmit(e: React.FormEvent) {
			e.preventDefault()
			if (saving) return
			if (!state.name.trim()) {
				toast({ title: "Name is required", variant: "destructive" })
				return
			}
			if (state.type === "push" && !state.pushToken) {
				toast({ title: "Generate a push token first", variant: "destructive" })
				return
			}
			setSaving(true)
			try {
				const data = buildMonitorData(state, state.type)
				if (monitor) {
					await pb.collection("monitors").update(monitor.id, { ...data, status: SystemStatus.Pending })
				} else {
					await pb.collection("monitors").create(data)
				}
				setOpen(false)
				navigate("/monitors")
			} catch (err) {
				console.error(err)
				toast({ title: "Failed to save monitor", variant: "destructive" })
			} finally {
				setSaving(false)
			}
		}

		const type = state.type

		return (
			<DialogContent className="w-[90%] sm:w-auto sm:ns-dialog max-w-full rounded-lg">
				<DialogHeader>
					<DialogTitle className="mb-1 pb-1 max-w-100 truncate pr-8">
						{monitor ? <Trans>Edit Monitor</Trans> : <Trans>Add Monitor</Trans>}
					</DialogTitle>
					<DialogDescription className="mb-3 leading-relaxed w-0 min-w-full">
						<Trans>
							Monitor a website, TCP port, host, DNS record, Docker container, WebSocket endpoint, Steam app,
							or a push heartbeat. The type determines which fields are required.
						</Trans>
					</DialogDescription>
				</DialogHeader>

				<form onSubmit={handleSubmit} className="grid gap-4">
					<div className="grid gap-2">
						<Label htmlFor="m-type">
							<Trans>Type</Trans>
						</Label>
						<Select value={type} onValueChange={(v) => set("type", v as MonitorType)} disabled={!!monitor}>
							<SelectTrigger id="m-type">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{MONITOR_TYPES.map((t) => (
									<SelectItem key={t} value={t}>
										{t.toUpperCase()}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>

					<div className="grid gap-2">
						<Label htmlFor="m-name">
							<Trans>Name</Trans>
						</Label>
						<Input id="m-name" value={state.name} onChange={(e) => set("name", e.target.value)} required />
					</div>

					{(type === "http" || type === "websocket") && (
						<div className="grid gap-2">
							<Label htmlFor="m-url">
								{type === "http" ? <Trans>URL</Trans> : <Trans>WebSocket URL</Trans>}
							</Label>
							<Input
								id="m-url"
								value={state.url}
								onChange={(e) => set("url", e.target.value)}
								placeholder={type === "http" ? "https://example.com/health" : "wss://example.com/socket"}
								required
							/>
						</div>
					)}

					{type === "tcp" && (
						<>
							<div className="grid gap-2">
								<Label htmlFor="m-host">
									<Trans>Host</Trans>
								</Label>
								<Input
									id="m-host"
									value={state.host}
									onChange={(e) => set("host", e.target.value)}
									placeholder="example.com"
									required
								/>
							</div>
							<div className="grid gap-2">
								<Label htmlFor="m-port">
									<Trans>Port</Trans>
								</Label>
								<Input
									id="m-port"
									type="number"
									min="1"
									max="65535"
									value={state.port}
									onChange={(e) => set("port", e.target.value)}
									required
								/>
							</div>
						</>
					)}

					{type === "ping" && (
						<div className="grid gap-2">
							<Label htmlFor="m-host">
								<Trans>Host / IP</Trans>
							</Label>
							<Input
								id="m-host"
								value={state.host}
								onChange={(e) => set("host", e.target.value)}
								placeholder="example.com or 8.8.8.8"
								required
							/>
						</div>
					)}

					{type === "dns" && (
						<>
							<div className="grid gap-2">
								<Label htmlFor="m-host">
									<Trans>Domain</Trans>
								</Label>
								<Input
									id="m-host"
									value={state.host}
									onChange={(e) => set("host", e.target.value)}
									placeholder="example.com"
									required
								/>
							</div>
							<div className="grid grid-cols-2 gap-3">
								<div className="grid gap-2">
									<Label>
										<Trans>Record type</Trans>
									</Label>
									<Select value={state.dnsType} onValueChange={(v) => set("dnsType", v)}>
										<SelectTrigger>
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											{DNS_TYPES.map((t) => (
												<SelectItem key={t} value={t}>
													{t.toUpperCase()}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</div>
								<div className="grid gap-2">
									<Label>
										<Trans>Expected value</Trans>
									</Label>
									<Input
										value={state.dnsValue}
										onChange={(e) => set("dnsValue", e.target.value)}
										placeholder="Optional, substring match"
									/>
								</div>
							</div>
						</>
					)}

					{type === "docker" && (
						<>
							<div className="grid gap-2">
								<Label htmlFor="m-container">
									<Trans>Container name or ID</Trans>
								</Label>
								<Input
									id="m-container"
									value={state.container}
									onChange={(e) => set("container", e.target.value)}
									placeholder="postgres"
									required
								/>
							</div>
							<div className="grid gap-2">
								<Label htmlFor="m-docker-url">
									<Trans>Docker socket / API</Trans>
								</Label>
								<Input
									id="m-docker-url"
									value={state.dockerUrl}
									onChange={(e) => set("dockerUrl", e.target.value)}
									placeholder="unix:///var/run/docker.sock or http://host:2375"
								/>
								<p className="text-xs text-muted-foreground">
									<Trans>Only required if the hub runs in a container or reaches Docker over the network.</Trans>
								</p>
							</div>
						</>
					)}

					{type === "steam" && (
						<div className="grid gap-2">
							<Label htmlFor="m-app-id">
									<Trans>Steam App ID</Trans>
								</Label>
							<Input
								id="m-app-id"
								value={state.appId}
								onChange={(e) => set("appId", e.target.value)}
								placeholder="e.g. 730"
								required
							/>
						</div>
					)}

					{type === "push" && (
						<div className="grid gap-2">
							<Label>
								<Trans>Push token</Trans>
							</Label>
							<div className="flex gap-2">
								<Input
									value={state.pushToken}
									onChange={(e) => set("pushToken", e.target.value)}
									placeholder="random token"
									readOnly
								/>
								<Button type="button" variant="outline" onClick={() => set("pushToken", generateToken())}>
									<Trans>Generate</Trans>
								</Button>
							</div>
							{pushUrl && (
								<div className="grid gap-2">
									<p className="text-xs text-muted-foreground">
										<Trans>
											POST to this URL (curl, cron, or your service) to record a heartbeat. The monitor is down
											if no heartbeat arrives within the check interval.
										</Trans>
									</p>
									<code className="text-xs break-all bg-muted rounded px-2 py-1.5 select-all">{pushUrl}</code>
									<Button type="button" variant="ghost" size="sm" className="w-fit" onClick={copyPushUrl}>
										<Trans>Copy push URL</Trans>
									</Button>
								</div>
							)}
						</div>
					)}

					<div className="grid grid-cols-2 gap-3">
						<div className="grid gap-2">
							<Label htmlFor="m-interval">
								<Trans>Interval (sec)</Trans>
							</Label>
							<Input
								id="m-interval"
								type="number"
								min="5"
								max="86400"
								value={state.interval}
								onChange={(e) => set("interval", e.target.value)}
								required
							/>
						</div>
						<div className="grid gap-2">
							<Label htmlFor="m-timeout">
								<Trans>Timeout (sec)</Trans>
							</Label>
							<Input
								id="m-timeout"
								type="number"
								min="1"
								max="120"
								value={state.timeout}
								onChange={(e) => set("timeout", e.target.value)}
								required
							/>
						</div>
					</div>

					{type === "http" && (
						<>
							<div className="grid grid-cols-2 gap-3">
								<div className="grid gap-2">
									<Label>
										<Trans>Method</Trans>
									</Label>
									<Select value={state.method} onValueChange={(v) => set("method", v)}>
										<SelectTrigger>
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value="get">GET</SelectItem>
											<SelectItem value="post">POST</SelectItem>
											<SelectItem value="put">PUT</SelectItem>
											<SelectItem value="delete">DELETE</SelectItem>
											<SelectItem value="head">HEAD</SelectItem>
											<SelectItem value="patch">PATCH</SelectItem>
										</SelectContent>
									</Select>
								</div>
								<div className="grid gap-2">
									<Label>
										<Trans>Expected status</Trans>
									</Label>
									<Input
										value={state.expectedStatus}
										onChange={(e) => set("expectedStatus", e.target.value)}
										placeholder="200, 201, 3xx"
									/>
								</div>
							</div>
							<div className="grid gap-2">
								<Label>
									<Trans>Expected body</Trans>
								</Label>
								<Textarea
									value={state.expectedBody}
									onChange={(e) => set("expectedBody", e.target.value)}
									placeholder={state.jsonQuery ? "Expected value at the JSON path" : "substring to search for in response"}
									rows={2}
								/>
							</div>
							<div className="grid gap-2">
								<Label>
									<Trans>JSON query (optional)</Trans>
								</Label>
								<Input
									value={state.jsonQuery}
									onChange={(e) => set("jsonQuery", e.target.value)}
									placeholder=".status or .data.items[0].name"
								/>
							</div>
							<div className="flex items-center justify-between">
								<div className="grid gap-0.5">
									<Label>
										<Trans>Check certificate expiry</Trans>
									</Label>
									<p className="text-xs text-muted-foreground">
										<Trans>Fail if the TLS certificate expires within 14 days</Trans>
									</p>
								</div>
								<Switch id="m-check-cert" checked={state.checkCert} onCheckedChange={(v) => set("checkCert", v)} />
							</div>
						</>
					)}

					{(type === "http" || type === "websocket") && (
						<div className="flex items-center justify-between">
							<div className="grid gap-0.5">
								<Label>
									<Trans>Secure (skip TLS verify)</Trans>
								</Label>
								<p className="text-xs text-muted-foreground">
									<Trans>Allow self-signed or invalid certificates</Trans>
								</p>
							</div>
							<Switch id="m-secure" checked={state.secure} onCheckedChange={(v) => set("secure", v)} />
						</div>
					)}

					<div className="grid gap-3">
						<div className="flex items-center justify-between">
							<div className="grid gap-0.5">
								<Label>
									<Trans>Retry on failure</Trans>
								</Label>
								<p className="text-xs text-muted-foreground">
									<Trans>Extra attempts before marking as down</Trans>
								</p>
							</div>
							<Switch id="m-retry" checked={state.retry} onCheckedChange={(v) => set("retry", v)} />
						</div>
						{state.retry && (
							<div className="grid grid-cols-2 gap-2">
								<div className="grid gap-2">
									<Label>
										<Trans>Retries</Trans>
									</Label>
									<Input
										type="number"
										min="1"
										max="20"
										value={state.numRetries}
										onChange={(e) => set("numRetries", e.target.value)}
									/>
								</div>
								<div className="grid gap-2">
									<Label>
										<Trans>Delay (sec)</Trans>
									</Label>
									<Input
										type="number"
										min="0"
										max="60"
										value={state.retryDelay}
										onChange={(e) => set("retryDelay", e.target.value)}
									/>
								</div>
							</div>
						)}
					</div>

					{statusPages.length > 0 && (
						<div className="grid gap-2">
							<Label>
								<Trans>Status page (optional)</Trans>
							</Label>
							<Select
								value={state.statusPage || "none"}
								onValueChange={(v) => set("statusPage", v === "none" ? "" : v)}
							>
								<SelectTrigger>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="none">
										<Trans>None</Trans>
									</SelectItem>
									{statusPages.map((p) => (
										<SelectItem key={p.id} value={p.id}>
											{p.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					)}

					<DialogFooter className="flex justify-end gap-2 mt-2">
						<Button type="submit" disabled={saving}>
							{saving ? (
								<Trans>Saving...</Trans>
							) : monitor ? (
								<Trans>Save Monitor</Trans>
							) : (
								<Trans>Add Monitor</Trans>
							)}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		)
	}
)
