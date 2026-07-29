/**
 * Copyright (C) 2025 Alibaba Group Holding Limited
 * All rights reserved.
 */
import type { InteractiveElementDomNode } from './dom/dom_tree/type'
import {
	clickPointer,
	disablePassThrough,
	enablePassThrough,
	getNativeValueSetter,
	isHTMLElement,
	isInputElement,
	isSelectElement,
	isTextAreaElement,
	movePointerToElement,
	waitFor,
} from './utils'

/**
 * Get the HTMLElement by index from a selectorMap.
 * @private Internal method, subject to change at any time.
 */
export function getElementByIndex(
	selectorMap: Map<number, InteractiveElementDomNode>,
	index: number
): HTMLElement {
	const interactiveNode = selectorMap.get(index)
	if (!interactiveNode) {
		throw new Error(`No interactive element found at index ${index}`)
	}

	const element = interactiveNode.ref
	if (!element) {
		throw new Error(`Element at index ${index} does not have a reference`)
	}

	if (!isHTMLElement(element)) {
		throw new Error(`Element at index ${index} is not an HTMLElement`)
	}

	return element
}

let lastClickedElement: HTMLElement | null = null

function blurLastClickedElement() {
	if (lastClickedElement) {
		lastClickedElement.dispatchEvent(new PointerEvent('pointerout', { bubbles: true }))
		lastClickedElement.dispatchEvent(new PointerEvent('pointerleave', { bubbles: false }))
		lastClickedElement.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }))
		lastClickedElement.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false }))
		lastClickedElement.blur()
		lastClickedElement = null
	}
}

/**
 * Simulate a full click following W3C Pointer Events + UI Events spec order:
 * pointerover/enter → mouseover/enter → pointerdown → mousedown → [focus] →
 * pointerup → mouseup → click
 *
 * @private Internal method, subject to change at any time.
 */
export async function clickElement(element: HTMLElement) {
	blurLastClickedElement()

	lastClickedElement = element

	await scrollIntoViewIfNeeded(element)
	const frame = element.ownerDocument.defaultView?.frameElement
	if (frame) await scrollIntoViewIfNeeded(frame)

	const rect = element.getBoundingClientRect()
	const x = rect.left + rect.width / 2
	const y = rect.top + rect.height / 2

	await movePointerToElement(element, x, y)
	await clickPointer()

	await waitFor(0.1)

	// Hit-test to find the deepest element at click coordinates, matching
	// real browser behavior where events target the innermost element.
	// @note This may hit a element in the blacklist
	// TODO: This is a temporary workaround. Should have been handled during dom extraction.
	const doc = element.ownerDocument
	await enablePassThrough()
	const hitTarget = doc.elementFromPoint(x, y)
	await disablePassThrough()
	const target =
		hitTarget instanceof HTMLElement && element.contains(hitTarget) ? hitTarget : element

	const pointerOpts = {
		bubbles: true,
		cancelable: true,
		clientX: x,
		clientY: y,
		pointerType: 'mouse',
	}
	const mouseOpts = { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }

	// Hover — pointer events first, then mouse events (spec order)
	target.dispatchEvent(new PointerEvent('pointerover', pointerOpts))
	target.dispatchEvent(new PointerEvent('pointerenter', { ...pointerOpts, bubbles: false }))
	target.dispatchEvent(new MouseEvent('mouseover', mouseOpts))
	target.dispatchEvent(new MouseEvent('mouseenter', { ...mouseOpts, bubbles: false }))

	// Press
	target.dispatchEvent(new PointerEvent('pointerdown', pointerOpts))
	target.dispatchEvent(new MouseEvent('mousedown', mouseOpts))

	// Focus is not part of the standard pointer/mouse event sequence
	// "undefined and varies between user agents".
	// We focus the original element (nearest focusable ancestor), not the hit-test target, matching browser behavior.
	element.focus({ preventScroll: true })

	// Release
	target.dispatchEvent(new PointerEvent('pointerup', pointerOpts))
	target.dispatchEvent(new MouseEvent('mouseup', mouseOpts))

	// Click — activation behavior (navigation, form submit, etc.) triggers
	// via bubbling from target up to the interactive ancestor.
	target.click()

	await waitFor(0.2)
}

