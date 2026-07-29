/**
 * Tab control tools for browser extension
 *
 * These tools allow the agent to manage multiple browser tabs:
 * - open_new_tab: Open a new tab and set it as current
 * - switch_to_tab: Switch to an existing tab
 * - close_tab: Close a tab (optionally switch to another)
 */
import type { ToolContext } from '@page-agent/core'
import * as z from 'zod/v4'

import type { TabsController } from './TabsController'

/** Tool definition compatible with PageAgentCore customTools */
interface TabTool {
	description: string
	inputSchema: z.ZodType
	execute: (input: unknown, ctx: ToolContext) => Promise<string>
}

/**
 * Create tab control tools bound to a TabsManager instance.
 * These tools are injected into PageAgentCore via customTools config.
 */
export function createTabTools(tabsController: TabsController): Record<string, TabTool> {
	return {
		open_new_tab: {
			description:
				'Open a new browser tab with the specified URL. The new tab becomes the current tab for all subsequent page operations. ' +
				'Only use this when you already know the exact target URL — e.g. it was given by the user, appears in the current page/browser state, or you are returning to a page you previously navigated away from. ' +
				'NEVER guess, invent, or assume a URL (including search engine or generic homepage URLs) just because no usable page is currently available. ' +
				'If you do not know the exact URL to open, call `done` with success=false and ask the user to open the target page themselves instead.',
			inputSchema: z.object({
				url: z.string().describe('The URL to open in the new tab'),
			}),
			execute: async (input: unknown, { signal }: ToolContext) => {
				const { url } = input as { url: string }
				try {
					return await tabsController.openNewTab(url, { signal })
				} catch (error) {
					// Let cancellation propagate instead of masking it as a tool failure.
					if (signal.aborted) throw error
					return `❌ Failed: ${error instanceof Error ? error.message : String(error)}`
				}
			},
		},

		switch_to_tab: {
			description:
				'Switch to an existing tab by its ID. After switching, all page operations will target the new current tab. You can only switch to tabs in the tab list shown in browser state.',
			inputSchema: z.object({
				tab_id: z.number().int().describe('The tab ID to switch to'),
			}),
			execute: async (input: unknown) => {
				const { tab_id } = input as { tab_id: number }
				try {
					return await tabsController.switchToTab(tab_id)
				} catch (error) {
					return `❌ Failed: ${error instanceof Error ? error.message : String(error)}`
				}
			},
		},

		close_tab: {
			description:
				'Close a tab by its ID. Cannot close the initial tab. Optionally specify which tab to switch to after closing.',
			inputSchema: z.object({
				tab_id: z.number().int().describe('The tab ID to close'),
			}),
			execute: async (input: unknown) => {
				const { tab_id } = input as { tab_id: number }
				try {
					return await tabsController.closeTab(tab_id)
				} catch (error) {
					return `❌ Failed: ${error instanceof Error ? error.message : String(error)}`
				}
			},
		},
	}
}
