/**
 * React hook for using AgentController
 */
import type {
	AgentActivity,
	AgentStatus,
	ExecutionResult,
	HistoricalEvent,
	SupportedLanguage,
} from '@page-agent/core'
import type { LLMConfig } from '@page-agent/llms'
import { useCallback, useEffect, useRef, useState } from 'react'

import { MultiPageAgent } from './MultiPageAgent'
import { DEMO_CONFIG, enforceProductGateway } from './constants'

/** Language preference: undefined means follow system */
export type LanguagePreference = SupportedLanguage | undefined

export interface AdvancedConfig {
	maxSteps?: number
	systemInstruction?: string
	resumeText?: string
	experimentalLlmsTxt?: boolean
	experimentalIncludeAllTabs?: boolean
	disableNamedToolChoice?: boolean
}

export interface ExtConfig extends LLMConfig, AdvancedConfig {
	language?: LanguagePreference
}

export interface UseAgentResult {
	status: AgentStatus
	history: HistoricalEvent[]
	activity: AgentActivity | null
	currentTask: string
	config: ExtConfig | null
	execute: (task: string) => Promise<ExecutionResult>
	stop: () => void
	configure: (config: ExtConfig) => Promise<void>
}

export function useAgent(): UseAgentResult {
	const agentRef = useRef<MultiPageAgent | null>(null)
	const [status, setStatus] = useState<AgentStatus>('idle')
	const [history, setHistory] = useState<HistoricalEvent[]>([])
	const [activity, setActivity] = useState<AgentActivity | null>(null)
	const [currentTask, setCurrentTask] = useState('')
	const [config, setConfig] = useState<ExtConfig | null>(null)

	useEffect(() => {
		chrome.storage.local.get(['llmConfig', 'language', 'advancedConfig', 'resumeText']).then((result) => {
			let llmConfig = (result.llmConfig as LLMConfig) ?? DEMO_CONFIG
			const language = (result.language as SupportedLanguage) || undefined
			const advancedConfig = (result.advancedConfig as AdvancedConfig) ?? {}

			// This build only permits the paid product gateway, never a user-supplied provider key.
			const migrated = enforceProductGateway(llmConfig)
			if (migrated !== llmConfig) {
				llmConfig = migrated
				chrome.storage.local.set({ llmConfig: migrated })
			} else if (!result.llmConfig) {
				chrome.storage.local.set({ llmConfig: DEMO_CONFIG })
			}

			setConfig({ ...llmConfig, ...advancedConfig, resumeText: result.resumeText as string | undefined, language })
		})
	}, [])

	useEffect(() => {
		if (!config) return

		const { systemInstruction, resumeText, ...agentConfig } = config
		const safetyInstruction = `\n\n你是履历填写助手。用户当前打开的标签页就是你要操作的目标页面，默认直接在这个页面上读取内容并操作，不要调用 open_new_tab 另开页面，也绝不猜测或编造网址去打开；只有当该页面确实无法访问（如浏览器内部页/设置页），或用户明确提供了另一个网址，才可以打开新标签页。先读取当前页面，再依据用户履历点击、选择、输入和滚动。页面可能同时存在浏览器主页面、固定侧栏、内层表单、弹窗和下拉选项等独立滚动容器：每次滚动前，先判断目标字段实际属于哪个容器，只滚动该容器；滚动后重新读取当前可见内容并确认字段位置，不能把整页滚动当作所有区域都已滚动。绝不提交、投递、付款或发送表单；绝不填写密码、验证码、银行卡。证件号码、护照、社保号等敏感号码必须让用户自行确认填写；缺失信息时停在字段并说明需要补充或选择，禁止编造。`
		const resumeInstruction = resumeText?.trim()
			? `\n\n以下是用户授权用于本次填写的履历原文：\n---\n${resumeText.trim()}\n---`
			: '\n\n用户尚未添加履历。需要个人资料时，提示用户在设置中添加履历。'
		const agent = new MultiPageAgent({
			...agentConfig,
			instructions: { system: `${safetyInstruction}${systemInstruction ? `\n\n补充指令：${systemInstruction}` : ''}${resumeInstruction}` },
		})
		agentRef.current = agent

		const handleStatusChange = (e: Event) => {
			const newStatus = agent.status as AgentStatus
			setStatus(newStatus)
			if (newStatus !== 'running') {
				setActivity(null)
			}
		}

		const handleHistoryChange = (e: Event) => {
			setHistory([...agent.history])
		}

		const handleActivity = (e: Event) => {
			const newActivity = (e as CustomEvent).detail as AgentActivity
			setActivity(newActivity)
		}

		agent.addEventListener('statuschange', handleStatusChange)
		agent.addEventListener('historychange', handleHistoryChange)
		agent.addEventListener('activity', handleActivity)

		return () => {
			agent.removeEventListener('statuschange', handleStatusChange)
			agent.removeEventListener('historychange', handleHistoryChange)
			agent.removeEventListener('activity', handleActivity)
			agent.dispose()
		}
	}, [config])

	const execute = useCallback(async (task: string) => {
		const agent = agentRef.current
		if (!agent) throw new Error('Agent not initialized')

		setCurrentTask(task)
		setHistory([])
		try {
			return await agent.execute(task)
		} catch (error) {
			// Setup errors (e.g. thrown from onBeforeTask, such as "no usable tab")
			// happen before the agent loop starts, so PageAgentCore never records
			// them into `agent.history` (it only emits a transient 'activity').
			// Without this, the sidepanel would show nothing at all and the user
			// would have no idea why the task silently failed.
			const message = error instanceof Error ? error.message : String(error)
			setHistory((prev) => [...prev, { type: 'error', message }])
			throw error
		}
	}, [])

	const stop = useCallback(() => {
		agentRef.current?.stop()
	}, [])

	const configure = useCallback(
		async ({
			language,
			maxSteps,
			systemInstruction,
			resumeText,
			experimentalLlmsTxt,
			experimentalIncludeAllTabs,
			disableNamedToolChoice,
			...llmConfig
		}: ExtConfig) => {
			const productConfig = enforceProductGateway(llmConfig)
			await chrome.storage.local.set({ llmConfig: productConfig, resumeText: resumeText || '' })
			if (language) {
				await chrome.storage.local.set({ language })
			} else {
				await chrome.storage.local.remove('language')
			}
			const advancedConfig: AdvancedConfig = {
				maxSteps,
				systemInstruction,
				resumeText,
				experimentalLlmsTxt,
				experimentalIncludeAllTabs,
				disableNamedToolChoice,
			}
			await chrome.storage.local.set({ advancedConfig })
			setConfig({ ...productConfig, ...advancedConfig, language })
		},
		[]
	)

	return {
		status,
		history,
		activity,
		currentTask,
		config,
		execute,
		stop,
		configure,
	}
}