/**
 * @private Internal method, subject to change at any time.
 */
export async function inputTextElement(element: HTMLElement, text: string) {
	const isContentEditable = element.isContentEditable
	if (!isInputElement(element) && !isTextAreaElement(element) && !isContentEditable) {
		throw new Error('Element is not an input, textarea, or contenteditable')
	}

	await clickElement(element)

	if (isContentEditable) {
		// Contenteditable support (partial)
		// Not supported:
		// - Monaco/CodeMirror: Require direct JS instance access. No universal way to obtain.
		// - Draft.js: Not responsive to synthetic/execCommand/Range/DataTransfer. Unmaintained.
		//
		// Strategy: Try Plan A (synthetic events) first, then verify and fall back
		// to Plan B (execCommand) if the text wasn't actually inserted.
		//
		// Plan A: Dispatch synthetic events
		// Works: React contenteditable, Quill.
		// Fails: Slate.js, some contenteditable editors that ignore synthetic events.
		// Sequence: beforeinput -> mutation -> input -> change -> blur

		// Dispatch beforeinput + mutation + input for clearing
		if (
			element.dispatchEvent(
				new InputEvent('beforeinput', {
					bubbles: true,
					cancelable: true,
					inputType: 'deleteContent',
				})
			)
		) {
			element.innerText = ''
			element.dispatchEvent(
				new InputEvent('input', {
					bubbles: true,
					inputType: 'deleteContent',
				})
			)
		}

		// Dispatch beforeinput + mutation + input for insertion (important for React apps)
		if (
			element.dispatchEvent(
				new InputEvent('beforeinput', {
					bubbles: true,
					cancelable: true,
					inputType: 'insertText',
					data: text,
				})
			)
		) {
			element.innerText = text
			element.dispatchEvent(
				new InputEvent('input', {
					bubbles: true,
					inputType: 'insertText',
					data: text,
				})
			)
		}

		// Verify Plan A worked by checking if the text was actually inserted
		const planASucceeded = element.innerText.trim() === text.trim()

		if (!planASucceeded) {
			// Plan B: execCommand fallback (deprecated but widely supported)
			// Works: Quill, Slate.js, react contenteditable components.
			// This approach integrates with the browser's undo stack and is handled
			// natively by most rich-text editors.
			element.focus()

			// Select all existing content and delete it
			const doc = element.ownerDocument
			const selection = (doc.defaultView || window).getSelection()
			const range = doc.createRange()
			range.selectNodeContents(element)
			selection?.removeAllRanges()
			selection?.addRange(range)

			doc.execCommand('delete', false)
			doc.execCommand('insertText', false, text)
		}

		// Dispatch change event (for good measure)
		element.dispatchEvent(new Event('change', { bubbles: true }))

		// Trigger blur for validation
		element.blur()
	} else {
		getNativeValueSetter(element as HTMLInputElement | HTMLTextAreaElement).call(element, text)
	}

	// Only dispatch shared input event for non-contenteditable (contenteditable has its own)
	if (!isContentEditable) {
		element.dispatchEvent(new Event('input', { bubbles: true }))
	}

	await waitFor(0.1)

	blurLastClickedElement()
}

/**
 * @todo browser-use version is very complex and supports menu tags, need to follow up
 * @private Internal method, subject to change at any time.
 */
export async function selectOptionElement(selectElement: HTMLSelectElement, optionText: string) {
	if (!isSelectElement(selectElement)) {
		throw new Error('Element is not a select element')
	}

	const options = Array.from(selectElement.options)
	const option = options.find((opt) => opt.textContent?.trim() === optionText.trim())

	if (!option) {
		throw new Error(`Option with text "${optionText}" not found in select element`)
	}

	selectElement.value = option.value
	selectElement.dispatchEvent(new Event('change', { bubbles: true }))

	await waitFor(0.1) // Wait to ensure change event processing completes
}

