package ai

import "strings"

// Runtime help and selection share one authored contract. No page content or
// user data enters documentation. Existing script signatures remain unchanged.
func computerScriptHelp(topic string, browser bool) (string, bool) {
	common := `Await every operation. No setTimeout/setInterval, DOM or Node. const/let are local to one call; globalThis.pages=[] persists within this turn/target. log(value) emits text. snapshot/observe emit automatically unless emit:false; locator.snapshot also accepts emit. Collection reads return data; log selected findings. Help and screenshots always emit.
Each call has 30 seconds and 50 operations. ui.budget() -> {remaining_ms,remaining_operations} reads the current budget without an operation. Combine deterministic steps, loops and conditions across pages within this budget; log completed findings. Capture screenshots when needed and return to the model if the next action requires visual judgment. Safe explicit logs survive timeout; private pauses discard them.
ui.snapshot({root_ref?,limit?:1..1000,emit?:boolean,full?:boolean}) -> {document_id,url?,title?,nodes,truncated}. The returned tree includes ref, role (canonical), name, child_refs, states and optional value. Automatic model output is compact (32 KiB); full:true emits details, and locator.node() reads one detailed node. These reads keep the 2,000-character field budget; name_truncated/description_truncated/value_truncated:true mark incomplete fields independently of tree truncated. Compact output uses parent_ref. node() returns one node, not its subtree; child_refs only links nodes within the returned tree, and children_truncated marks omitted descendants. Use snapshot() for subtrees and browser rows()/query()/count() for loaded collections. Truncated content is unknown, not empty; narrow the scope.
ui.ref(ref) or ui.getByRole(role,{name?,exact?,root_ref?}) -> locator. Names are strings, case-insensitive contains unless exact:true. node()/click() require exactly one match; missing or ambiguous matches fail, never return null. Refs identify the observed node, role and complete name within a document; navigation, replacement or name changes can invalidate them. Observe again or resolve a semantic locator. Search fields have role searchbox; pagination landmarks use navigation. Unknown role other is ref-only: ui.ref(node.ref).
All reads are async: const node = await locator.node(); await locator.snapshot({limit?,emit?}) returns a subtree snapshot.
locator.click(), locator.fill(text) replaces contents, locator.press(key), locator.scroll(delta_y,delta_x=0). For scroll measurements: const result = await locator.scroll(80); log(result.scroll_progress). before/after/measurement belong to this result, never to a node or snapshot; immediate_after_dispatch is not proof of settled UI.
ui.type(text) inserts at current focus; ui.key(key) sends a character/named key or Alt/Control/Meta/Shift chord. Use ui.key('PageDown') for page keys. locator.press requires a focusable element; document roots are not elements. Examples: Enter, ArrowDown, Meta+=. Equal is not a key name. Do not send whole text through key().
locator.waitFor({state:'visible'|'hidden'|'enabled',timeout_ms?:0..30000}) -> {state}; check state!=='timeout'. locator.requireState(options) -> void; timeout stops the script. There is no ui.wait/ui.waitFor. Scope with root_ref from await parent.node(); locators have no nested getByRole.
await ui.screenshot() automatically returns the image with this tool result; the returned object contains screenshot metadata, not PNG bytes or a filesystem path. No extra save/export is needed to show it. Image interpretation happens after the call returns.
Any failed host operation seals this invocation even if JavaScript catches it; later host operations cannot run. A failed invocation clears its namespace (context_reset:true); prior effects remain. completed_actions records the prefix, not a rollback. Observe before deciding what remains. ui.help('read'|'visual'|'downloads') provides focused extensions.`
	switch topic {
	case "core":
		if browser {
			return common + "\nFor optional browser elements, count()/query() may return zero matches; waitFor returns timeout as data. Browser locator.click() scrolls into view and checks actionability before input; no scroll_into_view method is needed. Browser locator waits also accept {state:'text'|'value',equals:string,timeout_ms?} for exact textContent/value. Example: await ui.getByRole('textbox',{name:'Page number',exact:true}).requireState({state:'value',equals:'2',timeout_ms:5000}); waits only read and never repeat input. After saving globalThis.image=await ui.screenshot(), inspect the image and call await image.click(x,y) in the next call; recapture after scrolling. browser.navigate(url), back(), reload() wait for load, not application readiness; a timeout can follow an already completed navigation. Inspect returned facts and observe before choosing another action. image.click(x,y), doubleClick(x,y), drag(x1,y1,x2,y2,duration_ms=0), scroll(x,y,delta_y,delta_x=0) use the optimized model image pixels, bound to the screenshot frame. Browser drag duration_ms is an integer 0..5000: move along a straight path over that duration while holding the button; 0 adds no delay. Dispatch overhead may extend it. Never convert DPR. Use ui.help('read') for collections/tables and ui.help('downloads') for exports.", true
		}
		return common + "\nNative ui.click(x,y), doubleClick(x,y), drag(x1,y1,x2,y2,duration_ms=0) use window-local points matching normalized screenshot pixels. Drag duration_ms is an integer 0..5000; it schedules a straight path while holding the button, 0 adds no delay, and delivery overhead may extend it. ui.scroll(delta_y,delta_x=0) uses the window center; ui.scrollAt(x,y,delta_y,delta_x=0) targets a region. Native snapshots reflect application-provided accessibility, not guaranteed screen completeness. truncated:false means the available tree was not cut; if visible content is absent, use screenshot and targeted scrolling. Native screenshot image.click/doubleClick/drag/scroll use optimized model pixels with frame validation. Browser and collection/attribute reads are unavailable.", true
	case "read":
		if !browser {
			return "Use ui.snapshot({root_ref,limit}) or locator.snapshot({limit}) for native subtrees. Respect truncated/children_truncated and field name_truncated/description_truncated/value_truncated; collection and attribute methods are browser-only.", true
		}
		return `locator.query({limit?:1..200,cursor?}) -> {items:[{ref,role,name,name_truncated?}],total,truncated,next_cursor?,scope:'loaded_accessibility_tree'}. locator.count() -> total loaded matches. Continue next_cursor only while contents are unchanged; virtualized unloaded items are not included.
locator.rows({limit?:1..200,cursor?}) reads a unique table/grid -> {rows:[{ref,cells:[{role,text}]}],total,truncated,next_cursor?,scope:'loaded_accessibility_tree'}. Includes header rows; use cell roles columnheader/rowheader/cell. cells_truncated and text_truncated explicitly mark omitted content; never compute exact totals from those rows. Counts are loaded rows, not a website-wide total. Narrow tables or paginate; do not infer missing rows.
locator.attribute(name) -> string|null for title, aria-label, aria-checked, aria-selected, aria-expanded, aria-rowcount, aria-colcount. Attributes over 2,000 Unicode characters fail explicitly, never return a partial scalar. locator.linkSummary() -> {url,redacted:true}; removes credentials/query/fragment and is NOT an action URL. Follow the observed link with click(), never reconstruct authenticated links.
locator.text() -> {text,truncated,scope:'rendered_element'} reads up to 12,000 Unicode characters of visible text from one unique observed HTML element in one operation. Document, text and SVG nodes are unsupported; choose an HTML element explicitly. Hidden content is excluded; truncated text is incomplete. Use exact text/value condition waits for asynchronous data rather than repeatedly scanning the full tree.
locator.node() returns one canonical node; locator.snapshot() returns a flat canonical subtree. A locator is not a node and has no .node property.`, true
	case "visual":
		if !browser {
			return "Native ui.click(x,y), ui.doubleClick(x,y), ui.drag(x1,y1,x2,y2,duration_ms=0) use window-local points matching normalized screenshot pixels (top-left origin). ui.scroll(delta_y,delta_x=0) uses the window center; ui.scrollAt(x,y,delta_y,delta_x=0) scrolls a specific region without a preparatory click. Deltas are pixels, positive down/right. Drag duration_ms is an integer 0..5000; it schedules a straight path while holding the button, 0 adds no delay, and delivery overhead may extend it. Capture ui.screenshot() before coordinate input. AX bounds use the same coordinates. Browser image handles are unavailable.", true
		}
		return `Save the image from await ui.screenshot() on globalThis when the next model call must inspect it. Then image.click(x,y), image.doubleClick(x,y), image.drag(x1,y1,x2,y2,duration_ms=0), image.scroll(x,y,delta_y,delta_x=0). Coordinates are pixels of THAT image. The handle captures frame/document identity; a newer screenshot never retargets it. Changed document/viewport rejects stale input; observe again, never replay automatically. Browser drag duration_ms is an integer 0..5000: move along a straight path over that duration while holding the button; 0 adds no delay. Dispatch overhead may extend it. CSS ui.click(x,y) remains for explicit CSS coordinates. Scroll deltas use CSS wheel pixels, positive down/right. Its return value contains scroll_progress with immediate_after_dispatch measurements; null/unchanged does not prove failure. No force/modifiers/alternate mouse buttons.`, true
	case "downloads":
		if !browser {
			return "Downloads are browser-only.", true
		}
		return `Capture the cursor BEFORE one export action:
const pending = await browser.downloadCursor();
await ui.getByRole('link',{name:'Export domains',exact:true}).click();
const result = await pending.wait({timeout_ms:10000});
log(result);
if (result.download?.state === 'completed') log(await browser.saveDownload(result.download.id));
Use the returned path with terminal/file tools to process the bytes. saveDownload(id) copies the exact completed download to task scratch (maximum 256 MiB); returns {id,filename,path,size_bytes,state:'saved'}. Managed downloads also expose their original saved path. Neither method reads arbitrary filesystem paths.
For small previews, readDownload(id,{offset?:0,limit?:1..65536}) returns {id,filename,offset,bytes,base64,size_bytes?,truncated,next_offset?}; default limit is 16384. Decode with a script/file tool, or use saveDownload for complete content.
After a failure following the export, inspect (await browser.downloadCursor()).downloads and wait for the existing id; do not export again. Multiple new downloads return AMBIGUOUS_DOWNLOAD with candidates: choose an exact id. The cursor handle captures its cursor; legacy waitForDownload({after:cursor,timeout_ms?}) accepts a cursor STRING, while {id,timeout_ms?} waits for one download. Downloads and bytes remain owned by the selected source.`, true
	case "legacy":
		return computerLegacyScriptDocumentation, true
	default:
		return "", false
	}
}

func computerBrowserTarget(kind string) bool { return strings.HasPrefix(kind, "browser.") }
