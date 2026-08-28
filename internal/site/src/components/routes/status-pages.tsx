import { Trans } from "@lingui/react/macro"
import { memo, useEffect, useState } from "react"
import { GlobeIcon, PenBoxIcon, PlusIcon, Trash2Icon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
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
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { isReadOnlyUser, pb } from "@/lib/api"
import { cn } from "@/lib/utils"
import type { StatusPageRecord } from "@/types"
import { getPagePath } from "@nanostores/router"
import { $router } from "../router"
import { toast } from "../ui/use-toast"
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "../ui/alert-dialog"

function slugify(value: string) {
	return value
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
}

export default memo(() => {
	const [pages, setPages] = useState<StatusPageRecord[]>([])
	const [dialogOpen, setDialogOpen] = useState(false)
	const [editing, setEditing] = useState<StatusPageRecord | undefined>(undefined)
	const [deleteId, setDeleteId] = useState<string | null>(null)
	const [loading, setLoading] = useState(true)

	const refresh = async () => {
		try {
			const list = await pb.collection<StatusPageRecord>("status_pages").getFullList({ sort: "+name" })
			setPages(list)
		} catch (err) {
			console.error(err)
			toast({ title: "Failed to load status pages", variant: "destructive" })
		} finally {
			setLoading(false)
		}
	}

	useEffect(() => {
		refresh()
		document.title = `Status Pages / Beszel`
	}, [])

	async function handleToggleEnabled(page: StatusPageRecord) {
		try {
			await pb.collection("status_pages").update(page.id, { enabled: !page.enabled })
			setPages((p) => p.map((x) => (x.id === page.id ? { ...x, enabled: !page.enabled } : x)))
		} catch (err) {
			console.error(err)
			toast({ title: "Failed to update status page", variant: "destructive" })
		}
	}

	async function handleDelete(id: string) {
		try {
			await pb.collection("status_pages").delete(id)
			setDeleteId(null)
			refresh()
		} catch (err) {
			console.error(err)
			toast({ title: "Failed to delete status page", variant: "destructive" })
		}
	}

	return (
		<>
			<div className="flex justify-end mb-2">
				{!isReadOnlyUser() && (
					<Button
						className="flex gap-1"
						onClick={() => {
							setEditing(undefined)
							setDialogOpen(true)
						}}
					>
						<PlusIcon className="h-4 w-4 -ms-1" />
						<Trans>New Status Page</Trans>
					</Button>
				)}
			</div>

			{loading ? (
				<p className="text-muted-foreground py-8 text-center">
					<Trans>Loading status pages...</Trans>
				</p>
			) : pages.length === 0 ? (
				<Card>
					<CardHeader>
						<CardTitle className="text-lg">
							<Trans>No status pages yet</Trans>
						</CardTitle>
						<CardDescription>
							<Trans>Create a public status page that lists your monitors and their current status.</Trans>
						</CardDescription>
					</CardHeader>
				</Card>
			) : (
				<div className="grid gap-3">
					{pages.map((page) => (
						<Card key={page.id}>
							<CardContent className="flex items-center justify-between gap-3 py-4">
								<div className="flex items-center gap-3 min-w-0">
									<GlobeIcon className="h-5 w-5 shrink-0 text-muted-foreground" strokeWidth={1.5} />
									<div className="min-w-0">
										<p className="font-medium truncate">{page.name}</p>
										<code className="text-xs text-muted-foreground">
											{getPagePath($router, "statusPage", { slug: page.slug })}
										</code>
									</div>
								</div>
								<div className="flex items-center gap-2 shrink-0">
									<div className="flex items-center gap-2 text-sm">
										<span className="text-muted-foreground hidden sm:inline">
											<Trans>Enabled</Trans>
										</span>
										<Switch
											checked={!!page.enabled}
											disabled={isReadOnlyUser()}
											onCheckedChange={() => handleToggleEnabled(page)}
										/>
									</div>
									{!isReadOnlyUser() && (
										<>
											<Button
												variant="ghost"
												size="icon"
												className={cn("h-8 w-8")}
												onClick={() => {
													setEditing(page)
													setDialogOpen(true)
												}}
												aria-label="Edit"
											>
												<PenBoxIcon className="h-4 w-4" />
											</Button>
											<Button
												variant="ghost"
												size="icon"
												className="h-8 w-8 hover:text-destructive"
												onClick={() => setDeleteId(page.id)}
												aria-label="Delete"
											>
												<Trash2Icon className="h-4 w-4" />
											</Button>
										</>
									)}
								</div>
							</CardContent>
						</Card>
					))}
				</div>
			)}

			<StatusPageDialog
				open={dialogOpen}
				setOpen={(open) => {
					setDialogOpen(open)
					if (open) setEditing(undefined)
				}}
				page={editing}
				onSaved={refresh}
			/>

			<AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							<Trans>Delete status page?</Trans>
						</AlertDialogTitle>
						<AlertDialogDescription>
							<Trans>
								This will permanently remove the status page. Monitors that reference it will be unaffected.
							</Trans>
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>
							<Trans>Cancel</Trans>
						</AlertDialogCancel>
						<AlertDialogAction
							onClick={async () => {
								if (deleteId) await handleDelete(deleteId)
							}}
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
						>
							<Trans>Delete</Trans>
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	)
})

function StatusPageDialog({
	open,
	setOpen,
	page,
	onSaved,
}: {
	open: boolean
	setOpen: (open: boolean) => void
	page?: StatusPageRecord
	onSaved: () => void
}) {
	const [name, setName] = useState(page?.name || "")
	const [slug, setSlug] = useState(page?.slug || "")
	const [description, setDescription] = useState(page?.description || "")
	const [showMonitors, setShowMonitors] = useState(page?.show_monitors ?? true)
	const [enabled, setEnabled] = useState(page?.enabled ?? true)
	const [saving, setSaving] = useState(false)

	useEffect(() => {
		setName(page?.name || "")
		setSlug(page?.slug || "")
		setDescription(page?.description || "")
		setShowMonitors(page?.show_monitors ?? true)
		setEnabled(page?.enabled ?? true)
	}, [page, open])

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault()
		if (!name.trim()) {
			toast({ title: "Name is required", variant: "destructive" })
			return
		}
		const finalSlug = slugify(slug || name)
		if (!finalSlug) {
			toast({ title: "A valid slug is required", variant: "destructive" })
			return
		}
		setSaving(true)
		try {
			const data = {
				name: name.trim(),
				slug: finalSlug,
				description: description.trim(),
				show_monitors: showMonitors,
				enabled,
			}
			if (page) {
				await pb.collection("status_pages").update(page.id, data)
			} else {
				await pb.collection("status_pages").create({ ...data, user: pb.authStore.record?.id ?? "" })
			}
			setOpen(false)
			onSaved()
		} catch (err) {
			console.error(err)
			toast({ title: "Failed to save status page", variant: "destructive" })
		} finally {
			setSaving(false)
		}
	}

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogContent className="w-[90%] sm:w-auto sm:ns-dialog max-w-full rounded-lg">
				<DialogHeader>
					<DialogTitle>{page ? <Trans>Edit Status Page</Trans> : <Trans>New Status Page</Trans>}</DialogTitle>
					<DialogDescription className="mb-3">
						<Trans>Public status page that shows the status of your assigned monitors.</Trans>
					</DialogDescription>
				</DialogHeader>
				<form onSubmit={handleSubmit} className="grid gap-4">
					<div className="grid gap-2">
						<Label>
							<Trans>Name</Trans>
						</Label>
						<Input value={name} onChange={(e) => setName(e.target.value)} required />
					</div>
					<div className="grid gap-2">
						<Label>
							<Trans>Slug</Trans>
						</Label>
						<Input
							value={slug}
							onChange={(e) => setSlug(e.target.value)}
							placeholder="example: main-status"
							pattern="[a-z0-9-]+"
						/>
						<p className="text-xs text-muted-foreground">
							<Trans>Lowercase letters, numbers, and dashes. Used in the public URL.</Trans>
						</p>
					</div>
					<div className="grid gap-2">
						<Label>
							<Trans>Description (optional)</Trans>
						</Label>
						<Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
					</div>
					<div className="flex items-center justify-between">
						<div className="grid gap-0.5">
							<Label>
								<Trans>Show monitor names</Trans>
							</Label>
							<p className="text-xs text-muted-foreground">
								<Trans>If off, only status dots are shown.</Trans>
							</p>
						</div>
						<Switch checked={showMonitors} onCheckedChange={setShowMonitors} />
					</div>
					<div className="flex items-center justify-between">
						<div className="grid gap-0.5">
							<Label>
								<Trans>Enabled</Trans>
							</Label>
							<p className="text-xs text-muted-foreground">
								<Trans>Disabled pages are not publicly accessible.</Trans>
							</p>
						</div>
						<Switch checked={enabled} onCheckedChange={setEnabled} />
					</div>
					<DialogFooter className="flex justify-end gap-2 mt-2">
						<Button type="submit" disabled={saving}>
							{saving ? <Trans>Saving...</Trans> : page ? <Trans>Save</Trans> : <Trans>Create</Trans>}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	)
}