interface ScrollableElement extends Element {
	scrollIntoViewIfNeeded?: (centerIfNeeded?: boolean) => void
}

/**
 * @private Internal method, subject to change at any time.
 */
export async function scrollIntoViewIfNeeded(element: Element) {
	const el = element as ScrollableElement
	if (typeof el.scrollIntoViewIfNeeded === 'function') {
		el.scrollIntoViewIfNeeded()
		// await waitFor(0.5) // Animation playback
	} else {
		// @todo visibility check
		element.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'nearest' })
		// await waitFor(0.5) // Animation playback
	}
}

/**
 * Checks whether `el` can independently absorb more scroll in the given
 * axis: it declares `overflow: auto/scroll/overlay`, still has unscrolled
 * content, and is at least `minSize` px in the relevant dimension.
 *
 * `minSize` matters because the same test is used for two very different
 * situations: a large in-flow layout column (e.g. a sidebar card list, which
 * should only "win" over page scroll when it is a substantial fraction of
 * the viewport) vs. a small floating overlay like a date-picker's
 * year/month list (which is legitimately tiny and must NOT be filtered out
 * by a large size threshold).
 *
 * @private Internal helper, subject to change at any time.
 */
function isIndependentlyScrollable(
	el: HTMLElement | null,
	axis: 'x' | 'y',
	minSize: number
): boolean {
	if (!el) return false
	const overflowProp = axis === 'y' ? 'overflowY' : 'overflowX'
	const scrollSizeProp = axis === 'y' ? 'scrollHeight' : 'scrollWidth'
	const clientSizeProp = axis === 'y' ? 'clientHeight' : 'clientWidth'

	return (
		/(auto|scroll|overlay)/.test(getComputedStyle(el)[overflowProp]) &&
		el[scrollSizeProp] > el[clientSizeProp] &&
		el[clientSizeProp] >= minSize
	)
}

/**
 * Hit-tests a handful of points spread across the viewport - the same way a
 * real scroll wheel would act on whatever is rendered under the cursor - and
 * walks up from there to the nearest independently scrollable ancestor.
 *
 * While climbing, also detects whether the candidate sits inside a
 * `position: fixed` ancestor. A fixed-positioned scrollable region (modal,
 * dropdown, date-picker popup, etc.) is rendered *on top of* the page and
 * does not move when the page scrolls, so it must be preferred over
 * page-level scroll regardless of whether the page itself still has room to
 * scroll. Such overlays are also often small, so they are checked with a
 * much lower size threshold than in-flow layout containers - otherwise a
 * legitimate but compact popup (e.g. a year list ~200px tall) would be
 * wrongly filtered out by a "must be at least half the viewport" rule that
 * only makes sense for competing in-flow siblings like a sidebar.
 *
 * @private Internal helper, subject to change at any time.
 */
function findScrollableContainerByProbe(
	axis: 'x' | 'y'
): { el: HTMLElement; floating: boolean } | null {
	const viewportSize = axis === 'y' ? window.innerHeight : window.innerWidth
	const inFlowMinSize = viewportSize * 0.5
	const floatingMinSize = 24 // just enough to rule out scrollbar-width artifacts

	const probePoints: Array<[number, number]> = [
		[window.innerWidth / 2, window.innerHeight / 2],
		[window.innerWidth / 2, window.innerHeight * 0.75],
		[window.innerWidth * 0.3, window.innerHeight / 2],
		[window.innerWidth * 0.7, window.innerHeight / 2],
	]

	for (const [x, y] of probePoints) {
		let candidate = document.elementFromPoint(x, y) as HTMLElement | null
		let floating = false
		while (candidate && candidate !== document.body && candidate !== document.documentElement) {
			if (getComputedStyle(candidate).position === 'fixed') floating = true
			if (isIndependentlyScrollable(candidate, axis, floating ? floatingMinSize : inFlowMinSize)) {
				return { el: candidate, floating }
			}
			candidate = candidate.parentElement
		}
	}

	return null
}

