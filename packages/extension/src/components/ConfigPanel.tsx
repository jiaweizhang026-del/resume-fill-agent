import {
	BookOpen,
	CornerUpLeft,
	Eye,
	EyeOff,
	FoldVertical,
	HatGlasses,
	Loader2,
	UnfoldVertical,
} from 'lucide-react'
import { useState, type ChangeEvent } from 'react'
import { siGithub } from 'simple-icons'

import { DEMO_BASE_URL, DEMO_MODEL } from '@/agent/constants'
import type { ExtConfig, LanguagePreference } from '@/agent/useAgent'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'

interface ConfigPanelProps {
	config: ExtConfig | null
	onSave: (config: ExtConfig) => Promise<void>
	onClose: () => void
}

export function ConfigPanel({ config, onSave, onClose }: ConfigPanelProps) {
	const [apiKey, setApiKey] = useState(config?.apiKey)
	const [language, setLanguage] = useState<LanguagePreference>(config?.language)
	const [maxSteps, setMaxSteps] = useState(config?.maxSteps)
	const [systemInstruction, setSystemInstruction] = useState(config?.systemInstruction ?? '')
	const [resumeText, setResumeText] = useState(config?.resumeText ?? '')
	const [experimentalLlmsTxt, setExperimentalLlmsTxt] = useState(
		config?.experimentalLlmsTxt ?? false
	)
	const [experimentalIncludeAllTabs, setExperimentalIncludeAllTabs] = useState(
		config?.experimentalIncludeAllTabs ?? false
	)
	const [disableNamedToolChoice, setDisableNamedToolChoice] = useState(
		config?.disableNamedToolChoice ?? false
	)
	const [advancedOpen, setAdvancedOpen] = useState(false)
	const [saving, setSaving] = useState(false)
	const [showApiKey, setShowApiKey] = useState(false)

	const [prevConfig, setPrevConfig] = useState(config)
	if (prevConfig !== config) {
		setPrevConfig(config)
		setApiKey(config?.apiKey)
		setLanguage(config?.language)
		setMaxSteps(config?.maxSteps)
		setSystemInstruction(config?.systemInstruction ?? '')
		setResumeText(config?.resumeText ?? '')
		setExperimentalLlmsTxt(config?.experimentalLlmsTxt ?? false)
		setExperimentalIncludeAllTabs(config?.experimentalIncludeAllTabs ?? false)
		setDisableNamedToolChoice(config?.disableNamedToolChoice ?? false)
	}

	const handleSave = async () => {
		setSaving(true)
		try {
			await onSave({
				apiKey,
				baseURL: DEMO_BASE_URL,
				model: DEMO_MODEL,
				language,
				maxSteps: maxSteps || undefined,
				systemInstruction: systemInstruction || undefined,
				resumeText: resumeText || undefined,
				experimentalLlmsTxt,
				experimentalIncludeAllTabs,
				disableNamedToolChoice,
			})
		} finally {
			setSaving(false)
		}
	}

	const handleResumeFile = async (event: ChangeEvent<HTMLInputElement>) => {
		const file = event.target.files?.[0]
		if (!file) return

		try {
			setResumeText(await file.text())
		} finally {
			// Permit choosing the same file again after editing it.
			event.target.value = ''
		}
	}

	return (
		<div className="flex flex-col gap-4 p-4 relative">
			<div className="flex items-center justify-between">
				<h2 className="text-base font-semibold">设置</h2>
				<Button
					variant="ghost"
					size="icon-sm"
					onClick={onClose}
					className="absolute top-2 right-3 cursor-pointer"
					aria-label="返回对话"
				>
					<CornerUpLeft className="size-3.5" />
				</Button>
			</div>

			<div className="flex flex-col gap-1.5">
				<label htmlFor="api-key" className="text-xs text-muted-foreground">
					产品 API Key
				</label>
				<p className="text-[10px] leading-relaxed text-muted-foreground">
					填写分配给你的 <span className="font-mono">mix_live_...</span>，不要填写 DeepSeek Key。
				</p>
				<div className="flex gap-2 items-center">
					<Input
						id="api-key"
						type={showApiKey ? 'text' : 'password'}
						placeholder="mix_live_..."
						value={apiKey}
						onChange={(e) => setApiKey(e.target.value)}
						className="text-xs h-8"
					/>
					<Button
						variant="outline"
						size="icon"
						className="h-8 w-8 shrink-0 cursor-pointer"
						onClick={() => setShowApiKey(!showApiKey)}
						aria-label={showApiKey ? '隐藏 API Key' : '显示 API Key'}
					>
						{showApiKey ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
					</Button>
				</div>
			</div>

			<div className="flex flex-col gap-1.5">
				<label htmlFor="resume-text" className="text-xs text-muted-foreground">我的履历</label>
				<p className="text-[10px] leading-relaxed text-muted-foreground">粘贴或导入本人履历。填写任务时会通过网申自动化网关发送给模型；不自动提交表单。</p>
				<textarea id="resume-text" placeholder="粘贴简历原文或字段表…" value={resumeText} onChange={(e) => setResumeText(e.target.value)} rows={9} className="min-h-[160px] resize-y rounded-md border border-input bg-background px-3 py-2 text-xs leading-relaxed" />
				<label className="w-fit cursor-pointer rounded-md border border-input px-2.5 py-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
					导入 .txt 履历
					<input type="file" accept=".txt,text/plain" className="sr-only" onChange={handleResumeFile} />
				</label>
			</div>

			<div className="border-l-2 border-foreground/20 pl-3 text-[11px] leading-relaxed text-muted-foreground">
				<p className="font-medium text-foreground">模型填写方式</p>
				<p>模型会先读取字段，再逐项点击、选择或输入。页面、侧栏、弹窗与下拉列表的滚动区域会分别定位；滚动后会重新读取当前内容，不会盲目整页滑动。</p>
			</div>

			<div className="flex flex-col gap-1.5">
				<label className="text-xs text-muted-foreground">回复语言</label>
				<select
					value={language ?? ''}
					onChange={(e) => setLanguage((e.target.value || undefined) as LanguagePreference)}
					className="h-8 text-xs rounded-md border border-input bg-background px-2 cursor-pointer"
				>
					<option value="">跟随系统</option>
					<option value="en-US">英文</option>
					<option value="zh-CN">中文</option>
				</select>
			</div>

			{/* Advanced Config */}
			<button
				type="button"
				onClick={() => setAdvancedOpen(!advancedOpen)}
				className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground cursor-pointer mt-1 font-bold"
			>
				高级设置
				{advancedOpen ? <FoldVertical className="size-3" /> : <UnfoldVertical className="size-3" />}
			</button>

			{advancedOpen && (
				<>
					<div className="flex flex-col gap-1.5">
						<label htmlFor="max-steps" className="text-xs text-muted-foreground">
							最大执行步数
						</label>
						<Input
							id="max-steps"
							type="number"
							placeholder="40"
							min={1}
							max={200}
							value={maxSteps ?? ''}
							onChange={(e) => setMaxSteps(e.target.value ? Number(e.target.value) : undefined)}
							className="text-xs h-8 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none [-moz-appearance:textfield]"
						/>
					</div>

					<div className="flex flex-col gap-1.5">
						<label className="text-xs text-muted-foreground">补充指令</label>
						<textarea
							placeholder="例如：优先填写必填字段，遇到不确定信息先询问我…"
							value={systemInstruction}
							onChange={(e) => setSystemInstruction(e.target.value)}
							rows={3}
							className="text-xs rounded-md border border-input bg-background px-3 py-2 resize-y min-h-[60px]"
						/>
					</div>

					<label className="flex items-center justify-between cursor-pointer">
						<span className="text-xs text-muted-foreground">兼容部分模型的工具调用</span>
						<Switch checked={disableNamedToolChoice} onCheckedChange={setDisableNamedToolChoice} />
					</label>

					<label className="flex items-center justify-between cursor-pointer">
						<span className="text-xs text-muted-foreground">实验性 llms.txt 支持</span>
						<Switch checked={experimentalLlmsTxt} onCheckedChange={setExperimentalLlmsTxt} />
					</label>

					<label className="flex items-center justify-between cursor-pointer">
						<span className="text-xs text-muted-foreground">实验性：允许读取所有标签页</span>
						<Switch
							checked={experimentalIncludeAllTabs}
							onCheckedChange={setExperimentalIncludeAllTabs}
						/>
					</label>
				</>
			)}

			<div className="flex gap-2 mt-2">
				<Button variant="outline" onClick={onClose} className="flex-1 h-8 text-xs cursor-pointer">
					取消
				</Button>
				<Button
					onClick={handleSave}
					disabled={saving}
					className="flex-1 h-8 text-xs cursor-pointer"
				>
					{saving ? <Loader2 className="size-3 animate-spin" /> : '保存设置'}
				</Button>
			</div>

			{/* Footer */}
			<div className="mt-4 mb-4 pt-4 border-t border-border/50 flex gap-2 justify-between text-[10px] text-muted-foreground">
				<div className="flex flex-col justify-between">
					<span>
						版本 <span className="font-mono">v{__VERSION__}</span>
					</span>

					<a
						href="https://github.com/alibaba/page-agent"
						target="_blank"
						rel="noopener noreferrer"
						className="flex items-center gap-1 hover:text-foreground"
					>
						<svg role="img" viewBox="0 0 24 24" className="size-3 fill-current">
							<path d={siGithub.path} />
						</svg>
						<span>特别鸣谢</span>
					</a>
				</div>

				<div className="flex flex-col items-end">
					<a
						href="https://docs.qq.com/sheet/DWEpwY3dzYUpnZU5K?tab=BB08J2"
						target="_blank"
						rel="noopener noreferrer"
						className="flex items-center gap-1 hover:text-foreground"
					>
						<BookOpen className="size-3" />
						<span>项目主页</span>
					</a>

					<a
						href="https://github.com/alibaba/page-agent/blob/main/docs/terms-and-privacy.md"
						target="_blank"
						rel="noopener noreferrer"
						className="flex items-center gap-1 hover:text-foreground"
					>
						<HatGlasses className="size-3" />
						<span>隐私说明</span>
					</a>
				</div>
			</div>
		</div>
	)
}
