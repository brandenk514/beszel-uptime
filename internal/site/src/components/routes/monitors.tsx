import { useLingui } from "@lingui/react/macro"
import { memo, Suspense, useEffect } from "react"
import MonitorsTable from "@/components/monitors-table/monitors-table"
import { FooterRepoLink } from "@/components/footer-repo-link"

export default memo(() => {
	const { t } = useLingui()

	useEffect(() => {
		document.title = `${t`Monitors`} / Beszel`
	}, [t])

	return (
		<>
			<div className="flex flex-col gap-4">
				<Suspense>
					<MonitorsTable />
				</Suspense>
			</div>
			<FooterRepoLink />
		</>
	)
})