/**
 * Resolves what should actually move when scrolling without an explicit
 * element index:
 *
 * 1. If a floating overlay (modal/dropdown/date-picker popup, detected via
 *    `position: fixed`) sits at the probed points and can itself scroll,
 *    it always wins - it visually stays put no matter what the page does,
 *    so scrolling the page can never reach it.
 * 2. Else, if the page itself still has more content than the viewport in
 *    this axis, scroll the window. This must NOT depend on `<html>`/`<body>`
 *    having an explicit `overflow: auto`/`scroll` - native page scrolling
 *    works with the default `overflow: visible` too. Checking computed
 *    style here almost never matches a real page and wrongly hands off to
 *    an unrelated container instead - permanently locking scroll onto
 *    whichever widget happens to declare `overflow: auto` first in DOM
 *    order (e.g. a small sidebar card list), even though the actual page
 *    has plenty of room to scroll.
 * 3. Else, fall back to whatever in-flow scrollable container was found by
 *    the same probe.
 * 4. As a last resort (e.g. every probe point landed on a non-scrollable
 *    area), fall back to the first matching element in DOM order.
 *
 * @private Internal helper, subject to change at any time.
 */
function resolveScrollTarget(axis: 'x' | 'y'): 'window' | HTMLElement {
	const probed = findScrollableContainerByProbe(axis)
	if (probed?.floating) return probed.el

	const viewportSize = axis === 'y' ? window.innerHeight : window.innerWidth
	const documentScrollSize =
		axis === 'y' ? document.documentElement.scrollHeight : document.documentElement.scrollWidth

	if (documentScrollSize > viewportSize + 1) return 'window'

	if (probed) return probed.el

	const inFlowMinSize = viewportSize * 0.5
	return (
		Array.from(document.querySelectorAll<HTMLElement>('*')).find((el) => {
			const floating = getComputedStyle(el).position === 'fixed'
			return isIndependentlyScrollable(el, axis, floating ? 24 : inFlowMinSize)
		}) ??
		(document.scrollingElement as HTMLElement) ??
		document.documentElement
	)
}

/**
 * Scrolls a resolved container element (not the window) and reports the
 * outcome. Shared by the "container is the primary target" path and the
 * "window scroll turned out to be a no-op" fallback path.
 *
 * @private Internal helper, subject to change at any time.
 */
async function scrollContainer(
	el: HTMLElement,
	amount: number,
	axis: 'x' | 'y',
	messagePrefix: string
): Promise<string> {
	const scrollPosProp = axis === 'y' ? 'scrollTop' : 'scrollLeft'
	const scrollSizeProp = axis === 'y' ? 'scrollHeight' : 'scrollWidth'
	const clientSizeProp = axis === 'y' ? 'clientHeight' : 'clientWidth'
	const edgeNames = axis === 'y' ? ['bottom', 'top'] : ['right edge', 'left edge']

	const scrollBefore = el[scrollPosProp]
	const scrollMax = el[scrollSizeProp] - el[clientSizeProp]

	el.scrollBy(axis === 'y' ? { top: amount, behavior: 'smooth' } : { left: amount, behavior: 'smooth' })
	await waitFor(0.1)

	const scrollAfter = el[scrollPosProp]
	const scrolled = scrollAfter - scrollBefore

	if (Math.abs(scrolled) < 1) {
		return amount > 0
			? `⚠️ ${messagePrefix}Already at the ${edgeNames[0]} of container (${el.tagName}), cannot scroll further.`
			: `⚠️ ${messagePrefix}Already at the ${edgeNames[1]} of container (${el.tagName}), cannot scroll further.`
	}

	const reachedEnd = amount > 0 && scrollAfter >= scrollMax - 1
	const reachedStart = amount < 0 && scrollAfter <= 1

	if (reachedEnd)
		return `✅ ${messagePrefix}Scrolled container (${el.tagName}) by ${scrolled}px. Reached the ${edgeNames[0]}.`
	if (reachedStart)
		return `✅ ${messagePrefix}Scrolled container (${el.tagName}) by ${scrolled}px. Reached the ${edgeNames[1]}.`
	return `✅ ${messagePrefix}Scrolled container (${el.tagName}) by ${scrolled}px.`
}

