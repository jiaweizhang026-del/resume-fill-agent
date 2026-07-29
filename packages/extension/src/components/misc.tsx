import type { AgentStatus } from '@page-agent/core'
import { BookOpen } from 'lucide-react'

import { TypingAnimation } from '@/components/ui/typing-animation'
import { cn } from '@/lib/utils'

// Status dot indicator
export function StatusDot({ status }: { status: AgentStatus }) {
	const colorClass = {
		idle: 'bg-emerald-500',
		running: 'bg-blue-500',
		completed: 'bg-green-500',
		error: 'bg-destructive',
		stopped: 'bg-muted-foreground',
	}[status]

	const label = {
		idle: '就绪',
		running: '填写中',
		completed: '已完成',
		error: '出错',
		stopped: '未就绪',
	}[status]

	return (
		<div className="flex items-center gap-1.5 mr-2">
			<span
				className={cn('size-2 rounded-full', colorClass, status === 'running' && 'animate-pulse')}
			/>
			<span className="text-xs text-muted-foreground">{label}</span>
		</div>
	)
}

export function Logo({ className }: { className?: string }) {
	return <img src="/assets/mix-wordmark.png" alt="miX" className={cn('object-contain', className)} />
}

// A quiet, monochrome execution signal. It intentionally avoids the multicolor
// animated border so page content remains the visual priority.
export function MotionOverlay({ active }: { active: boolean }) {
	return (
		<div
			className={cn(
				'agent-breath pointer-events-none absolute inset-0 z-10',
				active ? 'agent-breath--active' : 'agent-breath--idle'
			)}
			aria-hidden="true"
		/>
	)
}

// Empty state with logo and breathing glow
export function EmptyState() {
	return (
		<div className="flex flex-col items-center justify-center h-full gap-4 text-center px-6">
			<div className="relative select-none pointer-events-none">
				<div className="agent-logo-breath absolute inset-0 -m-6 rounded-full blur-2xl" />
				<Logo className="relative size-20 opacity-80" />
			</div>
			<div>
				<h2 className="text-base font-medium text-foreground mb-1">网申自动化</h2>
				<TypingAnimation
					className="text-sm text-muted-foreground"
					words={[
						'根据我的履历填写当前页面',
						'检查并补全未填写字段',
						'先读取页面，再逐项填写',
					]}
					cursorStyle="underscore"
					loop
					startOnView={false}
					typeSpeed={20}
					deleteSpeed={10}
					pauseDelay={3000}
				/>
			</div>
			<div className="flex items-center mt-1 text-muted-foreground">
				<a
					href="https://docs.qq.com/sheet/DWEpwY3dzYUpnZU5K?tab=BB08J2"
					target="_blank"
					rel="noopener noreferrer"
					className="hover:text-foreground transition-colors"
					title="填写说明"
				>
					<BookOpen className="size-4" />
				</a>
			</div>
		</div>
	)
}
