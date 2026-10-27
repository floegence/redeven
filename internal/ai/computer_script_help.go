package ai

import "strings"

// Runtime help and selection share one authored contract. No page content or
// user data enters documentation. Existing script signatures remain unchanged.
func computerScriptHelp(topic string, browser bool) (string, bool) {
	common := `All operations are sequentially awaited. log(value) emits text; observations emit automatically unless emit:false; help always emits.
ui.snapshot({root_ref?,limit?:1..1000,emit?:boolean}) -> {document_id,url?,title?,nodes,truncated}. Each node has ref, role, name, child_refs, states and optional value. role is canonical. Truncated content is unknown, not empty; narrow the scope.
ui.ref(ref) or ui.getByRole(role,{name?,exact?,root_ref?}) -> locator. Names are strings, case-insensitive contains unless exact:true. Act only on an unambiguous observed element. Search fields have role searchbox.
locator.node() -> node; locator.snapshot({limit?,emit?}) -> subtree snapshot.
locator.click(), locator.fill(text) replaces contents, locator.press(key), locator.scroll(delta_y,delta_x=0).
ui.type(text) inserts at current focus; ui.key(key) sends a character/named key or Alt/Control/Meta/Shift chord. Examples: Enter, ArrowDown, Meta+=. Equal is not a key name. Do not send whole text through key().
locator.requireState({state:'visible'|'hidden'|'enabled',timeout_ms?:0..30000}) -> void; timeout stops the script before later actions.
ui.screenshot() -> image; native ui.click(x,y), ui.doubleClick(x,y), ui.drag(x1,y1,x2,y2,duration_ms=0), ui.scroll(delta_y,delta_x=0) use target coordinates.
A failed script clears its variables. completed_actions records the prefix, not a rollback. Observe before deciding what remains. ui.help('read'|'visual'|'downloads') provides focused extensions.`
	switch topic {
	case "core":
		if browser {
			return common + "\nBrowser: browser.navigate(url), back(), reload(). image.click(x,y), doubleClick(x,y), drag(x1,y1,x2,y2,duration_ms=0), scroll(x,y,delta_y,delta_x=0) use the returned image pixels. Never convert DPR. Use ui.help('read') for collections/tables and ui.help('downloads') for exports.", true
		}
		return common + "\nNative: browser, collection/attribute reads and image-bound input are unavailable; image contains the screenshot metadata only.", true
	case "read":
		if !browser {
			return "Use ui.snapshot({root_ref,limit}) or locator.snapshot({limit}) for native subtrees. Respect truncated/children_truncated; collection and attribute methods are browser-only.", true
		}
		return `locator.query({limit?:1..200,cursor?}) -> {items:[{ref,role,name}],total,truncated,next_cursor?,scope:'loaded_accessibility_tree'}. locator.count() -> total loaded matches. Continue next_cursor only while contents are unchanged; virtualized unloaded items are not included.
locator.rows({limit?:1..200,cursor?}) reads a unique table/grid -> {rows:[{ref,cells:[{role,text}]}],total,truncated,next_cursor?,scope:'loaded_accessibility_tree'}. Includes header rows; use cell roles columnheader/rowheader/cell. cells_truncated and text_truncated explicitly mark omitted content; never compute exact totals from those rows. Counts are loaded rows, not a website-wide total. Narrow tables or paginate; do not infer missing rows.
locator.attribute(name) -> string|null for title, aria-label, aria-checked, aria-selected, aria-expanded, aria-rowcount, aria-colcount. locator.linkSummary() -> {url,redacted:true}; removes credentials/query/fragment and is NOT an action URL. Follow the observed link with click(), never reconstruct authenticated links.
locator.node() returns one canonical node; locator.snapshot() returns a flat canonical subtree. A locator is not a node and has no .node property.`, true
	case "visual":
		if !browser {
			return "Native coordinates are selected target coordinates. Capture ui.screenshot() before coordinate input. Browser image handles are unavailable.", true
		}
		return `Save the image from await ui.screenshot() on globalThis when the next model call must inspect it. Then image.click(x,y), image.doubleClick(x,y), image.drag(x1,y1,x2,y2,duration_ms=0), image.scroll(x,y,delta_y,delta_x=0). Coordinates are pixels of THAT image. The handle captures frame/document identity; a newer screenshot never retargets it. Changed document/viewport rejects stale input; observe again, never replay automatically. CSS ui.click(x,y) remains for explicit CSS coordinates. Scroll deltas use CSS wheel pixels, positive down/right. Its return value contains scroll_progress with immediate_after_dispatch measurements; null/unchanged does not prove failure. No force/modifiers/alternate mouse buttons.`, true
	case "downloads":
		if !browser {
			return "Downloads are browser-only.", true
		}
		return `globalThis.pendingDownload=await browser.downloadCursor(); log(pendingDownload); await ui.ref(exportRef).click(); const r=await pendingDownload.wait({timeout_ms:10000}); log(r); Verify r.download.state==='completed'. The handle captures its cursor; do not pass the whole handle as after. Legacy waitForDownload({after:cursor,timeout_ms?}) accepts a cursor STRING; {id,timeout_ms?} waits for an identified download. If a later operation fails after the click, do not click again: inspect (await browser.downloadCursor()).downloads and wait for the exact existing id. Multiple new downloads are ambiguous; inspect returned downloads and select the exact id. Do not repeat export, choose the latest filename, or invent browser.downloads()/readFile(). Managed completed downloads include their saved path; file tools, when available and authorized, read files.`, true
	case "legacy":
		return computerLegacyScriptDocumentation, true
	default:
		return "", false
	}
}

func computerBrowserTarget(kind string) bool { return strings.HasPrefix(kind, "browser.") }