export async function scrollVertically(scroll_amount: number, element?: HTMLElement | null) {
	// Element-specific scrolling if element is provided
	if (element) {
		const targetElement = element
		let currentElement = targetElement as HTMLElement | null
		let scrollSuccess = false
		let scrolledElement: HTMLElement | null = null
		let scrollDelta = 0
		let attempts = 0
		const dy = scroll_amount

		while (currentElement && attempts < 10) {
			const computedStyle = window.getComputedStyle(currentElement)
			const hasScrollableY =
				/(auto|scroll|overlay)/.test(computedStyle.overflowY) ||
				(computedStyle.scrollbarWidth && computedStyle.scrollbarWidth !== 'auto') ||
				(computedStyle.scrollbarGutter && computedStyle.scrollbarGutter !== 'auto')
			const canScrollVertically = currentElement.scrollHeight > currentElement.clientHeight

			if (hasScrollableY && canScrollVertically) {
				const beforeScroll = currentElement.scrollTop
				const maxScroll = currentElement.scrollHeight - currentElement.clientHeight

				let scrollAmount = dy / 3

				if (scrollAmount > 0) {
					scrollAmount = Math.min(scrollAmount, maxScroll - beforeScroll)
				} else {
					scrollAmount = Math.max(scrollAmount, -beforeScroll)
				}

				currentElement.scrollTop = beforeScroll + scrollAmount

				const afterScroll = currentElement.scrollTop
				const actualScrollDelta = afterScroll - beforeScroll

				if (Math.abs(actualScrollDelta) > 0.5) {
					scrollSuccess = true
					scrolledElement = currentElement
					scrollDelta = actualScrollDelta
					break
				}
			}

			if (currentElement === document.body || currentElement === document.documentElement) {
				break
			}
			currentElement = currentElement.parentElement
			attempts++
		}

		if (scrollSuccess) {
			return `Scrolled container (${scrolledElement?.tagName}) by ${scrollDelta}px`
		} else {
			return `No scrollable container found for element (${targetElement.tagName})`
		}
	}

	// Page-level scrolling (default or fallback)

	const dy = scroll_amount
	const target = resolveScrollTarget('y')

	if (target === 'window') {
		const scrollBefore = window.scrollY
		const scrollMax = document.documentElement.scrollHeight - window.innerHeight

		window.scrollBy(0, dy)

		const scrollAfter = window.scrollY
		const scrolled = scrollAfter - scrollBefore

		if (Math.abs(scrolled) < 1) {
			// The page reports more scrollable height than the viewport, but
			// nothing actually moved - most likely a modal/dialog is open and
			// has locked page scroll (e.g. `body { overflow: hidden }`). Probe
			// for whatever is actually rendered on top before giving up.
			const fallback = findScrollableContainerByProbe('y')
			if (fallback) {
				return scrollContainer(
					fallback.el,
					dy,
					'y',
					`The page did not scroll (likely blocked by an open modal/dialog). Falling back to container scroll. `
				)
			}
			return dy > 0
				? `⚠️ Already at the bottom of the page, cannot scroll down further.`
				: `⚠️ Already at the top of the page, cannot scroll up further.`
		}

		const reachedBottom = dy > 0 && scrollAfter >= scrollMax - 1
		const reachedTop = dy < 0 && scrollAfter <= 1

		if (reachedBottom) return `✅ Scrolled page by ${scrolled}px. Reached the bottom of the page.`
		if (reachedTop) return `✅ Scrolled page by ${scrolled}px. Reached the top of the page.`
		return `✅ Scrolled page by ${scrolled}px.`
	} else {
		return scrollContainer(
			target,
			dy,
			'y',
			`The page has no more room to scroll here. Falling back to container scroll. `
		)
	}
}

export async function scrollHorizontally(scroll_amount: number, element?: HTMLElement | null) {
	// Element-specific scrolling if element is provided
	if (element) {
		const targetElement = element
		let currentElement = targetElement as HTMLElement | null
		let scrollSuccess = false
		let scrolledElement: HTMLElement | null = null
		let scrollDelta = 0
		let attempts = 0
		const dx = scroll_amount

		while (currentElement && attempts < 10) {
			const computedStyle = window.getComputedStyle(currentElement)
			const hasScrollableX =
				/(auto|scroll|overlay)/.test(computedStyle.overflowX) ||
				(computedStyle.scrollbarWidth && computedStyle.scrollbarWidth !== 'auto') ||
				(computedStyle.scrollbarGutter && computedStyle.scrollbarGutter !== 'auto')
			const canScrollHorizontally = currentElement.scrollWidth > currentElement.clientWidth

			if (hasScrollableX && canScrollHorizontally) {
				const beforeScroll = currentElement.scrollLeft
				const maxScroll = currentElement.scrollWidth - currentElement.clientWidth

				let scrollAmount = dx / 3

				if (scrollAmount > 0) {
					scrollAmount = Math.min(scrollAmount, maxScroll - beforeScroll)
				} else {
					scrollAmount = Math.max(scrollAmount, -beforeScroll)
				}

				currentElement.scrollLeft = beforeScroll + scrollAmount

				const afterScroll = currentElement.scrollLeft
				const actualScrollDelta = afterScroll - beforeScroll

				if (Math.abs(actualScrollDelta) > 0.5) {
					scrollSuccess = true
					scrolledElement = currentElement
					scrollDelta = actualScrollDelta
					break
				}
			}

			if (currentElement === document.body || currentElement === document.documentElement) {
				break
			}
			currentElement = currentElement.parentElement
			attempts++
		}

		if (scrollSuccess) {
			return `Scrolled container (${scrolledElement?.tagName}) horizontally by ${scrollDelta}px`
		} else {
			return `No horizontally scrollable container found for element (${targetElement.tagName})`
		}
	}

	// Page-level scrolling (default or fallback)

	const dx = scroll_amount
	const target = resolveScrollTarget('x')

	if (target === 'window') {
		// Page-level scroll
		const scrollBefore = window.scrollX
		const scrollMax = document.documentElement.scrollWidth - window.innerWidth

		window.scrollBy(dx, 0)

		const scrollAfter = window.scrollX
		const scrolled = scrollAfter - scrollBefore

		if (Math.abs(scrolled) < 1) {
			// See the vertical case in scrollVertically: the page may report
			// more scrollable width than the viewport yet not actually move,
			// most likely because a modal/dialog has locked page scroll. Probe
			// for whatever is actually rendered on top before giving up.
			const fallback = findScrollableContainerByProbe('x')
			if (fallback) {
				return scrollContainer(
					fallback.el,
					dx,
					'x',
					`The page did not scroll (likely blocked by an open modal/dialog). Falling back to container scroll. `
				)
			}
			return dx > 0
				? `⚠️ Already at the right edge of the page, cannot scroll right further.`
				: `⚠️ Already at the left edge of the page, cannot scroll left further.`
		}

		const reachedRight = dx > 0 && scrollAfter >= scrollMax - 1
		const reachedLeft = dx < 0 && scrollAfter <= 1

		if (reachedRight)
			return `✅ Scrolled page by ${scrolled}px. Reached the right edge of the page.`
		if (reachedLeft) return `✅ Scrolled page by ${scrolled}px. Reached the left edge of the page.`
		return `✅ Scrolled page horizontally by ${scrolled}px.`
	} else {
		return scrollContainer(
			target,
			dx,
			'x',
			`The page has no more room to scroll here. Falling back to container scroll. `
		)
	}
}
